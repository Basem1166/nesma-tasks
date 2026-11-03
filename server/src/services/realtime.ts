import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyAccessToken } from "../auth/tokens.js";
import { corsOrigins } from "../config.js";
import { prisma } from "../db.js";
import type { AuthUser } from "../domain.js";

let io: Server | null = null;

export const userRoom = (id: string) => `user:${id}`;
export const teamRoom = (id: string) => `team:${id}`;

/**
 * Socket.IO gateway shared by the web and mobile apps. Clients authenticate
 * with their access token; each socket joins its user room and team room so
 * task changes, chat messages and notifications sync instantly everywhere.
 */
export function attachRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error("unauthorized"));
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthUser;
    socket.join(userRoom(user.id));
    socket.join(teamRoom(user.teamId));

    socket.on("chat:typing", async (channelId: unknown) => {
      if (typeof channelId !== "string") return;
      const channel = await prisma.channel.findFirst({ where: { id: channelId, teamId: user.teamId } });
      if (!channel) return;
      socket.to(teamRoom(user.teamId)).emit("chat:typing", { channelId, userId: user.id, name: user.name });
    });
  });

  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToTeam(teamId: string, event: string, payload: unknown) {
  io?.to(teamRoom(teamId)).emit(event, payload);
}
