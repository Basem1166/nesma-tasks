import { prisma } from "../db.js";
import { renderEmail, sendEmail, type TemplateInput } from "./email.js";
import { sendPush } from "./push.js";
import { emitToUser } from "./realtime.js";

export interface Delivery {
  userIds: string[];
  type: string;
  title: string;
  body: string;
  taskId?: string | null;
  /** When set, users with email notifications on also get this email. */
  email?: { subject: string } & TemplateInput;
}

/**
 * Fan-out to every channel: persisted in-app notification, realtime socket
 * event (web + mobile foreground), Expo push (mobile background), and email.
 */
export async function deliver(d: Delivery): Promise<void> {
  const ids = [...new Set(d.userIds)];
  if (ids.length === 0) return;
  const users = await prisma.user.findMany({ where: { id: { in: ids }, active: true } });
  if (users.length === 0) return;

  await Promise.all(
    users.map(async (u) => {
      const n = await prisma.notification.create({
        data: { userId: u.id, type: d.type, title: d.title, body: d.body, taskId: d.taskId ?? null },
      });
      emitToUser(u.id, "notification:new", n);
    }),
  );

  const jobs: Promise<unknown>[] = [
    sendPush(
      users.map((u) => u.id),
      { title: d.title, body: d.body, data: { type: d.type, taskId: d.taskId ?? undefined } },
    ),
  ];
  if (d.email) {
    const { subject, ...template } = d.email;
    const { html, text } = renderEmail(template);
    for (const u of users.filter((u) => u.emailNotifications)) {
      jobs.push(sendEmail({ to: u.email, subject, html, text, eventType: d.type, taskId: d.taskId }));
    }
  }
  await Promise.allSettled(jobs);
}
