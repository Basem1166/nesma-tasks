import { prisma } from "../db.js";
import { STATUS_LABEL, type TaskStatus } from "../domain.js";
import { bus } from "./events.js";
import { deliver } from "./notify.js";
import { emitToUser } from "./realtime.js";
import { fmtDate, teamLeaderIds, type Task } from "./tasks.js";

/**
 * The automation rules. Each domain event is mapped to: who must know, the
 * in-app/push message, and the email. Keeping this in one place makes the
 * workflow (docs/WORKFLOW.md) auditable.
 */

const taskPath = (t: Task) => `/tasks/${t.id}`;
const others = (ids: (string | null | undefined)[], actorId?: string) =>
  [...new Set(ids.filter((id): id is string => !!id && id !== actorId))];

/** Everyone who should see a task change live: assignee, creator, leaders. */
async function syncTask(task: Task, action: string) {
  const audience = others([task.assigneeId, task.createdById, ...(await teamLeaderIds(task.teamId))]);
  for (const id of audience) emitToUser(id, "task:changed", { taskId: task.id, action });
}

export function registerWorkflow() {
  bus.on("task.created", ({ task }) => syncTask(task, "created"));

  bus.on("task.assigned", async ({ task, actor }) => {
    await syncTask(task, "assigned");
    if (!task.assigneeId || task.assigneeId === actor.id) return;
    await deliver({
      userIds: [task.assigneeId],
      type: "TASK_ASSIGNED",
      title: "New task assigned",
      body: `${actor.name} assigned you "${task.title}"`,
      taskId: task.id,
      email: {
        subject: `[Nesma] New task: ${task.title}`,
        heading: "You have a new task",
        intro: `${actor.name} assigned you a task.`,
        rows: [
          ["Task", task.title],
          ["Priority", task.priority],
          ["Due", fmtDate(task.dueDate)],
          ...(task.description ? ([["Details", task.description.slice(0, 400)]] as [string, string][]) : []),
        ],
        ctaLabel: "Open task",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("task.updated", async ({ task, actor, changes }) => {
    await syncTask(task, "updated");
    const recipients = others([task.assigneeId, task.createdById], actor.id);
    await deliver({
      userIds: recipients,
      type: "TASK_UPDATED",
      title: "Task updated",
      body: `${actor.name} updated "${task.title}": ${changes.join(", ")}`,
      taskId: task.id,
      email: {
        subject: `[Nesma] Updated: ${task.title}`,
        heading: "A task you follow was updated",
        intro: `${actor.name} changed ${changes.join(", ")}.`,
        rows: [
          ["Task", task.title],
          ["Status", STATUS_LABEL[task.status as TaskStatus]],
          ["Priority", task.priority],
          ["Due", fmtDate(task.dueDate)],
        ],
        ctaLabel: "Open task",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("task.status_changed", async ({ task, actor, from, to }) => {
    await syncTask(task, "status");
    const leaders = await teamLeaderIds(task.teamId);
    const recipients = others([task.assigneeId, task.createdById, ...(to === "DONE" ? leaders : [])], actor.id);
    const done = to === "DONE";
    await deliver({
      userIds: recipients,
      type: done ? "TASK_COMPLETED" : "TASK_STATUS",
      title: done ? "Task completed" : "Task status changed",
      body: `${actor.name} moved "${task.title}" from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}`,
      taskId: task.id,
      email: {
        subject: done ? `[Nesma] Completed: ${task.title}` : `[Nesma] ${STATUS_LABEL[to]}: ${task.title}`,
        heading: done ? "Task completed" : "Task status changed",
        intro: `${actor.name} moved this task from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`,
        rows: [
          ["Task", task.title],
          ["Progress", `${task.progress}%`],
          ["Due", fmtDate(task.dueDate)],
        ],
        ctaLabel: "Open task",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("task.progress", async ({ task, actor, from, to }) => {
    await syncTask(task, "progress");
    // Progress ticks are frequent: in-app + push only, no email.
    await deliver({
      userIds: others([task.createdById], actor.id),
      type: "TASK_PROGRESS",
      title: "Progress update",
      body: `${actor.name} moved "${task.title}" from ${from}% to ${to}%`,
      taskId: task.id,
    });
  });

  bus.on("task.commented", async ({ task, actor, comment }) => {
    await syncTask(task, "comment");
    await deliver({
      userIds: others([task.assigneeId, task.createdById], actor.id),
      type: "TASK_COMMENT",
      title: `New comment on "${task.title}"`,
      body: `${actor.name}: ${comment.slice(0, 140)}`,
      taskId: task.id,
      email: {
        subject: `[Nesma] Comment on: ${task.title}`,
        heading: "New comment",
        intro: `${actor.name} commented: "${comment.slice(0, 500)}"`,
        rows: [["Task", task.title]],
        ctaLabel: "Reply",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("task.deleted", async ({ task, actor }) => {
    for (const id of others([task.assigneeId, task.createdById, ...(await teamLeaderIds(task.teamId))])) {
      emitToUser(id, "task:changed", { taskId: task.id, action: "deleted" });
    }
    if (task.assigneeId && task.assigneeId !== actor.id) {
      await deliver({
        userIds: [task.assigneeId],
        type: "TASK_DELETED",
        title: "Task removed",
        body: `${actor.name} removed "${task.title}"`,
      });
    }
  });

  bus.on("task.due_soon", async ({ task }) => {
    if (!task.assigneeId) return;
    await prisma.taskUpdate.create({
      data: { taskId: task.id, type: "REMINDER", message: `Deadline reminder sent (due ${fmtDate(task.dueDate)})` },
    });
    await deliver({
      userIds: [task.assigneeId],
      type: "TASK_DUE_SOON",
      title: "Deadline approaching",
      body: `"${task.title}" is due ${fmtDate(task.dueDate)} (${task.progress}% done)`,
      taskId: task.id,
      email: {
        subject: `[Nesma] Due soon: ${task.title}`,
        heading: "Deadline approaching",
        intro: "This task is due soon and is not finished yet.",
        rows: [
          ["Task", task.title],
          ["Due", fmtDate(task.dueDate)],
          ["Progress", `${task.progress}%`],
          ["Status", STATUS_LABEL[task.status as TaskStatus]],
        ],
        ctaLabel: "Update progress",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("task.overdue", async ({ task }) => {
    await prisma.taskUpdate.create({
      data: { taskId: task.id, type: "OVERDUE", message: `Task became overdue (was due ${fmtDate(task.dueDate)})` },
    });
    await syncTask(task, "overdue");
    const leaders = await teamLeaderIds(task.teamId);
    const assignee = task.assigneeId
      ? await prisma.user.findUnique({ where: { id: task.assigneeId }, select: { name: true } })
      : null;
    await deliver({
      userIds: others([task.assigneeId, ...leaders]),
      type: "TASK_OVERDUE",
      title: "Task overdue",
      body: `"${task.title}" passed its deadline${assignee ? ` (assigned to ${assignee.name})` : ""}`,
      taskId: task.id,
      email: {
        subject: `[Nesma] OVERDUE: ${task.title}`,
        heading: "Task is overdue",
        intro: "This task passed its deadline without being completed.",
        rows: [
          ["Task", task.title],
          ["Assignee", assignee?.name ?? "Unassigned"],
          ["Was due", fmtDate(task.dueDate)],
          ["Progress", `${task.progress}%`],
        ],
        ctaLabel: "Open task",
        ctaPath: taskPath(task),
      },
    });
  });

  bus.on("report.generated", async ({ report }) => {
    const leaders = await teamLeaderIds(report.teamId);
    const metrics = JSON.parse(report.metrics) as { periodLabel: string; summary: { completionRate: number; completed: number; overdueOpen: number } };
    await deliver({
      userIds: leaders,
      type: "REPORT_READY",
      title: `Monthly report ready: ${metrics.periodLabel}`,
      body: `Completion rate ${metrics.summary.completionRate}% · ${metrics.summary.completed} tasks completed`,
      email: {
        subject: `[Nesma] Team report for ${metrics.periodLabel}`,
        heading: `Your ${metrics.periodLabel} team report is ready`,
        intro: report.aiGenerated
          ? `AI (${report.model}) analysed this month's task data and wrote a performance report.`
          : "A performance report was generated from this month's task data.",
        rows: [
          ["Completion rate", `${metrics.summary.completionRate}%`],
          ["Tasks completed", String(metrics.summary.completed)],
          ["Still overdue", String(metrics.summary.overdueOpen)],
        ],
        ctaLabel: "Read the report",
        ctaPath: `/reports/${report.id}`,
      },
    });
  });
}
