import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES, type TaskStatus } from "../domain.js";
import { auth, forbidden, parse } from "../lib/http.js";
import { bus } from "../services/events.js";
import { assertAssignable, getVisibleTask, taskInclude, taskScope, toTaskDto } from "../services/tasks.js";

export const tasksRouter = Router();

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const ListQuery = z.object({
  status: csv(TASK_STATUSES),
  priority: csv(TASK_PRIORITIES),
  assigneeId: z.string().optional(),
  q: z.string().max(200).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  mine: z.enum(["true", "false"]).optional(),
  sort: z.enum(["due", "priority", "updated", "created"]).default("due"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

tasksRouter.get("/", async (req, res) => {
  const user = auth(req);
  const q = parse(ListQuery, req.query);
  const and: Prisma.TaskWhereInput[] = [taskScope(user)];
  if (q.status) and.push({ status: { in: q.status } });
  if (q.priority) and.push({ priority: { in: q.priority } });
  if (q.assigneeId) and.push({ assigneeId: q.assigneeId === "none" ? null : q.assigneeId });
  if (q.mine === "true") and.push({ assigneeId: user.id });
  if (q.q) and.push({ OR: [{ title: { contains: q.q } }, { description: { contains: q.q } }] });
  if (q.overdue === "true") and.push({ status: { not: "DONE" }, dueDate: { lt: new Date() } });

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    q.sort === "updated"
      ? [{ updatedAt: "desc" }]
      : q.sort === "created"
        ? [{ createdAt: "desc" }]
        : [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
  let tasks = await prisma.task.findMany({ where: { AND: and }, include: taskInclude, orderBy, take: q.limit });
  if (q.sort === "priority") {
    tasks = tasks.sort((a, b) => PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]!);
  }
  const now = new Date();
  res.json({ tasks: tasks.map((t) => toTaskDto(t, now)) });
});

const dueDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date")
  .transform((s) => new Date(s))
  .nullable();

const CreateBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).default(""),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  dueDate: dueDate.optional(),
  assigneeId: z.string().nullable().optional(),
});

tasksRouter.post("/", async (req, res) => {
  const user = auth(req);
  const body = parse(CreateBody, req.body);
  // Members may only create tasks for themselves.
  const assigneeId = user.role === "LEADER" ? (body.assigneeId ?? null) : user.id;
  const assignee = await assertAssignable(user, assigneeId);

  const task = await prisma.task.create({
    data: {
      title: body.title,
      description: body.description,
      priority: body.priority,
      dueDate: body.dueDate ?? null,
      teamId: user.teamId,
      createdById: user.id,
      assigneeId: assignee?.id ?? null,
      updates: {
        create: [
          { userId: user.id, type: "CREATED", message: `${user.name} created the task` },
          ...(assignee
            ? [{ userId: user.id, type: "ASSIGNED", message: `Assigned to ${assignee.name}`, toValue: assignee.id }]
            : []),
        ],
      },
    },
    include: taskInclude,
  });

  await bus.emit("task.created", { task, actor: user });
  if (assignee) await bus.emit("task.assigned", { task, actor: user, previousAssigneeId: null });
  res.status(201).json({ task: toTaskDto(task) });
});

tasksRouter.get("/:id", async (req, res) => {
  const user = auth(req);
  const task = await getVisibleTask(user, req.params.id as string);
  const updates = await prisma.taskUpdate.findMany({
    where: { taskId: task.id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ task: toTaskDto(task), updates });
});

const UpdateBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().max(5000),
    priority: z.enum(TASK_PRIORITIES),
    dueDate,
    assigneeId: z.string().nullable(),
    status: z.enum(TASK_STATUSES),
    progress: z.number().int().min(0).max(100),
  })
  .partial();

const MEMBER_EDITABLE = new Set(["status", "progress"]);

