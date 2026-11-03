import type { Report, Task } from "@prisma/client";
import type { AuthUser, TaskStatus } from "../domain.js";

/**
 * Every workflow-relevant fact in the system is published here. Routes and the
 * scheduler only *emit*; the workflow module (services/workflow.ts) decides who
 * is told, through which channels (in-app, realtime, push, email).
 */
export interface DomainEvents {
  "task.created": { task: Task; actor: AuthUser };
  "task.assigned": { task: Task; actor: AuthUser; previousAssigneeId: string | null };
  "task.updated": { task: Task; actor: AuthUser; changes: string[] };
  "task.status_changed": { task: Task; actor: AuthUser; from: TaskStatus; to: TaskStatus };
  "task.progress": { task: Task; actor: AuthUser; from: number; to: number };
  "task.commented": { task: Task; actor: AuthUser; comment: string };
  "task.deleted": { task: Task; actor: AuthUser };
  "task.due_soon": { task: Task };
  "task.overdue": { task: Task };
  "report.generated": { report: Report };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

class EventBus {
  private handlers = new Map<keyof DomainEvents, Handler<any>[]>();

  on<K extends keyof DomainEvents>(event: K, handler: Handler<K>) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  /**
   * Runs all handlers and resolves when they have settled. A failing handler
   * (e.g. SMTP down) is logged and never breaks the request that emitted.
   */
  async emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): Promise<void> {
    const list = this.handlers.get(event) ?? [];
    const results = await Promise.allSettled(list.map((h) => h(payload)));
    for (const r of results) {
      if (r.status === "rejected") console.error(`[events] handler for ${event} failed:`, r.reason);
    }
  }

  clear() {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
