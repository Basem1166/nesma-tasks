# Workflow automation

Task assignment, progress updates, reminders, notifications and reporting run as **one pipeline**:

1. **Producers** (REST routes, the scheduler) change data and *emit a domain event* on the bus ([`services/events.ts`](../server/src/services/events.ts)).
2. **Rules** ([`services/workflow.ts`](../server/src/services/workflow.ts)) decide who should know and what to tell them.
3. **Delivery** ([`services/notify.ts`](../server/src/services/notify.ts)) sends each message out on every channel: persisted in-app notification, realtime socket event, mobile push and email (if the user has email turned on).

A failing channel, such as SMTP being down, is logged and never blocks the others or the user's action.

## End-to-end workflow

```mermaid
flowchart TD
  L([Leader creates task<br/>web or mobile]) --> C[POST /api/tasks]
  C --> E1{{task.created}}
  C --> E2{{task.assigned}}
  E2 --> N1[Assignee: in-app + push + email<br/>“New task assigned”]

  N1 --> M([Member opens task<br/>from push / email / inbox])
  M --> U[PATCH status / progress<br/>POST comment]
  U --> E3{{task.status_changed<br/>task.progress<br/>task.commented}}
  E3 --> N2[Creator / assignee / leaders notified<br/>Done → leaders get “Task completed”]
  E3 --> RT[Realtime 'task:changed'<br/>web + mobile refresh live]

  subgraph Scheduler["Scheduler (every 10 min)"]
    S1[Find tasks due within 24 h<br/>not done, reminder not sent] --> E4{{task.due_soon}}
    S2[Find tasks past deadline<br/>not done, alert not sent] --> E5{{task.overdue}}
  end
  E4 --> N3[Assignee: “Deadline approaching”<br/>in-app + push + email, once]
  E5 --> N4[Assignee + all leaders: “Task overdue”<br/>in-app + push + email, once]
  N3 --> M
  N4 --> M

  subgraph Monthly["1st of month 07:00"]
    R1[Compute metrics from real task data] --> R2[Claude writes narrative<br/>+ recommendations]
    R2 --> R3[(Report saved)]
  end
  R3 --> E6{{report.generated}}
  E6 --> N5[Leaders: “Monthly report ready”<br/>in-app + push + email]
  N5 --> LR([Leader reads report<br/>or asks the AI assistant])
  LR --> L
```

## Event → recipients → channels

| Event | Trigger | Recipients (never the person who acted) | In-app | Push | Email |
|---|---|---|:-:|:-:|:-:|
| `task.created` | Task created | (live board refresh only) | | | |
| `task.assigned` | Created with assignee, or re-assigned | New assignee | ✅ | ✅ | ✅ |
| `task.updated` | Title, description, priority or due date edited | Assignee, creator | ✅ | ✅ | ✅ |
| `task.status_changed` | Status moved | Assignee, creator; **+ all leaders when Done** | ✅ | ✅ | ✅ |
| `task.progress` | Progress % changed (status unchanged) | Creator | ✅ | ✅ | – (too frequent) |
| `task.commented` | Comment posted | Assignee, creator | ✅ | ✅ | ✅ |
| `task.deleted` | Leader deleted task | Assignee | ✅ | ✅ | – |
| `task.due_soon` | Scheduler: due within `REMINDER_WINDOW_HOURS` (24) | Assignee | ✅ | ✅ | ✅ |
| `task.overdue` | Scheduler: deadline passed, not done | Assignee + all leaders | ✅ | ✅ | ✅ |
| `report.generated` | Monthly cron or manual "Generate" | All leaders | ✅ | ✅ | ✅ |
| Chat message | Message posted in a channel | Rest of the team | realtime | ✅ | – |

Every task event also sends `task:changed` to the assignee, the creator and the leaders over Socket.IO, so lists, boards, dashboards and detail screens refresh on web and mobile without polling.

## Exactly-once reminders

```mermaid
sequenceDiagram
  participant Cron as Scheduler tick
  participant DB as Database
  participant Bus as Event bus
  Cron->>DB: find tasks due ≤ 24h, not DONE, reminderSentAt IS NULL
  loop each candidate
    Cron->>DB: UPDATE … SET reminderSentAt=now WHERE id=? AND reminderSentAt IS NULL
    alt 1 row updated (claimed)
      Cron->>Bus: emit task.due_soon
    else 0 rows (another instance claimed it)
      Cron-->>Cron: skip
    end
  end
  Note over DB: Editing the due date clears reminderSentAt and overdueNotifiedAt,<br/>so the new deadline gets its own reminder and overdue alert.
```

The scheduler also runs once at boot, so reminders missed while the server was down are sent on startup. Leaders can trigger a run on demand under **Automation → Run deadline checks now**.

## AI in the workflow

- **Monthly report.** `generateMonthlyReport()` computes the metrics in code: workload, completion rate, on-time rate, late completions, overdue at month end, average cycle time, per-member breakdown, delays and achievements, plus the previous month for comparison. Claude (`claude-opus-5-5`, effort `high`) is given that JSON and told to use only those numbers. The narrative and the metrics snapshot are stored together, so a report can always be traced back to its data.
- **Assistant.** For each question Claude decides which read-only tools to call (often several in parallel). The tools run against the database **with the asking user's permissions**, Claude answers from the results, and the full exchange is stored append-only so follow-up questions keep their context.

```mermaid
sequenceDiagram
  actor U as User (web/mobile)
  participant API as /api/ai/chat
  participant C as Claude
  participant T as Tools (taskScope(user))
  participant DB as Database
  U->>API: "Which tasks are overdue and who owns them?"
  API->>C: history + question + 6 tool definitions
  C-->>API: tool_use search_tasks{overdue_only:true}, get_team_overview{}
  API->>T: run both (scoped to the user)
  T->>DB: SELECT … WHERE teamId=… [AND assignee/creator = user]
  T-->>API: JSON results
  API->>C: tool_result × 2
  C-->>API: final answer (Markdown)
  API->>DB: append turn to AiConversation
  API-->>U: answer + "searched tasks, checked team overview"
```
