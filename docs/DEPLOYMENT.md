# Deployment

## Public demo link with no account or credit card (recommended)

```bash
npm run demo:public
```

This builds the app, starts it on your PC in production mode, and opens a free **Cloudflare quick tunnel**. You get a public link such as `https://some-random-words.trycloudflare.com` that works from any browser or phone, websockets and live updates included. On Windows the script downloads Cloudflare's official `cloudflared` the first time it runs.

- **Web:** open the link. The demo logins are shown on the sign-in page.
- **Mobile:** on the app's login screen tap **Server: … · change** and paste the link.
- The link works **while that terminal stays open and the PC is awake**. Every run creates a new random link.
- Data is the normal local database, so it persists between runs. Reset it with `npm --prefix server run db:seed`.
- Uses port 4100, so it can run alongside `npm run dev:server`. Use `npm run demo:public -- --no-build` to skip rebuilding.

### Permanent link to submit

The tunnel link changes on every run, so submit this instead:

**https://basem1166.github.io/nesma-demo/**

It's a tiny GitHub Pages page in the public repo [`Basem1166/nesma-demo`](https://github.com/Basem1166/nesma-demo). It contains only that page, no app code. `npm run demo:public` updates its `link.json` through the GitHub CLI each time it starts, so the permanent link forwards to the current tunnel within about a minute. Pressing **Ctrl+C** marks the demo offline, and visitors then see "The live demo is offline right now" instead of a dead link. If the window is closed instead of using Ctrl+C, the page keeps the old address until the next run.

For a different account or repo, create a public repo with the same `index.html` and `link.json`, enable Pages on `main`, and set `DEMO_LINK_REPO=<owner>/<repo>`.

Verified: the full end-to-end workflow script (`BASE_URL=<link> npm --prefix server run e2e:demo`) passes through the public link, including realtime events, the AI assistant, and browser sign-in with the secure cookie.

## Hosted demo on Render (may ask for a card)

The repository also includes a [`render.yaml`](../render.yaml) Blueprint. Render may require a credit card for verification, even on the free plan.

1. Sign up at https://render.com using **Sign in with GitHub**.
2. Go to **New → Blueprint**, pick this repository and click **Connect**.
3. Render asks for the secret values:
   - `AI_API_KEY`: paste your free Gemini key (see [SETUP.md](SETUP.md#get-a-free-ai-key-about-2-minutes)).
   - `SMTP_*` and `EMAIL_FROM`: leave empty to keep the in-app Email outbox, or fill in the Gmail values from SETUP.md.
4. Click **Apply**. The first build takes about 5 minutes. You get a URL like `https://nesma-tasks-xxxx.onrender.com`.
5. Open it and sign in with `leader@nesma.dev` / `Nesma@2026`. The demo accounts are listed on the login page.
6. Mobile: in the app's login screen tap **Server: … · change** and enter the Render URL. Or set `EXPO_PUBLIC_API_URL=https://nesma-tasks-xxxx.onrender.com` in `mobile/.env` before `npx expo start`.

**How the free plan behaves:**

- The service **sleeps after about 15 minutes without traffic**. The next visit takes about a minute to wake it, so open the URL a minute before you present.
- The disk is wiped on every restart or sleep, so the demo database is **re-created with fresh demo data automatically** (`db:seed-if-empty`). Changes made during a demo don't persist past a restart. For a persistent setup, use PostgreSQL as described below.
- Every push to `main` on GitHub redeploys automatically.

---

The rest of this document covers a full production setup.

The production layout is **one Node process** that serves the API, the Socket.IO gateway, the scheduler and the built web app (same origin, so the refresh cookie and websockets need no CORS). It runs behind an HTTPS reverse proxy and uses a managed PostgreSQL database. The mobile app is built with EAS and points at the public API URL.

```mermaid
flowchart LR
  U[Browsers / phones] -- HTTPS + WSS --> P[Reverse proxy / load balancer<br/>TLS termination]
  P --> N[Node: server/dist/index.js<br/>API + web/dist + Socket.IO + cron]
  N --> PG[(Managed PostgreSQL)]
  N --> SMTP[SMTP provider]
  N --> CL[AI: Gemini / Claude]
  N --> EX[Expo Push → APNs/FCM]
```

## 1. Database: PostgreSQL

1. Create a database and a dedicated user, for example `postgresql://nesma:***@db.host:5432/nesma?sslmode=require`.
2. In `server/prisma/schema.prisma` set `provider = "postgresql"`.
3. Replace the SQLite migration with a PostgreSQL one. Run this once, from a machine that can reach an empty PostgreSQL database:
   ```bash
   cd server
   rm -rf prisma/migrations
   DATABASE_URL=postgresql://… npx prisma migrate dev --name init
   ```
   Commit the generated migration. Later deploys only run `npm run db:deploy` (`prisma migrate deploy`).
4. Optional: seed demo data with `npm run db:seed`. **Do not seed a real production database:** the seed deletes all data first.

## 2. Build

```bash
npm --prefix server ci && npm --prefix web ci
npm run build          # web → web/dist, server → server/dist
```

## 3. Configure

Set these environment variables through the platform's secret manager (see [SECURITY.md](SECURITY.md)):

```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://…
APP_URL=https://tasks.example.com          # links in emails
CORS_ORIGINS=https://tasks.example.com
JWT_ACCESS_SECRET=<48 random bytes>
SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=… EMAIL_FROM="Nesma Tasks <tasks@example.com>"
AI_PROVIDER=gemini AI_API_KEY=…   # or AI_PROVIDER=anthropic ANTHROPIC_API_KEY=…
```

## 4. Run

```bash
cd server && npm run db:deploy && npm start
```

Keep it running with your platform's process manager (systemd, PM2, a container, or Render/Railway/Fly/App Service). `GET /api/health` is the health check.

**Reverse proxy.** Forward websockets and set `X-Forwarded-*` headers. Example for nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

HTTPS is required in production: the refresh cookie is `Secure`, and iOS and Android block plain HTTP by default.

## 5. Scaling notes

- **Scheduler.** Reminder and overdue claims use conditional updates, so several instances never double-send. Monthly reports are idempotent per team and month. To run more than one instance, either keep cron on one instance, or accept that the instances race safely.
- **Realtime across instances.** Add the Socket.IO Redis adapter (`@socket.io/redis-adapter`) so events published on one instance reach clients connected to another, and enable sticky sessions on the load balancer.
- **Rate limits** use in-memory counters. Behind several instances, switch `express-rate-limit` to a Redis store.

## 6. Mobile app release

```bash
cd mobile
npx eas-cli@latest init                       # once: links the project, writes extra.eas.projectId
# point the app at production:
echo "EXPO_PUBLIC_API_URL=https://tasks.example.com" > .env
npx eas-cli@latest credentials                # upload FCM (Android) / set up APNs (iOS)
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform all      # App Store / Play Store
```

JavaScript-only changes can be shipped over the air with `npx eas-cli@latest update`.
