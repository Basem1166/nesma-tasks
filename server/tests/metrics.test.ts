import { describe, expect, it } from "vitest";
import { computeMetrics, type MetricTask } from "../src/reports/metrics.js";

const d = (day: number, month = 10) => new Date(Date.UTC(2026, month - 1, day, 12));
let n = 0;
const t = (over: Partial<MetricTask>): MetricTask => ({
  id: `t${++n}`,
  title: `Task ${n}`,
  priority: "MEDIUM",
  status: "TODO",
  progress: 0,
  createdAt: d(1),
  dueDate: null,
  completedAt: null,
  assigneeId: "a",
  ...over,
});

describe("report metrics", () => {
  const members = [
    { id: "a", name: "Alice" },
    { id: "b", name: "Bob" },
  ];
  const start = new Date(Date.UTC(2026, 9, 1));
  const end = new Date(Date.UTC(2026, 10, 1));
  const now = new Date(Date.UTC(2026, 10, 2));

  const tasks = [
    t({ dueDate: d(10), completedAt: d(9), status: "DONE", priority: "URGENT" }), // on time
    t({ dueDate: d(12), completedAt: d(15), status: "DONE" }), // 3 days late
    t({ dueDate: d(20), status: "IN_PROGRESS", progress: 40, assigneeId: "b" }), // overdue at end
    t({ dueDate: d(5, 11), status: "TODO", assigneeId: "b" }), // due next month: not in workload
    t({ dueDate: d(25, 9), completedAt: d(3), status: "DONE", createdAt: d(1, 9) }), // late, completed in Oct
  ];
  const m = computeMetrics(tasks, members, start, end, now);

  it("computes the period summary", () => {
    expect(m.periodLabel).toBe("October 2026");
    expect(m.summary.workload).toBe(4);
    expect(m.summary.completed).toBe(3);
    expect(m.summary.completionRate).toBe(75);
    expect(m.summary.completedLate).toBe(2);
    expect(m.summary.onTimeRate).toBe(33.3);
    expect(m.summary.overdueOpen).toBe(1);
  });

  it("breaks results down per member", () => {
    const alice = m.members.find((x) => x.name === "Alice")!;
    const bob = m.members.find((x) => x.name === "Bob")!;
    expect(alice).toMatchObject({ completed: 3, completedLate: 2, overdueOpen: 0, completionRate: 100 });
    expect(bob).toMatchObject({ completed: 0, overdueOpen: 1, completionRate: 0, avgOpenProgress: 20 });
  });

  it("lists delays and achievements", () => {
    expect(m.delays.completedLate[0]).toMatchObject({ assignee: "Alice", daysLate: 8 });
    expect(m.delays.stillOverdue).toHaveLength(1);
    expect(m.delays.stillOverdue[0]).toMatchObject({ assignee: "Bob", progress: 40, daysOverdue: 11.5 });
    expect(m.achievements.topPerformers[0]).toMatchObject({ name: "Alice", completed: 3 });
    expect(m.achievements.highPriorityDelivered.map((x) => x.priority)).toEqual(["URGENT"]);
  });
});
