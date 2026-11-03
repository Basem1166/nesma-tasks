# API reference

Base path `/api`. JSON in and out. Authenticated routes need `Authorization: Bearer <accessToken>`. Validation errors return `400 {error, details:[{path,message}]}`.

## Auth

| Method & path | Access | Notes |
|---|---|---|
| `POST /auth/login` | public, rate-limited | `{email, password, client?: "web"\|"mobile"}` returns `{accessToken, user}`. Web gets the refresh token as a cookie; mobile gets `refreshToken` in the body. |
| `POST /auth/refresh` | refresh token | Cookie, or body `{refreshToken, client:"mobile"}`. Rotates the token. |
| `POST /auth/logout` | refresh token | Revokes it. |
| `GET /auth/me` | user | Current profile. |
| `POST /auth/change-password` | user | `{currentPassword, newPassword}`. Revokes all sessions. |

## Users & team

| Method & path | Access | Notes |
|---|---|---|
| `GET /users` | user | Team members with open-task counts. |
| `POST /users` | leader | Create an account: `{name, email, title?, role, password}`. |
| `PATCH /users/:id` | leader | `{name?, title?, role?, active?, password?}`. Deactivating, changing role or resetting the password revokes that user's sessions. |
| `PATCH /users/me/profile` | user | `{name?, emailNotifications?}`. |
| `POST /users/me/push-token` | user | `{token, platform}` registers a device for push. |
| `DELETE /users/me/push-token` | user | `{token}`, called on sign-out. |

## Tasks

| Method & path | Access | Notes |
|---|---|---|
| `GET /tasks` | user (scoped) | Query: `status` (CSV), `priority` (CSV), `assigneeId` (`none` = unassigned), `q`, `overdue=true`, `mine=true`, `sort=due\|priority\|updated\|created`. |
| `POST /tasks` | user | `{title, description?, priority?, dueDate?, assigneeId?}`. Members always create tasks for themselves. |
| `GET /tasks/:id` | user (scoped) | `{task, updates[]}`. |
| `PATCH /tasks/:id` | leader: all fields; member: `status`, `progress` | Keeps status and progress consistent and logs history. Emits workflow events. |
| `DELETE /tasks/:id` | leader | |
| `POST /tasks/:id/comments` | user (scoped) | `{body}` |
| `GET /dashboard` | user (scoped) | Stats, my tasks, tasks needing attention, workload (leader), recent activity. |

## Notifications

`GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all`

## Team chat

| Method & path | Access |
|---|---|
| `GET /channels` | user |
| `POST /channels` `{name, topic?}` | leader |
| `GET /channels/:id/messages?before=&limit=` | user |
| `POST /channels/:id/messages` `{body}` | user |

## AI

| Method & path | Access | Notes |
|---|---|---|
| `GET /ai/status` | user | `{configured, model}` |
| `POST /ai/chat` | user, 12/min | `{message, conversationId?}` returns `{conversationId, reply, toolsUsed[], model}` |
| `GET /ai/conversations` | user | Own conversations only. |
| `GET /ai/conversations/:id` | owner | Visible transcript, with the tools used for each answer. |
| `DELETE /ai/conversations/:id` | owner | |

## Reports (leader)

`GET /reports` · `GET /reports/:id` · `GET /reports/preview?year=&month=` (metrics only) · `POST /reports/generate {year, month}`

## System (leader)

`GET /system/status` (AI, email mode, push devices) · `GET /system/emails` (outbox, team recipients only) · `POST /system/run-deadline-checks`

`GET /health` is public and checks the database.

## Realtime (Socket.IO, same origin, path `/socket.io`)

Connect with `auth: { token: <accessToken> }`.

| Event (server → client) | Payload | Sent to |
|---|---|---|
| `task:changed` | `{taskId, action}` | Assignee, creator, leaders |
| `notification:new` | `Notification` | Recipient |
| `chat:message` | `Message` with `user` | Team |
| `chat:channel` | `Channel` | Team |
| `chat:typing` | `{channelId, userId, name}` | Team (except sender) |

| Event (client → server) | Payload |
|---|---|
| `chat:typing` | `channelId` |
