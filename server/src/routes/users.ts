import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth/middleware.js";
import { hashPassword, passwordSchema } from "../auth/password.js";
import { revokeAllForUser } from "../auth/tokens.js";
import { prisma } from "../db.js";
import { ROLES } from "../domain.js";
import { auth, HttpError, notFound, parse } from "../lib/http.js";
import { renderEmail, sendEmail } from "../services/email.js";
import { publicUser } from "./auth.js";

export const usersRouter = Router();

const memberSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  title: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

usersRouter.get("/", async (req, res) => {
  const user = auth(req);
  const users = await prisma.user.findMany({
    where: { teamId: user.teamId, ...(user.role === "LEADER" ? {} : { active: true }) },
    select: {
      ...memberSelect,
      _count: { select: { assignedTasks: { where: { status: { not: "DONE" } } } } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  res.json({
    users: users.map(({ _count, ...u }) => ({ ...u, openTasks: _count.assignedTasks })),
  });
});

const CreateUserBody = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  title: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).default("MEMBER"),
  password: passwordSchema,
});

/** Leaders provision individual credentials for each team member. */
usersRouter.post("/", requireRole("LEADER"), async (req, res) => {
  const leader = auth(req);
  const body = parse(CreateUserBody, req.body);
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw new HttpError(409, "A user with this email already exists");
  }
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      title: body.title,
      role: body.role,
      teamId: leader.teamId,
      passwordHash: await hashPassword(body.password),
    },
    select: memberSelect,
  });
  // The password is shared out-of-band by the leader; it is never emailed.
  const { html, text } = renderEmail({
    heading: `Welcome to Nesma, ${user.name}`,
    intro: `${leader.name} created an account for you. Sign in with this email address and the temporary password your team leader gives you, then change it under Profile.`,
    rows: [["Email", user.email], ["Role", user.role === "LEADER" ? "Team leader" : "Team member"]],
    ctaLabel: "Sign in",
    ctaPath: "/login",
  });
  await sendEmail({ to: user.email, subject: "[Nesma] Your account is ready", html, text, eventType: "USER_CREATED" });
  res.status(201).json({ user });
});

const UpdateUserBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  title: z.string().trim().max(80).nullable().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
});

usersRouter.patch("/:id", requireRole("LEADER"), async (req, res) => {
  const leader = auth(req);
  const body = parse(UpdateUserBody, req.body);
  const target = await prisma.user.findFirst({ where: { id: req.params.id as string, teamId: leader.teamId } });
  if (!target) throw notFound("User");
  if (target.id === leader.id && (body.active === false || body.role === "MEMBER")) {
    throw new HttpError(400, "You cannot deactivate or demote yourself");
  }
  const user = await prisma.user.update({
    where: { id: target.id },
    data: {
      name: body.name,
      title: body.title,
      role: body.role,
      active: body.active,
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
    },
    select: memberSelect,
  });
  if (body.active === false || body.password || body.role) await revokeAllForUser(user.id);
  res.json({ user });
});

const UpdateMeBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  emailNotifications: z.boolean().optional(),
});

usersRouter.patch("/me/profile", async (req, res) => {
  const body = parse(UpdateMeBody, req.body);
  const user = await prisma.user.update({ where: { id: auth(req).id }, data: body });
  res.json({ user: publicUser(user) });
});

const PushTokenBody = z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(["ios", "android", "web", "unknown"]).default("unknown"),
});

usersRouter.post("/me/push-token", async (req, res) => {
  const body = parse(PushTokenBody, req.body);
  const userId = auth(req).id;
  // A device token belongs to whoever signed in on that device last.
  await prisma.pushToken.upsert({
    where: { token: body.token },
    create: { token: body.token, platform: body.platform, userId },
    update: { userId, platform: body.platform },
  });
  res.status(204).end();
});

usersRouter.delete("/me/push-token", async (req, res) => {
  const { token } = parse(z.object({ token: z.string().min(1) }), req.body);
  await prisma.pushToken.deleteMany({ where: { token, userId: auth(req).id } });
  res.status(204).end();
});