tasksRouter.patch("/:id", async (req, res) => {
  const user = auth(req);
  const body = parse(UpdateBody, req.body);
  const before = await getVisibleTask(user, req.params.id as string);

  if (user.role !== "LEADER") {
    const illegal = Object.keys(body).filter((k) => !MEMBER_EDITABLE.has(k));
    if (illegal.length) throw forbidden(`Members can only update status and progress (not ${illegal.join(", ")})`);
    if (before.assigneeId !== user.id && before.createdById !== user.id) throw forbidden();
  }

  const data: Prisma.TaskUncheckedUpdateInput = {};
  const log: Prisma.TaskUpdateCreateManyInput[] = [];
  const changes: string[] = [];
  const entry = (type: string, message: string, fromValue?: string | null, toValue?: string | null) =>
    log.push({ taskId: before.id, userId: user.id, type, message, fromValue, toValue });

  for (const field of ["title", "description", "priority"] as const) {
    if (body[field] !== undefined && body[field] !== before[field]) {
      data[field] = body[field];
      changes.push(field);
      entry("EDITED", field === "description" ? "Updated the description" : `Changed ${field} to "${body[field]}"`, before[field], body[field]);
    }
  }

  if (body.dueDate !== undefined && body.dueDate?.getTime() !== before.dueDate?.getTime()) {
    data.dueDate = body.dueDate;
    // New deadline: allow the reminder/overdue automations to fire again.
    data.reminderSentAt = null;
    data.overdueNotifiedAt = null;
    changes.push("due date");
    entry("EDITED", body.dueDate ? `Changed due date to ${body.dueDate.toISOString().slice(0, 10)}` : "Removed the due date", before.dueDate?.toISOString(), body.dueDate?.toISOString());
  }

  let newAssignee: Awaited<ReturnType<typeof assertAssignable>> = null;
  const reassigned = body.assigneeId !== undefined && body.assigneeId !== before.assigneeId;
  if (reassigned) {
    newAssignee = await assertAssignable(user, body.assigneeId);
    data.assigneeId = newAssignee?.id ?? null;
    entry("ASSIGNED", newAssignee ? `Assigned to ${newAssignee.name}` : "Unassigned", before.assigneeId, newAssignee?.id ?? null);
  }

  // Status and progress are kept consistent with each other.
  let status = (body.status ?? before.status) as TaskStatus;
  let progress = body.progress ?? before.progress;
  if (body.status === "DONE") progress = 100;
  if (body.status === undefined && body.progress !== undefined) {
    if (progress > 0 && status === "TODO") status = "IN_PROGRESS";
  }
  if (body.status && body.status !== "DONE" && before.status === "DONE" && body.progress === undefined) {
    progress = Math.min(progress, 90);
  }
  const statusChanged = status !== before.status;
  const progressChanged = progress !== before.progress;
  if (statusChanged) {
    data.status = status;
    data.completedAt = status === "DONE" ? new Date() : null;
    entry("STATUS", `Moved from ${STATUS_LABEL[before.status as TaskStatus]} to ${STATUS_LABEL[status]}`, before.status, status);
  }
  if (progressChanged) {
    data.progress = progress;
    entry("PROGRESS", `Progress ${before.progress}% → ${progress}%`, String(before.progress), String(progress));
  }

  if (Object.keys(data).length === 0) {
    res.json({ task: toTaskDto(before) });
    return;
  }

  const [task] = await prisma.$transaction([
    prisma.task.update({ where: { id: before.id }, data, include: taskInclude }),
    prisma.taskUpdate.createMany({ data: log }),
  ]);

  if (reassigned) await bus.emit("task.assigned", { task, actor: user, previousAssigneeId: before.assigneeId });
  if (statusChanged) await bus.emit("task.status_changed", { task, actor: user, from: before.status as TaskStatus, to: status });
  else if (progressChanged) await bus.emit("task.progress", { task, actor: user, from: before.progress, to: progress });
  if (changes.length) await bus.emit("task.updated", { task, actor: user, changes });

  res.json({ task: toTaskDto(task) });
});

tasksRouter.delete("/:id", requireRole("LEADER"), async (req, res) => {
  const user = auth(req);
  const task = await getVisibleTask(user, req.params.id as string);
  await prisma.task.delete({ where: { id: task.id } });
  await bus.emit("task.deleted", { task, actor: user });
  res.status(204).end();
});

const CommentBody = z.object({ body: z.string().trim().min(1).max(2000) });

tasksRouter.post("/:id/comments", async (req, res) => {
  const user = auth(req);
  const { body } = parse(CommentBody, req.body);
  const task = await getVisibleTask(user, req.params.id as string);
  const update = await prisma.taskUpdate.create({
    data: { taskId: task.id, userId: user.id, type: "COMMENT", message: body },
    include: { user: { select: { id: true, name: true } } },
  });
  await bus.emit("task.commented", { task, actor: user, comment: body });
  res.status(201).json({ update });
});
