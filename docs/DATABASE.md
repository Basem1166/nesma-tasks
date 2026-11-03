# Database structure

The source of truth is [`server/prisma/schema.prisma`](../server/prisma/schema.prisma). Migrations are in [`server/prisma/migrations/`](../server/prisma/migrations). The initial migration's SQL is in `20261102160331_init/migration.sql`.

- **Development:** SQLite file (`server/prisma/dev.db`), so no database server is needed.
- **Production:** PostgreSQL. Change `provider = "sqlite"` to `"postgresql"` in the schema and run `npx prisma migrate dev --name init` once against an empty PostgreSQL database to produce a PostgreSQL migration (see [DEPLOYMENT.md](DEPLOYMENT.md)). Enum-like columns are stored as validated strings, so the schema is the same on both engines.

```mermaid
erDiagram
  Team ||--o{ User : has
  Team ||--o{ Task : owns
  Team ||--o{ Channel : has
  Team ||--o{ Report : has
  User ||--o{ Task : "assigned (assigneeId)"
  User ||--o{ Task : "created (createdById)"
  User ||--o{ TaskUpdate : authors
  User ||--o{ Notification : receives
  User ||--o{ PushToken : registers
  User ||--o{ RefreshToken : holds
  User ||--o{ Message : writes
  User ||--o{ AiConversation : owns
  Task ||--o{ TaskUpdate : history
  Task ||--o{ Notification : about
  Channel ||--o{ Message : contains
  AiConversation ||--o{ AiMessage : turns

  User {
    string id PK
    string email UK
    string name
    string passwordHash "bcrypt"
    string role "LEADER | MEMBER"
    string title
    bool active
    bool emailNotifications
    string teamId FK
    datetime lastLoginAt
  }
  Task {
    string id PK
    string title
    string description
    string status "TODO | IN_PROGRESS | IN_REVIEW | DONE"
    string priority "LOW | MEDIUM | HIGH | URGENT"
    int progress "0-100"
    datetime dueDate
    datetime completedAt
    string teamId FK
    string assigneeId FK
    string createdById FK
    datetime reminderSentAt "automation flag"
    datetime overdueNotifiedAt "automation flag"
  }
  TaskUpdate {
    string id PK
    string taskId FK
    string userId FK "null = automation"
    string type "CREATED | ASSIGNED | STATUS | PROGRESS | COMMENT | EDITED | REMINDER | OVERDUE"
    string message
    string fromValue
    string toValue
  }
  Notification {
    string id PK
    string userId FK
    string type
    string title
    string body
    string taskId FK
    bool read
  }
  RefreshToken {
    string id PK
    string tokenHash UK "SHA-256"
    string userId FK
    datetime expiresAt
    datetime revokedAt
  }
  PushToken {
    string id PK
    string token UK "Expo push token"
    string platform
    string userId FK
  }
  EmailLog {
    string id PK
    string to
    string subject
    string html
    string status "SENT | LOGGED | FAILED"
    string eventType
    string taskId
  }
  Channel {
    string id PK
    string name "unique per team"
    string topic
    string teamId FK
  }
  Message {
    string id PK
    string channelId FK
    string userId FK
    string body
  }
  Report {
    string id PK
    string teamId FK
    datetime periodStart
    datetime periodEnd
    string metrics "JSON snapshot"
    string narrative "Markdown"
    bool aiGenerated
    string model
    string generatedById FK "null = scheduled"
  }
  AiConversation {
    string id PK
    string userId FK
    string title
  }
  AiMessage {
    string id PK
    string conversationId FK
    int seq "unique per conversation"
    string role "user | assistant"
    string content "JSON content blocks"
    string displayText
  }
```

## Table notes

| Table | Purpose |
|---|---|
| `Team` | Tenant boundary. Every query is filtered by the caller's `teamId`. |
| `User` | Individual credentials and role. Deactivated users cannot sign in and receive nothing. |
| `RefreshToken` | Rotating refresh tokens (hash only), used to detect reuse and revoke sessions. |
| `Task` | The work item. `completedAt` is set and cleared automatically when the status changes. `reminderSentAt` and `overdueNotifiedAt` make reminders fire once per deadline. |
| `TaskUpdate` | Append-only activity log: who changed what, comments, and automation events. It feeds the activity timeline, the AI tools and the audit trail. |
| `Notification` | In-app inbox (web bell and mobile Inbox tab). |
| `PushToken` | Expo push tokens per device. Stale tokens are removed when Expo reports `DeviceNotRegistered`. |
| `EmailLog` | Every email attempt (sent, logged in dev, or failed with error). It is the Email outbox and the delivery audit. |
| `Channel`, `Message` | Team chat. |
| `Report` | Monthly report: the metrics JSON it was computed from, plus the narrative. |
| `AiConversation`, `AiMessage` | Assistant history, stored exactly as exchanged with Claude (including tool calls and results) so it can be replayed. |

## Indexes

Indexed for the hot paths: tasks by `(teamId, status)`, `assigneeId` and `dueDate` (scheduler scans), task history by `(taskId, createdAt)`, notifications by `(userId, read, createdAt)`, and messages by `(channelId, createdAt)`.
