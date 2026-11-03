import { Router } from "express";
import { AI_MODEL, aiProvider, isAiConfigured } from "../ai/client.js";
import { prisma } from "../db.js";
import { auth } from "../lib/http.js";
import { emailMode } from "../services/email.js";
import { runDeadlineChecks } from "../services/scheduler.js";

/** Leader-only operational endpoints (mounted behind requireRole in app.ts). */
export const systemRouter = Router();

systemRouter.get("/status", async (_req, res) => {
  const [emails, push] = await Promise.all([prisma.emailLog.count(), prisma.pushToken.count()]);
  res.json({
    ai: { configured: isAiConfigured(), provider: aiProvider(), model: AI_MODEL() },
    email: { mode: emailMode(), logged: emails },
    push: { registeredDevices: push },
  });
});

/** Email outbox / audit log, limited to recipients in the leader's team. */
systemRouter.get("/emails", async (req, res) => {
  const team = await prisma.user.findMany({ where: { teamId: auth(req).teamId }, select: { email: true } });
  const emails = await prisma.emailLog.findMany({
    where: { to: { in: team.map((u) => u.email) } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ emails });
});

/** Runs the deadline automation now instead of waiting for the next cron tick. */
systemRouter.post("/run-deadline-checks", async (_req, res) => {
  res.json(await runDeadlineChecks());
});
