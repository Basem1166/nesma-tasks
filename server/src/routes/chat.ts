import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { auth, HttpError, notFound, parse } from "../lib/http.js";
import { sendPush } from "../services/push.js";
import { emitToTeam } from "../services/realtime.js";

/** Team communication: channels per team, messages broadcast over Socket.IO. */
export const chatRouter = Router();

chatRouter.get("/", async (req, res) => {
  const user = auth(req);
  const channels = await prisma.channel.findMany({
    where: { teamId: user.teamId },
    orderBy: { createdAt: "asc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1, include: { user: { select: { name: true } } } } },
  });
  res.json({
    channels: channels.map(({ messages, ...c }) => ({ ...c, lastMessage: messages[0] ?? null })),
  });
});

const ChannelBody = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,32}$/, "Use 2-32 lowercase letters, digits or dashes"),
  topic: z.string().trim().max(200).default(""),
});

chatRouter.post("/", requireRole("LEADER"), async (req, res) => {
  const user = auth(req);
  const body = parse(ChannelBody, req.body);
  if (await prisma.channel.findFirst({ where: { teamId: user.teamId, name: body.name } })) {
    throw new HttpError(409, "Channel already exists");
  }
  const channel = await prisma.channel.create({ data: { ...body, teamId: user.teamId } });
  emitToTeam(user.teamId, "chat:channel", channel);
  res.status(201).json({ channel });
});

const HistoryQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

chatRouter.get("/:id/messages", async (req, res) => {
  const user = auth(req);
  const q = parse(HistoryQuery, req.query);
  const channel = await prisma.channel.findFirst({ where: { id: req.params.id as string, teamId: user.teamId } });
  if (!channel) throw notFound("Channel");
  const messages = await prisma.message.findMany({
    where: { channelId: channel.id, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ messages: messages.reverse() });
});

const MessageBody = z.object({ body: z.string().trim().min(1).max(4000) });

chatRouter.post("/:id/messages", async (req, res) => {
  const user = auth(req);
  const { body } = parse(MessageBody, req.body);
  const channel = await prisma.channel.findFirst({ where: { id: req.params.id as string, teamId: user.teamId } });
  if (!channel) throw notFound("Channel");
  const message = await prisma.message.create({
    data: { channelId: channel.id, userId: user.id, body },
    include: { user: { select: { id: true, name: true } } },
  });
  emitToTeam(user.teamId, "chat:message", message);

  const recipients = await prisma.user.findMany({
    where: { teamId: user.teamId, active: true, id: { not: user.id } },
    select: { id: true },
  });
  void sendPush(
    recipients.map((r) => r.id),
    { title: `#${channel.name} · ${user.name}`, body: body.slice(0, 160), data: { type: "CHAT", channelId: channel.id } },
  );
  res.status(201).json({ message });
});
