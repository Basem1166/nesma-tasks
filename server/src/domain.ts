// Enum-like values shared by validation, services and the AI tools.

export const ROLES = ["LEADER", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Done",
};

export interface AuthUser {
  id: string;
  role: Role;
  teamId: string;
  name: string;
  email: string;
}

export function isOverdue(task: { dueDate: Date | null; status: string }, now = new Date()): boolean {
  return !!task.dueDate && task.status !== "DONE" && task.dueDate.getTime() < now.getTime();
}
