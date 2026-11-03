import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { api, login, makeTeam, resetDb } from "./helpers.js";

describe("task management & workflow notifications", () => {
  let team: Awaited<ReturnType<typeof makeTeam>>;
  let leader: ReturnType<typeof api>;
  let alice: ReturnType<typeof api>;
  let bob: ReturnType<typeof api>;

  beforeEach(async () => {
    await resetDb();
    team = await makeTeam();
    leader = api((await login("lena@test.dev")).token);
    alice = api((await login("alice@test.dev")).token);
    bob = api((await login("bob@test.dev")).token);
  });

  const createForAlice = async (extra: object = {}) => {
    const res = await leader.post("/api/tasks", {
      title: "Prepare vendor review",
      description: "Compile KPIs",
      priority: "HIGH",
      dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      assigneeId: team.alice.id,
      ...extra,
    });
    expect(res.status).toBe(201);
    return res.body.task;
  };

  it("assigning a task notifies the assignee in-app and by email", async () => {
    const task = await createForAlice();
    expect(task.assignee.name).toBe("Alice Member");

    const notes = await alice.get("/api/notifications");
    expect(notes.body.unread).toBe(1);
    expect(notes.body.notifications[0]).toMatchObject({ type: "TASK_ASSIGNED", taskId: task.id });

    const emails = await prisma.emailLog.findMany({ where: { to: "alice@test.dev" } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ eventType: "TASK_ASSIGNED", status: "LOGGED" });
    expect(emails[0]!.subject).toContain("Prepare vendor review");
    expect(emails[0]!.html).toContain(`/tasks/${task.id}`);
  });

  it("respects a user's email preference but still notifies in-app", async () => {
    await alice.patch("/api/users/me/profile", { emailNotifications: false });
    await createForAlice();
    expect(await prisma.emailLog.count({ where: { to: "alice@test.dev" } })).toBe(0);
    expect((await alice.get("/api/notifications")).body.unread).toBe(1);
  });

  it("members only see their own tasks", async () => {
    const t = await createForAlice();
    expect((await alice.get("/api/tasks")).body.tasks).toHaveLength(1);
    expect((await bob.get("/api/tasks")).body.tasks).toHaveLength(0);
    expect((await bob.get(`/api/tasks/${t.id}`)).status).toBe(404);
    expect((await leader.get("/api/tasks")).body.tasks).toHaveLength(1);
  });

  it("members can update progress/status but not other fields", async () => {
    const t = await createForAlice();
    expect((await alice.patch(`/api/tasks/${t.id}`, { title: "Hacked" })).status).toBe(403);
    expect((await alice.patch(`/api/tasks/${t.id}`, { assigneeId: team.bob.id })).status).toBe(403);
    expect((await bob.patch(`/api/tasks/${t.id}`, { progress: 50 })).status).toBe(404);

    const res = await alice.patch(`/api/tasks/${t.id}`, { progress: 40 });
    expect(res.status).toBe(200);
    // Progress on a TODO task moves it to IN_PROGRESS automatically.
    expect(res.body.task).toMatchObject({ progress: 40, status: "IN_PROGRESS" });
  });

  it("completing a task stamps completion, logs history and tells the leader", async () => {
    const t = await createForAlice();
    const res = await alice.patch(`/api/tasks/${t.id}`, { status: "DONE" });
    expect(res.body.task.progress).toBe(100);
    expect(res.body.task.completedAt).toBeTruthy();

    const detail = await leader.get(`/api/tasks/${t.id}`);
    const types = detail.body.updates.map((u: { type: string }) => u.type);
    expect(types).toEqual(expect.arrayContaining(["CREATED", "ASSIGNED", "STATUS", "PROGRESS"]));

    const leaderNotes = await prisma.notification.findMany({ where: { userId: team.leader.id } });
    expect(leaderNotes.map((n) => n.type)).toContain("TASK_COMPLETED");
    expect(await prisma.emailLog.count({ where: { to: "lena@test.dev", eventType: "TASK_COMPLETED" } })).toBe(1);
  });

  it("re-assigning notifies the new assignee", async () => {
    const t = await createForAlice();
    await leader.patch(`/api/tasks/${t.id}`, { assigneeId: team.bob.id });
    const bobNotes = await bob.get("/api/notifications");
    expect(bobNotes.body.notifications[0].type).toBe("TASK_ASSIGNED");
    expect((await bob.get("/api/tasks")).body.tasks).toHaveLength(1);
  });

  it("changing the due date re-arms reminder automation", async () => {
    const t = await createForAlice();
    await prisma.task.update({ where: { id: t.id }, data: { reminderSentAt: new Date(), overdueNotifiedAt: new Date() } });
    await leader.patch(`/api/tasks/${t.id}`, { dueDate: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.reminderSentAt).toBeNull();
    expect(row.overdueNotifiedAt).toBeNull();
  });

  it("comments notify the other participants", async () => {
    const t = await createForAlice();
    const res = await alice.post(`/api/tasks/${t.id}/comments`, { body: "Draft is ready for review" });
    expect(res.status).toBe(201);
    const leaderNotes = await prisma.notification.findMany({ where: { userId: team.leader.id, type: "TASK_COMMENT" } });
    expect(leaderNotes).toHaveLength(1);
    expect(leaderNotes[0]!.body).toContain("Draft is ready");
  });

  it("validates input", async () => {
    expect((await leader.post("/api/tasks", { title: "x" })).status).toBe(400);
    expect((await leader.post("/api/tasks", { title: "Valid title", priority: "SUPER" })).status).toBe(400);
    expect((await leader.post("/api/tasks", { title: "Valid title", assigneeId: "nope" })).status).toBe(404);
  });

  it("only leaders can delete", async () => {
    const t = await createForAlice();
    expect((await alice.delete(`/api/tasks/${t.id}`)).status).toBe(403);
    expect((await leader.delete(`/api/tasks/${t.id}`)).status).toBe(204);
  });
});
