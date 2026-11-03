import type { RequestHandler } from "express";
import type { Role } from "../domain.js";
import { forbidden, HttpError } from "../lib/http.js";
import { verifyAccessToken } from "./tokens.js";

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new HttpError(401, "Missing bearer token");
  req.user = verifyAccessToken(header.slice(7));
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new HttpError(401, "Not authenticated");
    if (!roles.includes(req.user.role)) throw forbidden("This action requires the team leader role");
    next();
  };
