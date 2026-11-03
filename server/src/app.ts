import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { requireAuth, requireRole } from "./auth/middleware.js";
import { corsOrigins } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { notificationsRouter } from "./routes/notifications.js";
import { reportsRouter } from "./routes/reports.js";
import { systemRouter } from "./routes/system.js";
import { tasksRouter } from "./routes/tasks.js";
import { usersRouter } from "./routes/users.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", requireAuth, usersRouter);
  app.use("/api/tasks", requireAuth, tasksRouter);
  app.use("/api/dashboard", requireAuth, dashboardRouter);
  app.use("/api/notifications", requireAuth, notificationsRouter);
  app.use("/api/channels", requireAuth, chatRouter);
  app.use("/api/ai", requireAuth, aiRouter);
  app.use("/api/reports", requireAuth, requireRole("LEADER"), reportsRouter);
  app.use("/api/system", requireAuth, requireRole("LEADER"), systemRouter);

  app.use("/api", () => {
    throw new HttpError(404, "Not found");
  });

  // Single-host deployment: serve the built web app when it exists.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(webDist)) {
    app.use(
      helmet.contentSecurityPolicy({
        directives: { "connect-src": ["'self'", "ws:", "wss:"], "img-src": ["'self'", "data:"] },
      }),
    );
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
