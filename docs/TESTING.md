# Testing evidence & demonstration

There are three layers of evidence. All of them can be re-run from a clean checkout.

| Layer | Command | Result (recorded 2026-11-02) |
|---|---|---|
| Automated test suite (API, RBAC, workflow, automation, metrics, AI tool loop) | `npm test` | **31 / 31 passed**: [evidence/server-tests-output.txt](evidence/server-tests-output.txt) |
| Live end-to-end workflow against a running server with two realtime clients | `npm --prefix server run e2e:demo` | **All checks passed**: [evidence/e2e-demo-output.txt](evidence/e2e-demo-output.txt) |
| Static checks | `npm run typecheck`, `cd mobile && npx expo lint`, `npx expo-doctor` | Server and mobile `tsc` clean. Web production build OK. Mobile lint: 0 findings. expo-doctor: 20/20 checks passed. Android bundle exported successfully. |
| Live AI provider | `npm --prefix server run ai:smoke` | Needs `AI_API_KEY` (free Gemini). **Not run in the recorded session** (no key on the build machine). The AI loop is covered by the automated tests with a stubbed client, and the e2e demo confirms the server reports the missing key correctly (503). |

## 1. Automated tests (`server/tests`)

Vitest + Supertest against the real Express app and a real SQLite test database (`prisma/test.db`, reset for each run). Only external services are replaced: email runs in log mode, push is skipped, and the AI provider (Claude or Gemini) is a stub.

| Suite | What it proves |
|---|---|
| `auth.test.ts` | Login; same error for a wrong password and an unknown email; httpOnly SameSite=Strict refresh cookie for web; bearer token required; **refresh-token rotation and theft detection** (reusing an old token kills every session); members get 403 on leader areas; leaders provision accounts with enforced password policy; deactivated users cannot sign in. |
| `tasks.test.ts` | Assignment sends an in-app notification and an email (with a link to the task); email preference respected; members only see their own tasks (others get 404); members can change only status and progress; Done stamps `completedAt`, sets progress to 100 and notifies the leader with an email; re-assign notifies the new assignee; changing the due date re-arms reminders; comments notify participants; validation errors return 400 or 404; only leaders delete. |
| `automation.test.ts` | Due-soon reminder fires **exactly once** and is logged in the task history; overdue alert goes to assignee and leader **exactly once**; the monthly report is computed from real tasks, stored, and leaders are notified ("October 2026"). |
| `metrics.test.ts` | Hand-checked numbers for workload, completion rate, on-time rate, late completions, overdue at period end, per-member stats, days late and days overdue, top performers and high-priority deliveries. |
| `ai.test.ts` | Chatbot tools apply the **same row-level access as the API** (a member cannot search or open another member's task); invalid tool input becomes an error result; the full tool-use loop on **both providers** (the model asks for `search_tasks`, the server runs it on scoped data, Claude answers) is persisted **append-only** and replayed unchanged on the follow-up question; `fallbacks: "default"` is sent; a failed model call stores nothing; users cannot read or continue each other's conversations. |

## 2. End-to-end demo (`server/scripts/e2e-demo.ts`)

The script signs in as the **leader** and as **Sara (member)**, opens two Socket.IO connections the way the web and mobile apps do, and walks through the whole workflow:

1. Auth and roles: wrong password gets 401, member on reports gets 403, both clients connect to realtime.
2. Leader creates a HIGH-priority task for Sara due in 6 h. Sara receives `notification:new` and `task:changed` live, and the assignment email appears in the outbox.
3. Sara (as on mobile) tries to rename the task (403), sets progress to 60% (auto-moves to In progress) and comments. The leader is notified live.
4. Deadline checks run: Sara gets the "Deadline approaching" reminder. A second run sends nothing (idempotent), and exactly one reminder email exists.
5. Leader moves the deadline into the past. The next run alerts **both** Sara and the leader that the task is overdue.
6. Sara marks it Done: progress 100%, completion timestamp set, leader gets "Task completed". The task history reads `CREATED → ASSIGNED → STATUS → PROGRESS → COMMENT → REMINDER → EDITED → OVERDUE → STATUS → PROGRESS`.
7. Sara posts in team chat and the leader receives it instantly.
8. Live report metrics for the current month. The assistant is called (real answer with a key; 503 explanation without).

The demo task is deleted at the end.

## 3. Manual demonstration script (about 10 minutes)

Use two windows side by side: **web as `leader@nesma.dev`** and **the mobile app (or a second browser profile) as `sara@nesma.dev`**, both with password `Nesma@2026`.

| # | Action | What to show |
|---|---|---|
| 1 | Leader: Dashboard | KPI tiles, status distribution, needs-attention list, team workload, activity feed, all computed from live data. |
| 2 | Leader: Tasks → **Board** | Drag a card between columns. Sara's phone updates immediately (live sync). |
| 3 | Leader: **+ New task**, assign to Sara, due tomorrow | Sara's phone gets a push notification (development build) or an Inbox entry. Tapping it opens the task. Automation → Email outbox shows the rendered assignment email. |
| 4 | Sara (mobile): set status, tap 50%, add a comment | Leader's bell lights up. The task's activity timeline grows on both screens. |
| 5 | Leader: Automation → **Run deadline checks now** | "Deadline approaching" reminders and overdue alerts go out, once per deadline. Click an email in the outbox to preview it. |
| 6 | Leader: **AI assistant** | Ask *"Which tasks are overdue and who owns them?"* and *"Compare October with September"*. The chips show which tools were used, and the answers cite real tasks and people. |
| 7 | Sara: **AI** tab | Ask *"What is overdue for the team?"*. She only gets her own tasks, which shows RBAC applies inside the AI. |
| 8 | Leader: **AI reports → Generate** for last month | KPI tiles with month-over-month deltas and the AI narrative (summary, team table, delays, achievements, recommendations). Leaders receive the "report ready" notification and email. |
| 9 | Team chat on both devices | Messages and typing indicator appear in real time. Sara's phone receives a push for messages from others. |
| 10 | Leader: Team → Deactivate a member | That member is signed out everywhere and cannot sign in again. |
