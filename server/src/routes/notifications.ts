import { Router } from "express";
import { prisma } from "../db.js";
import { auth } from "../lib/http.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const userId = auth(req).id;
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  res.json({ notifications, unread });
});

notificationsRouter.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: auth(req).id, read: false }, data: { read: true } });
  res.status(204).end();
});

notificationsRouter.post("/:id/read", async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id as string, userId: auth(req).id },
    data: { read: true },
  });
  res.status(204).end();
});
