import type { Prisma, Task, User } from "@prisma/client";
import { prisma } from "../db.js";
import { type AuthUser, isOverdue } from "../domain.js";
import { forbidden, notFound } from "../lib/http.js";

export const taskInclude = {
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithPeople = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function toTaskDto(t: TaskWithPeople, now = new Date()) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    teamId: t.teamId,
    assignee: t.assignee,
    createdBy: t.createdBy,
    overdue: isOverdue(t, now),
  };
}

/**
 * Row-level access rule, used by REST routes *and* the AI chatbot tools so the
 * assistant can never reveal data the user could not open themselves.
 * Leaders see every task in their team; members see tasks assigned to them or
 * created by them.
 */
export function taskScope(user: AuthUser): Prisma.TaskWhereInput {
  if (user.role === "LEADER") return { teamId: user.teamId };
  return { teamId: user.teamId, OR: [{ assigneeId: user.id }, { createdById: user.id }] };
}

export async function getVisibleTask(user: AuthUser, id: string): Promise<TaskWithPeople> {
  const task = await prisma.task.findFirst({ where: { AND: [{ id }, taskScope(user)] }, include: taskInclude });
  if (!task) throw notFound("Task");
  return task;
}

export async function assertAssignable(user: AuthUser, assigneeId: string | null | undefined): Promise<User | null> {
  if (!assigneeId) return null;
  const assignee = await prisma.user.findFirst({ where: { id: assigneeId, teamId: user.teamId, active: true } });
  if (!assignee) throw notFound("Assignee");
  if (user.role !== "LEADER" && assignee.id !== user.id) throw forbidden("Members can only assign tasks to themselves");
  return assignee;
}

export const teamLeaderIds = async (teamId: string) =>
  (await prisma.user.findMany({ where: { teamId, role: "LEADER", active: true }, select: { id: true } })).map(
    (u) => u.id,
  );

export const fmtDate = (d: Date | null) =>
  d ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "No deadline";

export type { Task };
