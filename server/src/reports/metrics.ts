import { prisma } from "../db.js";

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);
const inRange = (d: Date | null, start: Date, end: Date) => !!d && d >= start && d < end;

export interface MetricTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  progress: number;
  createdAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
  assigneeId: string | null;
}

export interface MemberMetrics {
  userId: string;
  name: string;
  workload: number;
  completed: number;
  completedOnTime: number;
  completedLate: number;
  overdueOpen: number;
  completionRate: number;
  onTimeRate: number;
  avgOpenProgress: number;
}

export interface PeriodSummary {
  workload: number;
  created: number;
  completed: number;
  completionRate: number;
  onTimeRate: number;
  completedLate: number;
  overdueOpen: number;
  avgCycleDays: number;
}

export interface TeamMetrics {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: PeriodSummary;
  previous: PeriodSummary;
  byPriority: Record<string, { workload: number; completed: number }>;
  members: MemberMetrics[];
  delays: {
    completedLate: { title: string; assignee: string; daysLate: number; priority: string }[];
    stillOverdue: { title: string; assignee: string; daysOverdue: number; progress: number; priority: string }[];
  };
  achievements: {
    topPerformers: { name: string; completed: number; onTimeRate: number }[];
    highPriorityDelivered: { title: string; assignee: string; priority: string }[];
    perfectOnTime: string[];
  };
}

/**
 * Pure computation over a task list. "Workload" for a period = tasks that were
 * due in the period or completed in it. Completion rate = share of that
 * workload finished by the end of the period. On-time = completed no later
 * than its due date (tasks without a due date count as on time).
 */
export function summarize(tasks: MetricTask[], start: Date, end: Date, now: Date): PeriodSummary {
  const cutoff = end < now ? end : now;
  const workload = tasks.filter((t) => inRange(t.dueDate, start, end) || inRange(t.completedAt, start, end));
  const completed = tasks.filter((t) => inRange(t.completedAt, start, end));
  const late = completed.filter((t) => t.dueDate && t.completedAt! > t.dueDate);
  const overdueOpen = tasks.filter(
    (t) => t.dueDate && t.dueDate < cutoff && t.createdAt < cutoff && (!t.completedAt || t.completedAt > cutoff),
  );
  const cycle = completed.map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / DAY);
  return {
    workload: workload.length,
    created: tasks.filter((t) => inRange(t.createdAt, start, end)).length,
    completed: completed.length,
    completionRate: pct(workload.filter((t) => t.completedAt && t.completedAt < end).length, workload.length),
    onTimeRate: pct(completed.length - late.length, completed.length),
    completedLate: late.length,
    overdueOpen: overdueOpen.length,
    avgCycleDays: cycle.length ? round1(cycle.reduce((a, b) => a + b, 0) / cycle.length) : 0,
  };
}

export function computeMetrics(
  tasks: MetricTask[],
  members: { id: string; name: string }[],
  start: Date,
  end: Date,
  now = new Date(),
): TeamMetrics {
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Unassigned";
  const cutoff = end < now ? end : now;
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));

  const workload = tasks.filter((t) => inRange(t.dueDate, start, end) || inRange(t.completedAt, start, end));
  const completed = tasks.filter((t) => inRange(t.completedAt, start, end));
  const isLate = (t: MetricTask) => !!t.dueDate && !!t.completedAt && t.completedAt > t.dueDate;
  const overdueOpen = tasks.filter(
    (t) => t.dueDate && t.dueDate < cutoff && t.createdAt < cutoff && (!t.completedAt || t.completedAt > cutoff),
  );

  const byPriority: TeamMetrics["byPriority"] = {};
  for (const p of ["URGENT", "HIGH", "MEDIUM", "LOW"]) {
    byPriority[p] = {
      workload: workload.filter((t) => t.priority === p).length,
      completed: completed.filter((t) => t.priority === p).length,
    };
  }

  const memberStats: MemberMetrics[] = members.map((m) => {
    const mine = workload.filter((t) => t.assigneeId === m.id);
    const done = completed.filter((t) => t.assigneeId === m.id);
    const lateCount = done.filter(isLate).length;
    const open = tasks.filter((t) => t.assigneeId === m.id && !t.completedAt && t.createdAt < cutoff);
    return {
      userId: m.id,
      name: m.name,
      workload: mine.length,
      completed: done.length,
      completedOnTime: done.length - lateCount,
      completedLate: lateCount,
      overdueOpen: overdueOpen.filter((t) => t.assigneeId === m.id).length,
      completionRate: pct(mine.filter((t) => t.completedAt && t.completedAt < end).length, mine.length),
      onTimeRate: pct(done.length - lateCount, done.length),
      avgOpenProgress: open.length ? Math.round(open.reduce((a, t) => a + t.progress, 0) / open.length) : 0,
    };
  });

  return {
    periodLabel: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    generatedAt: now.toISOString(),
    summary: summarize(tasks, start, end, now),
    previous: summarize(tasks, prevStart, start, now),
    byPriority,
    members: memberStats,
    delays: {
      completedLate: completed
        .filter(isLate)
        .map((t) => ({
          title: t.title,
          assignee: name(t.assigneeId),
          priority: t.priority,
          daysLate: round1((t.completedAt!.getTime() - t.dueDate!.getTime()) / DAY),
        }))
        .sort((a, b) => b.daysLate - a.daysLate)
        .slice(0, 10),
      stillOverdue: overdueOpen
        .map((t) => ({
          title: t.title,
          assignee: name(t.assigneeId),
          priority: t.priority,
          progress: t.progress,
          daysOverdue: round1((cutoff.getTime() - t.dueDate!.getTime()) / DAY),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue)
        .slice(0, 10),
    },
    achievements: {
      topPerformers: memberStats
        .filter((m) => m.completed > 0)
        .sort((a, b) => b.completed - a.completed || b.onTimeRate - a.onTimeRate)
        .slice(0, 3)
        .map((m) => ({ name: m.name, completed: m.completed, onTimeRate: m.onTimeRate })),
      highPriorityDelivered: completed
        .filter((t) => t.priority === "URGENT" || t.priority === "HIGH")
        .map((t) => ({ title: t.title, assignee: name(t.assigneeId), priority: t.priority }))
        .slice(0, 10),
      perfectOnTime: memberStats.filter((m) => m.completed >= 2 && m.completedLate === 0).map((m) => m.name),
    },
  };
}

export async function loadTeamMetrics(teamId: string, start: Date, end: Date, now = new Date()) {
  const [tasks, members] = await Promise.all([
    prisma.task.findMany({
      where: { teamId, createdAt: { lt: end } },
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        progress: true,
        createdAt: true,
        dueDate: true,
        completedAt: true,
        assigneeId: true,
      },
    }),
    prisma.user.findMany({ where: { teamId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return computeMetrics(tasks, members, start, end, now);
}

export const monthRange = (year: number, month: number) => ({
  start: new Date(Date.UTC(year, month - 1, 1)),
  end: new Date(Date.UTC(year, month, 1)),
});
