import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { DUMMY_HASH, hashPassword, passwordSchema, verifyPassword } from "../auth/password.js";
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from "../auth/tokens.js";
import { config, isProd } from "../config.js";
import { prisma } from "../db.js";
import type { AuthUser, Role } from "../domain.js";
import { auth, HttpError, parse } from "../lib/http.js";

export const authRouter = Router();

const REFRESH_COOKIE = "nesma_rt";

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again in 15 minutes." },
});

const toAuthUser = (u: { id: string; role: string; teamId: string; name: string; email: string }): AuthUser => ({
  id: u.id,
  role: u.role as Role,
  teamId: u.teamId,
  name: u.name,
  email: u.email,
});

export const publicUser = (u: {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  teamId: string;
  emailNotifications: boolean;
}) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  title: u.title,
  teamId: u.teamId,
  emailNotifications: u.emailNotifications,
});

/**
 * Web clients get the refresh token as an httpOnly, SameSite=strict cookie
 * scoped to /api/auth (never readable by JS). Mobile clients (client: "mobile")
 * get it in the body and keep it in the device's secure keystore.
 */
function sendSession(res: Response, isMobile: boolean, refreshToken: string, payload: object) {
  if (isMobile) {
    res.json({ ...payload, refreshToken });
    return;
  }
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/api/auth",
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  res.json(payload);
}

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  client: z.enum(["web", "mobile"]).default("web"),
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const body = parse(LoginBody, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  // Always run bcrypt so response time does not reveal whether the email exists.
  const ok = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.active) throw new HttpError(401, "Invalid email or password");

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const refreshToken = await issueRefreshToken(user.id, req.get("user-agent"));
  sendSession(res, body.client === "mobile", refreshToken, {
    accessToken: signAccessToken(toAuthUser(user)),
    user: publicUser(user),
  });
});

const RefreshBody = z.object({ refreshToken: z.string().optional(), client: z.enum(["web", "mobile"]).default("web") });

authRouter.post("/refresh", async (req, res) => {
  const body = parse(RefreshBody, req.body ?? {});
  const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  if (!token) throw new HttpError(401, "No refresh token");
  const { user, refreshToken } = await rotateRefreshToken(token, req.get("user-agent"));
  sendSession(res, body.client === "mobile", refreshToken, {
    accessToken: signAccessToken(toAuthUser(user)),
    user: publicUser(user),
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = (req.body?.refreshToken as string | undefined) ?? req.cookies?.[REFRESH_COOKIE];
  if (token) await revokeRefreshToken(token);
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: auth(req).id } });
  if (!user || !user.active) throw new HttpError(401, "Account disabled");
  res.json({ user: publicUser(user) });
});

const ChangePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

authRouter.post("/change-password", requireAuth, loginLimiter, async (req, res) => {
  const body = parse(ChangePasswordBody, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth(req).id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Current password is incorrect");
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } });
  // Sign out every other session.
  await revokeAllForUser(user.id);
  res.status(204).end();
});
