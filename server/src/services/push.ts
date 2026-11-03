import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { config } from "../config.js";
import { prisma } from "../db.js";

const expo = new Expo(config.EXPO_ACCESS_TOKEN ? { accessToken: config.EXPO_ACCESS_TOKEN } : {});

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Sends a push notification to every registered device of the given users. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<void> {
  if (config.NODE_ENV === "test" || userIds.length === 0) return;
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } } });
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t.token));
  if (valid.length === 0) return;

  const messages: ExpoPushMessage[] = valid.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: "default",
    priority: "high",
    channelId: "default",
  }));

  for (const [i, chunk] of expo.chunkPushNotifications(messages).entries()) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      // Drop tokens Expo reports as no longer registered (app uninstalled, etc.).
      const stale = tickets
        .map((ticket, j) => ({ ticket, token: chunk[j]!.to as string }))
        .filter(({ ticket }) => ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered")
        .map(({ token }) => token);
      if (stale.length) await prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
    } catch (e) {
      console.error(`[push] chunk ${i} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
