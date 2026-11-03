import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { api, app, login, makeTeam, PASSWORD, resetDb } from "./helpers.js";

describe("authentication & access control", () => {
  beforeEach(async () => {
    await resetDb();
    await makeTeam();
  });

  it("logs in with valid credentials and returns the profile", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "LENA@test.dev", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "lena@test.dev", role: "LEADER" });
    expect(res.body.user.passwordHash).toBeUndefined();
    // Web clients get the refresh token only as an httpOnly cookie.
    expect(res.body.refreshToken).toBeUndefined();
    expect(String(res.headers["set-cookie"])).toMatch(/nesma_rt=.*HttpOnly.*SameSite=Strict/i);
  });

  it("rejects a wrong password and an unknown email with the same message", async () => {
    const a = await request(app).post("/api/auth/login").send({ email: "lena@test.dev", password: "nope" });
    const b = await request(app).post("/api/auth/login").send({ email: "ghost@test.dev", password: "nope" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it("requires a valid bearer token", async () => {
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    expect((await api("garbage").get("/api/tasks")).status).toBe(401);
  });

  it("rotates refresh tokens and revokes all sessions on reuse", async () => {
    const { refreshToken } = await login("alice@test.dev");
    const first = await request(app).post("/api/auth/refresh").send({ refreshToken, client: "mobile" });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(refreshToken);

    // Replaying the old token is treated as theft...
    const replay = await request(app).post("/api/auth/refresh").send({ refreshToken, client: "mobile" });
    expect(replay.status).toBe(401);
    // ...and kills the newer session too.
    const after = await request(app).post("/api/auth/refresh").send({ refreshToken: first.body.refreshToken, client: "mobile" });
    expect(after.status).toBe(401);
  });

  it("blocks members from leader-only areas", async () => {
    const { token } = await login("alice@test.dev");
    const m = api(token);
    expect((await m.get("/api/reports")).status).toBe(403);
    expect((await m.get("/api/system/status")).status).toBe(403);
    expect((await m.post("/api/users", { name: "X Y", email: "x@test.dev", password: "Abcdefg1" })).status).toBe(403);
  });

  it("lets a leader provision a member with individual credentials", async () => {
    const { token } = await login("lena@test.dev");
    const weak = await api(token).post("/api/users", { name: "New Person", email: "new@test.dev", password: "short" });
    expect(weak.status).toBe(400);
    const res = await api(token).post("/api/users", { name: "New Person", email: "new@test.dev", password: "Str0ngPass" });
    expect(res.status).toBe(201);
    const newLogin = await request(app).post("/api/auth/login").send({ email: "new@test.dev", password: "Str0ngPass" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.role).toBe("MEMBER");
  });

  it("deactivating a user blocks their login", async () => {
    const { token } = await login("lena@test.dev");
    const users = await api(token).get("/api/users");
    const bob = users.body.users.find((u: { email: string }) => u.email === "bob@test.dev");
    expect((await api(token).patch(`/api/users/${bob.id}`, { active: false })).status).toBe(200);
    const res = await request(app).post("/api/auth/login").send({ email: "bob@test.dev", password: PASSWORD });
    expect(res.status).toBe(401);
  });
});
