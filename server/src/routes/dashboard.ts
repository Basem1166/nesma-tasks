import { Router } from "express";
import { prisma } from "../db.js";
import { isOverdue, TASK_STATUSES } from "../domain.js";
import { auth } from "../lib/http.js";
import { taskInclude, taskScope, toTaskDto } from "../services/tasks.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const user = auth(req);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const tasks = await prisma.task.findMany({ where: taskScope(user), include: taskInclude });
  const open = tasks.filter((t) => t.status !== "DONE");

  const workload = new Map<string, { id: string; name: string; open: number; overdue: number; progressSum: number }>();
  for (const t of open) {
    if (!t.assignee) continue;
    const w = workload.get(t.assignee.id) ?? { id: t.assignee.id, name: t.assignee.name, open: 0, overdue: 0, progressSum: 0 };
    w.open++;
    w.progressSum += t.progress;
    if (isOverdue(t, now)) w.overdue++;
    workload.set(t.assignee.id, w);
  }

  const activity = await prisma.taskUpdate.findMany({
    where: { task: taskScope(user), type: { not: "EDITED" } },
    include: { user: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  res.json({
    stats: {
      total: tasks.length,
      open: open.length,
      overdue: open.filter((t) => isOverdue(t, now)).length,
      dueSoon: open.filter((t) => t.dueDate && t.dueDate >= now && t.dueDate <= soon).length,
      completedThisWeek: tasks.filter((t) => t.completedAt && t.completedAt >= weekAgo).length,
      byStatus: Object.fromEntries(TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s).length])),
    },
    myTasks: open
      .filter((t) => t.assigneeId === user.id)
      .sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity))
      .slice(0, 8)
      .map((t) => toTaskDto(t, now)),
    attention: open
      .filter((t) => isOverdue(t, now) || (t.dueDate && t.dueDate <= soon && t.progress < 50))
      .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
      .slice(0, 8)
      .map((t) => toTaskDto(t, now)),
    workload:
      user.role === "LEADER"
        ? [...workload.values()]
            .map(({ progressSum, ...w }) => ({ ...w, avgProgress: Math.round(progressSum / w.open) }))
            .sort((a, b) => b.open - a.open)
        : [],
    activity,
  });
});
