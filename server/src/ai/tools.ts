import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { type AuthUser, isOverdue, TASK_PRIORITIES, TASK_STATUSES } from "../domain.js";
import { computeMetrics } from "../reports/metrics.js";
import { taskScope } from "../services/tasks.js";

/**
 * Read-only tools the assistant can call. Every query is built on top of
 * taskScope(user), the same row-level rule the REST API uses, so the chatbot
 * can only ever see what the signed-in user is allowed to see.
 */

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date");

const SearchInput = z.object({
  text: z.string().max(200).optional(),
  status: z.array(z.enum(TASK_STATUSES)).optional(),
  priority: z.array(z.enum(TASK_PRIORITIES)).optional(),
  assignee: z.string().max(100).optional(),
  overdue_only: z.boolean().optional(),
  due_after: isoDate.optional(),
  due_before: isoDate.optional(),
  completed_after: isoDate.optional(),
  completed_before: isoDate.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
const TaskInput = z.object({ task_id: z.string().min(1).max(64) });
const MetricsInput = z.object({ start_date: isoDate, end_date: isoDate });
const ActivityInput = z.object({
  days: z.number().int().min(1).max(60).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const Empty = z.object({}).passthrough();

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_tasks",
    description:
      "Search the tasks the current user can access. All filters are optional and combined with AND. Returns up to `limit` tasks (default 25) with id, title, status, priority, progress, assignee, due date, completion date and an overdue flag, plus the total number of matches. Use this for questions like 'what is overdue', 'what is Sara working on', 'urgent tasks due this week'.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Case-insensitive substring matched against title and description." },
        status: { type: "array", items: { type: "string", enum: [...TASK_STATUSES] } },
        priority: { type: "array", items: { type: "string", enum: [...TASK_PRIORITIES] } },
        assignee: {
          type: "string",
          description: "Assignee name (partial match), 'me' for the current user, or 'unassigned'.",
        },
        overdue_only: { type: "boolean", description: "Only tasks past their due date that are not done." },
        due_after: { type: "string", description: "ISO date; due date on or after." },
        due_before: { type: "string", description: "ISO date; due date before." },
        completed_after: { type: "string", description: "ISO date; completed on or after." },
        completed_before: { type: "string", description: "ISO date; completed before." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "get_task",
    description:
      "Get full details of one task by id, including its description and its activity history (status changes, progress updates, comments, reminders).",
    input_schema: {
      type: "object",
      properties: { task_id: { type: "string" } },
      required: ["task_id"],
    },
  },
  {
    name: "get_team_overview",
    description:
      "Current snapshot of accessible work: counts by status and priority, overdue count, tasks due in the next 7 days, and per-member open/overdue counts with average progress. Use for 'how are we doing', 'who is overloaded', progress analysis.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_period_metrics",
    description:
      "Performance metrics for a date range: workload, completion rate, on-time rate, late completions, overdue at period end, average cycle time, per-member breakdown, delays and achievements. Also returns the same metrics for the preceding calendar month for comparison. Use for monthly/weekly summaries and trend questions.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "ISO date, inclusive." },
        end_date: { type: "string", description: "ISO date, exclusive." },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "list_team_members",
    description: "List the members of the user's team with their role and job title.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_activity",
    description:
      "Recent activity on accessible tasks (newest first): creations, assignments, status and progress changes, comments, reminders and overdue alerts.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 60, description: "Look-back window, default 7." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 40." },
      },
    },
  },
];

const fmt = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function searchTasks(user: AuthUser, raw: unknown) {
  const input = SearchInput.parse(raw);
  const now = new Date();
  const and: Prisma.TaskWhereInput[] = [taskScope(user)];
  if (input.text) and.push({ OR: [{ title: { contains: input.text } }, { description: { contains: input.text } }] });
  if (input.status?.length) and.push({ status: { in: input.status } });
  if (input.priority?.length) and.push({ priority: { in: input.priority } });
  if (input.assignee) {
    const a = input.assignee.trim().toLowerCase();
    if (a === "me") and.push({ assigneeId: user.id });
    else if (a === "unassigned") and.push({ assigneeId: null });
    else {
      // SQLite `contains` is case-sensitive for non-ASCII; match names in JS for robustness.
      const team = await prisma.user.findMany({ where: { teamId: user.teamId }, select: { id: true, name: true } });
      and.push({ assigneeId: { in: team.filter((m) => m.name.toLowerCase().includes(a)).map((m) => m.id) } });
    }
  }
  if (input.overdue_only) and.push({ status: { not: "DONE" }, dueDate: { lt: now } });
  if (input.due_after) and.push({ dueDate: { gte: new Date(input.due_after) } });
  if (input.due_before) and.push({ dueDate: { lt: new Date(input.due_before) } });
  if (input.completed_after) and.push({ completedAt: { gte: new Date(input.completed_after) } });
  if (input.completed_before) and.push({ completedAt: { lt: new Date(input.completed_before) } });

  const where = { AND: and };
  const [total, tasks] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: { assignee: { select: { name: true } } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: input.limit ?? 25,
    }),
  ]);
  return {
    total_matches: total,
    returned: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      assignee: t.assignee?.name ?? null,
      due: fmt(t.dueDate),
      completed: fmt(t.completedAt),
      overdue: isOverdue(t, now),
    })),
  };
}

