/**
 * End-to-end workflow demonstration against a RUNNING server (npm run dev),
 * using two real clients (leader + member) over HTTP and Socket.IO - exactly
 * what the web and mobile apps do.
 *
 *   npm run e2e:demo                 # against http://localhost:4000
 *   BASE_URL=https://… npm run e2e:demo
 *
 * Prints a step-by-step transcript and exits non-zero if any check fails.
 */
import { io, type Socket } from "socket.io-client";

const BASE = process.env.BASE_URL ?? "http://localhost:4000";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Nesma@2026";
let failures = 0;

const log = (s: string) => console.log(s);
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  log(`   ${ok ? "PASS" : "FAIL"}  ${what}`);
};

async function call<T = any>(token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data: data as T };
}

async function signIn(email: string) {
  const r = await call<{ accessToken: string; user: { id: string; name: string } }>(null, "POST", "/auth/login", { email, password: PASSWORD, client: "mobile" });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status}`);
  return r.data;
}

function connect(token: string) {
  const events: { event: string; payload: any }[] = [];
  const socket: Socket = io(BASE, { auth: { token }, transports: ["websocket"] });
  socket.onAny((event, payload) => events.push({ event, payload }));
  return new Promise<{ socket: Socket; events: typeof events }>((resolve, reject) => {
    socket.on("connect", () => resolve({ socket, events }));
    socket.on("connect_error", reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const since = (events: { event: string; payload: any }[], n: number) => events.slice(n);

log(`Nesma end-to-end workflow demo → ${BASE}\n`);

log("1. Authentication & roles");
const leader = await signIn("leader@nesma.dev");
const sara = await signIn("sara@nesma.dev");
check(true, `leader signed in as ${leader.user.name}; member signed in as ${sara.user.name}`);
check((await call(null, "POST", "/auth/login", { email: "sara@nesma.dev", password: "wrong" })).status === 401, "wrong password rejected (401)");
check((await call(sara.accessToken, "GET", "/reports")).status === 403, "member blocked from leader-only reports (403)");

const L = await connect(leader.accessToken);
const S = await connect(sara.accessToken);
check(L.socket.connected && S.socket.connected, "both clients connected to the realtime gateway");

log("\n2. Leader creates and assigns a task to the member");
let mark = S.events.length;
const due = new Date(Date.now() + 6 * 3_600_000).toISOString();
const created = await call(leader.accessToken, "POST", "/tasks", {
  title: `E2E demo task ${new Date().toISOString().slice(11, 19)}`,
  description: "Created by scripts/e2e-demo.ts",
  priority: "HIGH",
  dueDate: due,
  assigneeId: sara.user.id,
});
check(created.status === 201, `task created (${created.data.task.id})`);
const taskId = created.data.task.id as string;
await wait(600);
const assignedNote = since(S.events, mark).find((e) => e.event === "notification:new" && e.payload.type === "TASK_ASSIGNED");
check(!!assignedNote, `member received realtime notification: "${assignedNote?.payload.body}"`);
check(since(S.events, mark).some((e) => e.event === "task:changed" && e.payload.taskId === taskId), "member's open screens told to refresh (task:changed)");
const outbox1 = await call(leader.accessToken, "GET", "/system/emails");
const assignMail = outbox1.data.emails.find((m: any) => m.to === "sara@nesma.dev" && m.subject.includes(created.data.task.title));
check(!!assignMail, `assignment email to sara@nesma.dev recorded [${assignMail?.status}] "${assignMail?.subject}"`);

log("\n3. Member works the task (as from the mobile app)");
check((await call(sara.accessToken, "PATCH", `/tasks/${taskId}`, { title: "hijack" })).status === 403, "member cannot edit title (403)");
mark = L.events.length;
const prog = await call(sara.accessToken, "PATCH", `/tasks/${taskId}`, { progress: 60 });
check(prog.data.task.status === "IN_PROGRESS" && prog.data.task.progress === 60, "progress 60% → status auto-moved to In progress");
await call(sara.accessToken, "POST", `/tasks/${taskId}/comments`, { body: "Halfway there, draft shared." });
await wait(600);
const leaderNotes = since(L.events, mark).filter((e) => e.event === "notification:new").map((e) => e.payload.type);
// Progress on a To-do task also moves it to In progress, so it is reported as a status change.
check(leaderNotes.includes("TASK_STATUS") && leaderNotes.includes("TASK_COMMENT"), `leader notified live: ${leaderNotes.join(", ")}`);

log("\n4. Automation: deadline reminder (task is due in 6 h)");
mark = S.events.length;
const run1 = await call(leader.accessToken, "POST", "/system/run-deadline-checks");
await wait(600);
check(since(S.events, mark).some((e) => e.event === "notification:new" && e.payload.type === "TASK_DUE_SOON" && e.payload.taskId === taskId), `reminder delivered (run result ${JSON.stringify(run1.data)})`);
const run2 = await call(leader.accessToken, "POST", "/system/run-deadline-checks");
const outbox2 = await call(leader.accessToken, "GET", "/system/emails");
const reminders = outbox2.data.emails.filter((m: any) => m.taskId === taskId && m.eventType === "TASK_DUE_SOON");
check(reminders.length === 1, `second run is idempotent (${JSON.stringify(run2.data)}); exactly 1 reminder email`);

log("\n5. Automation: deadline moved into the past → overdue alert to member + leader");
await call(leader.accessToken, "PATCH", `/tasks/${taskId}`, { dueDate: new Date(Date.now() - 3_600_000).toISOString() });
mark = L.events.length;
const markS = S.events.length;
await call(leader.accessToken, "POST", "/system/run-deadline-checks");
await wait(600);
check(since(L.events, mark).some((e) => e.event === "notification:new" && e.payload.type === "TASK_OVERDUE"), "leader got overdue alert");
check(since(S.events, markS).some((e) => e.event === "notification:new" && e.payload.type === "TASK_OVERDUE"), "member got overdue alert");

log("\n6. Member completes the task");
mark = L.events.length;
const done = await call(sara.accessToken, "PATCH", `/tasks/${taskId}`, { status: "DONE" });
await wait(600);
check(done.data.task.progress === 100 && !!done.data.task.completedAt, "status Done → progress 100%, completion time stamped");
check(since(L.events, mark).some((e) => e.event === "notification:new" && e.payload.type === "TASK_COMPLETED"), "leader notified: task completed");
const detail = await call(leader.accessToken, "GET", `/tasks/${taskId}`);
log(`   history: ${detail.data.updates.map((u: any) => u.type).join(" → ")}`);

log("\n7. Team chat (realtime)");
const channels = await call(sara.accessToken, "GET", "/channels");
mark = L.events.length;
await call(sara.accessToken, "POST", `/channels/${channels.data.channels[0].id}/messages`, { body: "E2E hello from the mobile client 👋" });
await wait(500);
check(since(L.events, mark).some((e) => e.event === "chat:message" && e.payload.body.includes("E2E hello")), "leader received the chat message instantly");

log("\n8. AI reporting & assistant");
const status = await call(leader.accessToken, "GET", "/system/status");
log(`   AI configured: ${status.data.ai.configured} (${status.data.ai.model}); email mode: ${status.data.email.mode}`);
const now = new Date();
const preview = await call(leader.accessToken, "GET", `/reports/preview?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`);
check(preview.status === 200, `live metrics this month: completion ${preview.data.metrics.summary.completionRate}%, on-time ${preview.data.metrics.summary.onTimeRate}%, overdue ${preview.data.metrics.summary.overdueOpen}`);
if (status.data.ai.configured) {
  const ai = await call(sara.accessToken, "POST", "/ai/chat", { message: "Which of my tasks are overdue or at risk?" });
  check(ai.status === 200, `assistant answered via tools [${ai.data.toolsUsed?.join(", ")}]`);
  log(ai.data.reply?.split("\n").map((l: string) => `      ${l}`).join("\n"));
} else {
  const ai = await call(sara.accessToken, "POST", "/ai/chat", { message: "hi" });
  check(ai.status === 503, "assistant correctly reports AI not configured (503) - set ANTHROPIC_API_KEY to enable");
}

log("\nCleanup: deleting the demo task");
check((await call(leader.accessToken, "DELETE", `/tasks/${taskId}`)).status === 204, "demo task deleted");

L.socket.disconnect();
S.socket.disconnect();
log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures ? 1 : 0);
