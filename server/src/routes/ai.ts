import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { chat, transcript } from "../ai/chatbot.js";
import { AI_MODEL, aiProvider, isAiConfigured } from "../ai/client.js";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { auth, notFound, parse } from "../lib/http.js";

export const aiRouter = Router();

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.NODE_ENV === "test" ? 1000 : 12,
  keyGenerator: (req) => req.user?.id ?? "anon",
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "You're sending questions too quickly. Please wait a minute." },
});

aiRouter.get("/status", (_req, res) => {
  res.json({ configured: isAiConfigured(), provider: aiProvider(), model: AI_MODEL() });
});

aiRouter.get("/conversations", async (req, res) => {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId: auth(req).id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, updatedAt: true },
  });
  res.json({ conversations });
});

aiRouter.get("/conversations/:id", async (req, res) => {
  res.json(await transcript(auth(req).id, req.params.id as string));
});

aiRouter.delete("/conversations/:id", async (req, res) => {
  const deleted = await prisma.aiConversation.deleteMany({ where: { id: req.params.id as string, userId: auth(req).id } });
  if (!deleted.count) throw notFound("Conversation");
  res.status(204).end();
});

const ChatBody = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().optional(),
});

aiRouter.post("/chat", chatLimiter, async (req, res) => {
  const body = parse(ChatBody, req.body);
  res.json(await chat(auth(req), body.message, body.conversationId));
});