async function getTask(user: AuthUser, raw: unknown) {
  const { task_id } = TaskInput.parse(raw);
  const t = await prisma.task.findFirst({
    where: { AND: [{ id: task_id }, taskScope(user)] },
    include: {
      assignee: { select: { name: true } },
      createdBy: { select: { name: true } },
      updates: { orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
    },
  });
  if (!t) return { error: "Task not found or not accessible to this user." };
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    progress: t.progress,
    assignee: t.assignee?.name ?? null,
    created_by: t.createdBy.name,
    created: fmt(t.createdAt),
    due: fmt(t.dueDate),
    completed: fmt(t.completedAt),
    overdue: isOverdue(t),
    activity: t.updates.map((u) => ({
      at: fmt(u.createdAt),
      by: u.user?.name ?? "system",
      type: u.type,
      message: u.message,
    })),
  };
}

async function teamOverview(user: AuthUser) {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const tasks = await prisma.task.findMany({ where: taskScope(user), include: { assignee: { select: { id: true, name: true } } } });
  const open = tasks.filter((t) => t.status !== "DONE");
  const count = <K extends string>(keys: readonly K[], f: (k: K) => number) =>
    Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<K, number>;
  const people = new Map<string, { name: string; open: number; overdue: number; progressSum: number }>();
  for (const t of open) {
    const key = t.assignee?.id ?? "unassigned";
    const p = people.get(key) ?? { name: t.assignee?.name ?? "Unassigned", open: 0, overdue: 0, progressSum: 0 };
    p.open++;
    p.progressSum += t.progress;
    if (isOverdue(t, now)) p.overdue++;
    people.set(key, p);
  }
  return {
    as_of: now.toISOString(),
    scope: user.role === "LEADER" ? "whole team" : "tasks assigned to or created by the user",
    total_tasks: tasks.length,
    by_status: count(TASK_STATUSES, (s) => tasks.filter((t) => t.status === s).length),
    open_by_priority: count(TASK_PRIORITIES, (p) => open.filter((t) => t.priority === p).length),
    overdue: open.filter((t) => isOverdue(t, now)).length,
    due_next_7_days: open
      .filter((t) => t.dueDate && t.dueDate >= now && t.dueDate < week)
      .map((t) => ({ id: t.id, title: t.title, due: fmt(t.dueDate), assignee: t.assignee?.name ?? null, progress: t.progress })),
    per_member: [...people.values()].map((p) => ({
      name: p.name,
      open: p.open,
      overdue: p.overdue,
      avg_progress: Math.round(p.progressSum / p.open),
    })),
  };
}

async function periodMetrics(user: AuthUser, raw: unknown) {
  const input = MetricsInput.parse(raw);
  const start = new Date(input.start_date);
  const end = new Date(input.end_date);
  if (end <= start) return { error: "end_date must be after start_date" };
  const [tasks, members] = await Promise.all([
    prisma.task.findMany({ where: { AND: [taskScope(user), { createdAt: { lt: end } }] } }),
    prisma.user.findMany({
      where: user.role === "LEADER" ? { teamId: user.teamId } : { id: user.id },
      select: { id: true, name: true },
    }),
  ]);
  const m = computeMetrics(tasks, members, start, end);
  return { ...m, periodLabel: `${input.start_date} to ${input.end_date}` };
}

async function listMembers(user: AuthUser) {
  const members = await prisma.user.findMany({
    where: { teamId: user.teamId, active: true },
    select: { name: true, role: true, title: true },
    orderBy: { name: "asc" },
  });
  return { members };
}

async function recentActivity(user: AuthUser, raw: unknown) {
  const input = ActivityInput.parse(raw);
  const since = new Date(Date.now() - (input.days ?? 7) * 86_400_000);
  const updates = await prisma.taskUpdate.findMany({
    where: { createdAt: { gte: since }, task: taskScope(user) },
    include: { user: { select: { name: true } }, task: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 40,
  });
  return {
    since: since.toISOString(),
    events: updates.map((u) => ({
      at: fmt(u.createdAt),
      task_id: u.task.id,
      task: u.task.title,
      by: u.user?.name ?? "system",
      type: u.type,
      message: u.message,
    })),
  };
}

const EXECUTORS: Record<string, (user: AuthUser, input: unknown) => Promise<unknown>> = {
  search_tasks: searchTasks,
  get_task: getTask,
  get_team_overview: (u, i) => (Empty.parse(i ?? {}), teamOverview(u)),
  get_period_metrics: periodMetrics,
  list_team_members: (u, i) => (Empty.parse(i ?? {}), listMembers(u)),
  get_recent_activity: recentActivity,
};

/** Runs one tool call. Errors are returned to the model as is_error results, never thrown. */
export async function executeTool(
  user: AuthUser,
  name: string,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const fn = EXECUTORS[name];
  if (!fn) return { content: `Unknown tool: ${name}`, isError: true };
  try {
    return { content: JSON.stringify(await fn(user, input)), isError: false };
  } catch (e) {
    if (e instanceof z.ZodError) {
      return {
        content: `Invalid input: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        isError: true,
      };
    }
    console.error(`[ai] tool ${name} failed:`, e);
    return { content: "The tool failed due to an internal error.", isError: true };
  }
}
