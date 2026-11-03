# Local setup

Tested on Windows 10 with Node 22.14 and npm 10.9. The same steps work on macOS and Linux.

## 1. Install and seed

```bash
npm run setup
```

This command does the following:

1. Runs `npm install` in `server/`, `web/` and `mobile/`. The server's `postinstall` runs `prisma generate`.
2. Creates `server/.env` if it does not exist (see step 2).
3. Applies migrations to `server/prisma/dev.db`.
4. Seeds the demo team. The seed is deterministic and can be re-run at any time with `npm --prefix server run db:seed`.

## 2. Configure the server

`npm run setup` creates `server/.env` from `server/.env.example` with a freshly generated `JWT_ACCESS_SECRET`. It never overwrites an existing file. Every variable is documented in that file. The ones that matter:

| Variable | Why |
|---|---|
| `JWT_ACCESS_SECRET` | Signs access tokens. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `AI_API_KEY` | Enables the AI chatbot and AI-written reports with a **free Google Gemini key** (see "Get a free AI key" below). Without it the app still runs: the assistant reports that AI is not configured, and reports fall back to a rule-based narrative. |
| `SMTP_*` *(optional)* | Real email delivery. Without it, email runs in **log mode**: messages are rendered and stored, and you can view them under **Automation → Email outbox**. |

Details for each secret are in [SECURITY.md](SECURITY.md).

### Get a free AI key (about 2 minutes)

1. Go to https://aistudio.google.com/apikey and sign in with any Google account.
2. Click **Create API key** and copy it. No credit card is needed.
3. In `server/.env` set `AI_API_KEY=<your key>`. `AI_PROVIDER=gemini` and `AI_MODEL=gemini-3.5-flash-lite` are already there.
4. Restart the server. It prints `AI: gemini / gemini-3.5-flash-lite`.

The free tier limits how many requests you can make per minute and per day. One assistant question uses 2-4 requests, because the AI looks data up before answering. That's plenty for a demo. If you hit the limit, the app says so and you can retry a minute later. Google may use free-tier prompts to improve its products, which is fine for the fake demo data.

### Real email for free with Gmail (optional)

Without SMTP settings, emails are only shown in **Automation → Email outbox**. That is enough to demonstrate the feature. To make them really arrive:

1. Your Google account needs **2-Step Verification** turned on: https://myaccount.google.com/security
2. Create an **App password** at https://myaccount.google.com/apppasswords (name it "Nesma") and copy the 16-character password.
3. In `server/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=you@gmail.com
   SMTP_PASS=the16charapppassword
   EMAIL_FROM=
   ```
   Leave `EMAIL_FROM` empty: it defaults to your Gmail address, which Gmail requires.
4. Restart the server. Automation shows **Email delivery ✓ SMTP**.

Emails go to the users' addresses. The demo accounts use made-up `@nesma.dev` addresses, so to receive one, create a member under **Team** with your real email (or change a demo user's email) and assign them a task. Gmail allows about 500 emails a day.

## 3. Run the server and the web app

```bash
npm run dev:server     # http://localhost:4000 (auto-reload)
npm run dev:web        # http://localhost:5173 (proxies /api and /socket.io to :4000)
```

Open http://localhost:5173 and sign in as `leader@nesma.dev` / `Nesma@2026`. The login page has one-click demo account links in development.

To see realtime sync, open a second browser profile signed in as `sara@nesma.dev`. Assign a task to Sara as the leader: her notification bell updates immediately, and the email appears in the outbox.

## 4. Run the mobile app

```bash
npm run dev:mobile     # = cd mobile && npx expo start
```

The app finds the API automatically in development. It uses the IP of the machine running Metro, on port 4000, so the phone and the computer must be on the same Wi-Fi network. To override the URL:

- set `EXPO_PUBLIC_API_URL=http://192.168.1.20:4000` in `mobile/.env`, or
- tap **Server: … · change** on the login screen. The URL is saved on the device.

Allow inbound connections to port 4000 in the computer's firewall.

### Notifications on the phone with zero setup

In **Expo Go** (Android or iPhone) the app shows a phone notification for every assignment, reminder, overdue alert, comment and so on while the app is running. It receives them over the live connection, so no Expo account, project id or Firebase is needed. This is the recommended way to demo.

Real *remote* push, which also arrives when the app is fully closed, needs the extra steps below. They are optional.

### Expo Go vs development build

| Feature | Expo Go | Development build |
|---|---|---|
| Tasks, chat, AI assistant, live sync, in-app inbox | ✅ | ✅ |
| Phone notifications while the app is open or in recent apps | ✅ (no setup) | ✅ |
| Remote push notifications (iOS) | ✅ (with EAS project id) | ✅ |
| Remote push notifications (Android) | ❌ (removed from Expo Go in SDK 53) | ✅ |

The quickest demo is to scan the QR code with Expo Go. For push on Android, make a development build:

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest init                    # writes extra.eas.projectId into app.json (needed for push tokens)
npx eas-cli@latest build --profile development --platform android
# or locally, with Android Studio installed:
npx expo run:android
```

Android push also needs FCM credentials uploaded to EAS (`npx eas-cli credentials`); see https://docs.expo.dev/push-notifications/fcm-credentials/. The server needs no extra configuration for push: it sends through the Expo Push Service using each device's token.

On first launch the app asks for notification permission and registers its push token with the API (`POST /api/users/me/push-token`). If push is unavailable (simulator, Expo Go on Android, no project id), the **Inbox** tab shows why. Everything else keeps working.

## 5. Run the tests

```bash
npm test                 # server test suite (Vitest + Supertest, uses its own prisma/test.db)
npm run typecheck        # server tsc + web production build + mobile tsc
cd mobile && npx expo lint
```

## 6. Try the live AI

With `AI_API_KEY` set:

```bash
npm --prefix server run ai:smoke
```

This asks the chatbot one question as the leader and one as a member, prints which database tools the AI called, and writes last month's report narrative. It shows that answers come from real data and respect each user's permissions.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid server configuration: JWT_ACCESS_SECRET` | The secret must be at least 32 characters. |
| Mobile: "Can't reach the server at …" | Same Wi-Fi network? Firewall allows port 4000? Is the server URL on the login screen correct? |
| Web: signed out after every reload | Open the app via the Vite URL (`:5173`), not the API port, so the refresh cookie is same-origin. |
| AI answers "AI is not configured" | Set `AI_API_KEY` in `server/.env` and restart the server. |
| AI says "free AI quota is used up" | Gemini free tier limits requests per minute/day. Wait a minute, or keep `AI_MODEL=gemini-3.5-flash-lite` (largest free quota). |
| Reset demo data | `npm --prefix server run db:seed` |
