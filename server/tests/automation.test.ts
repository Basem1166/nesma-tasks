import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { generateMonthlyReport } from "../src/reports/report.js";
import { runDeadlineChecks } from "../src/services/scheduler.js";
import { makeTeam, resetDb } from "./helpers.js";

const H = 3_600_000;

describe("scheduled automation", () => {
  let team: Awaited<ReturnType<typeof makeTeam>>;

  beforeEach(async () => {
    await resetDb();
    team = await makeTeam();
  });

  const task = (title: string, dueInHours: number, status = "IN_PROGRESS") =>
    prisma.task.create({
      data: {
        title,
        status,
        progress: status === "DONE" ? 100 : 30,
        dueDate: new Date(Date.now() + dueInHours * H),
        teamId: team.team.id,
        assigneeId: team.alice.id,
        createdById: team.leader.id,
      },
    });

  it("sends one due-soon reminder per deadline", async () => {
    const soon = await task("Due tomorrow", 10);
    await task("Due next week", 24 * 7);
    await task("Done already", 5, "DONE");

    expect(await runDeadlineChecks()).toEqual({ reminders: 1, overdue: 0 });
    expect(await runDeadlineChecks()).toEqual({ reminders: 0, overdue: 0 }); // idempotent

    const notes = await prisma.notification.findMany({ where: { userId: team.alice.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: "TASK_DUE_SOON", taskId: soon.id });
    expect(await prisma.emailLog.count({ where: { eventType: "TASK_DUE_SOON", to: "alice@test.dev" } })).toBe(1);
    expect(await prisma.taskUpdate.count({ where: { taskId: soon.id, type: "REMINDER" } })).toBe(1);
  });

  it("flags overdue tasks to the assignee and the team leader once", async () => {
    const late = await task("Late task", -2);
    expect(await runDeadlineChecks()).toEqual({ reminders: 0, overdue: 1 });
    expect(await runDeadlineChecks()).toEqual({ reminders: 0, overdue: 0 });

    const recipients = (await prisma.notification.findMany({ where: { type: "TASK_OVERDUE", taskId: late.id } })).map((n) => n.userId);
    expect(recipients.sort()).toEqual([team.alice.id, team.leader.id].sort());
    const emails = await prisma.emailLog.findMany({ where: { eventType: "TASK_OVERDUE" } });
    expect(emails.map((e) => e.to).sort()).toEqual(["alice@test.dev", "lena@test.dev"]);
    expect(emails[0]!.subject).toContain("OVERDUE");
  });

  it("generates a monthly report from real data and notifies leaders", async () => {
    const start = new Date(Date.UTC(2026, 9, 1));
    await prisma.task.create({
      data: {
        title: "Finished on time",
        status: "DONE",
        progress: 100,
        createdAt: new Date(Date.UTC(2026, 9, 2)),
        dueDate: new Date(Date.UTC(2026, 9, 10)),
        completedAt: new Date(Date.UTC(2026, 9, 9)),
        teamId: team.team.id,
        assigneeId: team.alice.id,
        createdById: team.leader.id,
      },
    });
    // Force the rule-based narrative so the test never calls the real API.
    const { config } = await import("../src/config.js");
    const saved = config.ANTHROPIC_API_KEY;
    config.ANTHROPIC_API_KEY = "";
    try {
      const report = await generateMonthlyReport({ teamId: team.team.id, year: 2026, month: 10 });
      expect(report.periodStart).toEqual(start);
      const metrics = JSON.parse(report.metrics);
      expect(metrics.summary).toMatchObject({ completed: 1, completionRate: 100, onTimeRate: 100 });
      expect(report.narrative).toContain("## Executive summary");
      expect(report.aiGenerated).toBe(false);
      const leaderNote = await prisma.notification.findFirst({ where: { userId: team.leader.id, type: "REPORT_READY" } });
      expect(leaderNote?.title).toContain("October 2026");
    } finally {
      config.ANTHROPIC_API_KEY = saved;
    }
  });
});
