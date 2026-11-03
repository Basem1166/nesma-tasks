import bcrypt from "bcryptjs";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import type { AuthUser, Role } from "../src/domain.js";
import { bus } from "../src/services/events.js";
import { registerWorkflow } from "../src/services/workflow.js";

export const PASSWORD = "Passw0rd!";
let hash: string | null = null;

export const app = createApp();
bus.clear();
registerWorkflow();

export async function resetDb() {
  await prisma.$transaction([
    prisma.aiMessage.deleteMany(),
    prisma.aiConversation.deleteMany(),
    prisma.report.deleteMany(),
    prisma.message.deleteMany(),
    prisma.channel.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.taskUpdate.deleteMany(),
    prisma.task.deleteMany(),
    prisma.emailLog.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.team.deleteMany(),
  ]);
}

export async function makeTeam() {
  hash ??= await bcrypt.hash(PASSWORD, 4);
  const team = await prisma.team.create({ data: { name: "Test team" } });
  const mk = (name: string, email: string, role: Role) =>
    prisma.user.create({ data: { name, email, role, passwordHash: hash!, teamId: team.id } });
  const leader = await mk("Lena Leader", "lena@test.dev", "LEADER");
  const alice = await mk("Alice Member", "alice@test.dev", "MEMBER");
  const bob = await mk("Bob Member", "bob@test.dev", "MEMBER");
  return { team, leader, alice, bob };
}

export const asAuth = (u: { id: string; role: string; teamId: string; name: string; email: string }): AuthUser => ({
  id: u.id,
  role: u.role as Role,
  teamId: u.teamId,
  name: u.name,
  email: u.email,
});

export async function login(email: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password: PASSWORD, client: "mobile" });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

export const api = (token: string) => ({
  get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
  post: (url: string, body?: object) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body ?? {}),
  patch: (url: string, body: object) => request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body),
  delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
});
