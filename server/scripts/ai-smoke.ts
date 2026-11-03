/**
 * Live AI smoke test against the real Claude API and the seeded database.
 * Requires ANTHROPIC_API_KEY in server/.env and `npm run db:seed` beforehand.
 *
 *   npm run ai:smoke
 *
 * 1. Asks the chatbot a question as the team leader and as a member, printing
 *    which tools Claude called and its answer (shows data scoping).
 * 2. Writes the narrative for last month's report (not saved).
 */
import { chat } from "../src/ai/chatbot.js";
import { isAiConfigured } from "../src/ai/client.js";
import { prisma } from "../src/db.js";
import type { AuthUser, Role } from "../src/domain.js";
import { loadTeamMetrics, monthRange } from "../src/reports/metrics.js";
import { writeNarrative } from "../src/reports/report.js";

if (!isAiConfigured()) {
  console.error("Set ANTHROPIC_API_KEY in server/.env first.");
  process.exit(1);
}

const asAuth = (u: { id: string; role: string; teamId: string; name: string; email: string }): AuthUser => ({
  id: u.id,
  role: u.role as Role,
  teamId: u.teamId,
  name: u.name,
  email: u.email,
});

const leader = await prisma.user.findUniqueOrThrow({ where: { email: "leader@nesma.dev" } });
const member = await prisma.user.findUniqueOrThrow({ where: { email: "youssef@nesma.dev" } });

for (const [who, user, question] of [
  ["LEADER", leader, "Which tasks are overdue, who owns them, and what should I do first?"],
  ["MEMBER", member, "Summarise my progress and tell me what is at risk."],
] as const) {
  const started = Date.now();
  const r = await chat(asAuth(user), question);
  console.log(`\n=== ${who} (${user.name}) · ${r.model} · ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`Q: ${question}`);
  console.log(`Tools: ${r.toolsUsed.join(", ") || "none"}`);
  console.log(r.reply);
}

const now = new Date();
const { start, end } = monthRange(now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), now.getUTCMonth() === 0 ? 12 : now.getUTCMonth());
const metrics = await loadTeamMetrics(leader.teamId, start, end);
const n = await writeNarrative(metrics);
console.log(`\n=== Monthly report narrative for ${metrics.periodLabel} (AI: ${n.aiGenerated}, model: ${n.model})\n`);
console.log(n.narrative);
await prisma.$disconnect();
