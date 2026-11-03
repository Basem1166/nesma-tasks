import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";
import type { AuthUser, Role } from "../domain.js";
import { HttpError } from "../lib/http.js";

interface AccessClaims {
  sub: string;
  role: Role;
  teamId: string;
  name: string;
  email: string;
}

export function signAccessToken(user: AuthUser): string {
  const claims: AccessClaims = {
    sub: user.id,
    role: user.role,
    teamId: user.teamId,
    name: user.name,
    email: user.email,
  };
  return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
    algorithm: "HS256",
    issuer: "nesma",
  });
}

export function verifyAccessToken(token: string): AuthUser {
  try {
    const c = jwt.verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "nesma",
    }) as AccessClaims;
    return { id: c.sub, role: c.role, teamId: c.teamId, name: c.name, email: c.email };
  } catch {
    throw new HttpError(401, "Invalid or expired access token");
  }
}

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export async function issueRefreshToken(userId: string, userAgent?: string): Promise<string> {
  const token = crypto.randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      tokenHash: hash(token),
      userId,
      userAgent: userAgent?.slice(0, 200),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return token;
}

/**
 * Rotates a refresh token: the presented token is revoked and a new one issued.
 * Presenting an already-revoked token is treated as theft and revokes every
 * session for that user.
 */
export async function rotateRefreshToken(token: string, userAgent?: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  if (!record) throw new HttpError(401, "Invalid refresh token");
  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new HttpError(401, "Refresh token reuse detected; all sessions revoked");
  }
  if (record.expiresAt < new Date() || !record.user.active) {
    throw new HttpError(401, "Refresh token expired");
  }
  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const next = await issueRefreshToken(record.userId, userAgent);
  return { user: record.user, refreshToken: next };
}

export async function revokeRefreshToken(token: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
