import cron from "node-cron";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { generateMonthlyReport } from "../reports/report.js";
import { bus } from "./events.js";

/**
 * Deadline automation. Each task gets at most one "due soon" reminder and one
 * "overdue" alert per deadline: the flag is claimed with a conditional update
 * so concurrent runs (or several server instances) never double-send.
 * Changing a task's due date clears both flags (see routes/tasks.ts).
 */
export async function runDeadlineChecks(now = new Date()) {
  const windowEnd = new Date(now.getTime() + config.REMINDER_WINDOW_HOURS * 3_600_000);
  let reminders = 0;
  let overdue = 0;

  const dueSoon = await prisma.task.findMany({
    where: { status: { not: "DONE" }, reminderSentAt: null, dueDate: { gt: now, lte: windowEnd } },
  });
  for (const task of dueSoon) {
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count === 1) {
      reminders++;
      await bus.emit("task.due_soon", { task: { ...task, reminderSentAt: now } });
    }
  }

  const late = await prisma.task.findMany({
    where: { status: { not: "DONE" }, overdueNotifiedAt: null, dueDate: { lte: now } },
  });
  for (const task of late) {
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, overdueNotifiedAt: null },
      data: { overdueNotifiedAt: now },
    });
    if (claimed.count === 1) {
      overdue++;
      await bus.emit("task.overdue", { task: { ...task, overdueNotifiedAt: now } });
    }
  }
  return { reminders, overdue };
}

/** Generates last month's report for every team (idempotent per team+month). */
export async function runMonthlyReports(now = new Date()) {
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based previous month
  const teams = await prisma.team.findMany();
  for (const team of teams) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const exists = await prisma.report.findFirst({ where: { teamId: team.id, periodStart: start } });
    if (exists) continue;
    try {
      await generateMonthlyReport({ teamId: team.id, year, month });
    } catch (e) {
      console.error(`[scheduler] monthly report for team ${team.id} failed:`, e);
    }
  }
}

export function startScheduler() {
  cron.schedule(config.CRON_DEADLINE_CHECK, () => {
    runDeadlineChecks()
      .then((r) => (r.reminders || r.overdue) && console.log(`[scheduler] reminders=${r.reminders} overdue=${r.overdue}`))
      .catch((e) => console.error("[scheduler] deadline check failed:", e));
  });
  cron.schedule(config.CRON_MONTHLY_REPORT, () => {
    runMonthlyReports().catch((e) => console.error("[scheduler] monthly reports failed:", e));
  });
  // Catch up immediately on boot so nothing is missed while the server was down.
  void runDeadlineChecks().catch((e) => console.error("[scheduler] initial deadline check failed:", e));
  console.log(`[scheduler] deadline checks "${config.CRON_DEADLINE_CHECK}", monthly reports "${config.CRON_MONTHLY_REPORT}"`);
}
