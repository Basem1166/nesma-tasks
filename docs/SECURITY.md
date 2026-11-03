# Security & secure configuration

## 1. Managing secrets

All secrets are read from environment variables, which are validated at boot by [`server/src/config.ts`](../server/src/config.ts). The server refuses to start if a value is invalid, and in production it refuses to start with the example JWT secret.

- **Never commit `server/.env`.** It is git-ignored. Only `.env.example`, which contains no real values, is in the repository.
- **In production, inject secrets from the platform's secret store** (AWS Secrets Manager / SSM, Azure Key Vault, GCP Secret Manager, Render or Railway environment groups, Kubernetes Secrets) instead of shipping an `.env` file.
- Give each environment (dev, staging, prod) **its own** keys, so a leaked dev key cannot reach production data.
- The mobile app contains **no secrets**. It holds only the user's own session tokens. The AI key, the SMTP password and the JWT secret never leave the server.

### JWT signing secret: `JWT_ACCESS_SECRET`

- Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- Must be at least 32 characters. HS256, issuer-checked, 15-minute lifetime (`ACCESS_TOKEN_TTL`).
- **Rotation:** set a new value and restart. Access tokens signed with the old secret stop working within 15 minutes, and clients renew them silently with their refresh token, which is not tied to the JWT secret.

### Email (SMTP): `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`

- Use a **transactional email provider** (Amazon SES, SendGrid, Postmark, Mailgun, Microsoft 365) with a **dedicated SMTP credential or API-key-as-password** scoped to sending only. Do not use a personal mailbox password.
- Port 587 with `SMTP_SECURE=false` uses STARTTLS. Port 465 needs `SMTP_SECURE=true`.
- Verify the sending domain with SPF, DKIM and DMARC records so the emails are not marked as spam.
- **Leave `SMTP_HOST` empty in development.** In log mode no email leaves the machine; messages are stored in the `EmailLog` table and shown under *Automation → Email outbox*.
- Email delivery failures are recorded as `FAILED` with the error message and never break the user action that triggered them.
- Passwords are **never emailed**. The welcome email tells new members to get their temporary password from their team leader.

### AI: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (Gemini, default) or `ANTHROPIC_API_KEY` (Claude)

- **Gemini (free):** create the key at https://aistudio.google.com/apikey. On the free tier Google may use prompts and responses to improve its products, so use it only with demo data. For real company data use a paid Gemini key or Claude.

**Claude:**

- Create the key in the Claude Console (https://platform.claude.com) inside a **dedicated workspace** for this app. Set a **monthly spend limit** on that workspace.
- The key lives only on the server. Clients call `/api/ai/*`, which requires a signed-in user and is rate-limited to 12 questions per minute per user.
- `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. Requests opt in to the server-side refusal fallback (`fallbacks: "default"`) so a declined request is retried on the model's default fallback.
- **Rotation:** create a new key, update the secret, restart, then revoke the old key in the Console.
- **Data minimisation:** the AI only receives what its tools return for the current user's question, which is task titles, statuses, dates, names and comments. Passwords, emails of other users and tokens are never sent.

### Push: `EXPO_ACCESS_TOKEN` *(optional)*

Only needed if *Enhanced Security for Push Notifications* is enabled in the Expo account. APNs and FCM credentials are stored in EAS, not in this repository.

### Database: `DATABASE_URL`

In production, use a PostgreSQL user with rights to this database only, require TLS (`?sslmode=require`), and keep automated backups.

## 2. Security controls in the code

| Area | Control | Where |
|---|---|---|
| Passwords | bcrypt cost 12. Policy: at least 8 characters with upper, lower and a digit. Login takes the same time whether or not the email exists (dummy hash compare). Login is rate-limited to 10 attempts per 15 minutes per IP. | `auth/password.ts`, `routes/auth.ts` |
| Sessions | 15-minute access JWT kept in memory on the client. Opaque refresh token of 48 random bytes; only its SHA-256 hash is stored. **Rotated on every refresh**, and reuse of an old token revokes every session of that user. Logout revokes the token. Changing a password, resetting it, changing a role or deactivating an account revokes all sessions. | `auth/tokens.ts` |
| Token storage | Web: httpOnly, SameSite=Strict, Secure (in production) cookie scoped to `/api/auth`, so JavaScript cannot read it. Mobile: `expo-secure-store` (Keychain / Keystore). | `routes/auth.ts`, `mobile/src/lib/api.ts` |
| Authorisation | Role middleware for leader-only areas, and **one row-level rule** (`taskScope`) shared by the REST API *and the AI tools*. Members can only change status and progress of their own tasks. Every lookup is also filtered by team. | `services/tasks.ts`, `ai/tools.ts` |
| Input validation | Every body and query is parsed with zod schemas, with length limits on all strings. JSON bodies are capped at 100 kB. | all routes |
| Injection | Prisma uses parameterised queries; no raw SQL is built from input. Email templates HTML-escape every value. AI Markdown is rendered without raw HTML (react-markdown on web, a text-only renderer on mobile). Email previews are shown in a `sandbox` iframe. | `services/email.ts`, `web/src/components/ui.tsx` |
| AI safety | Tools are **read-only** and limited to the user's data. Tool inputs are validated with zod, and invalid input goes back to the model as an error result. The tool loop is capped at 8 rounds. Conversations belong to one user. Failed turns are not persisted. | `ai/chatbot.ts`, `ai/tools.ts` |
| HTTP hardening | `helmet` (CSP, HSTS, frame-ancestors, nosniff, etc.), CORS allow-list from `CORS_ORIGINS`, `x-powered-by` disabled, `trust proxy` for correct client IPs behind a load balancer. | `app.ts` |
| Realtime | Socket connections must present a valid access token. Users only join their own room and their team's room. | `services/realtime.ts` |
| Abuse | Rate limits on login and AI chat. Errors never leak stack traces (generic 500). | `routes/*.ts`, `lib/http.ts` |
| Audit | Task history (`TaskUpdate`) records who changed what. `EmailLog` records every email. `lastLoginAt` per user. | schema |
