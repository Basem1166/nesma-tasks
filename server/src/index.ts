import http from "node:http";
import { AI_MODEL, aiProvider, isAiConfigured } from "./ai/client.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { emailMode } from "./services/email.js";
import { attachRealtime } from "./services/realtime.js";
import { startScheduler } from "./services/scheduler.js";
import { registerWorkflow } from "./services/workflow.js";

registerWorkflow();
const server = http.createServer(createApp());
attachRealtime(server);
startScheduler();

server.listen(config.PORT, () => {
  console.log(`[nesma] API listening on http://localhost:${config.PORT}`);
  console.log(`[nesma] email mode: ${emailMode()} | AI: ${isAiConfigured() ? `${aiProvider()} / ${AI_MODEL()}` : "not configured"}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
