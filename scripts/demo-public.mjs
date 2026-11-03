// Public demo without any hosting account or credit card.
//
//   npm run demo:public
//
// 1. Builds the web app + server (production mode).
// 2. Opens a free Cloudflare "quick tunnel" (no account needed) and gets a
//    public https://<random>.trycloudflare.com URL.
// 3. Starts the server on this PC behind that URL, serving the web app,
//    API and websockets. Phones and other computers can use it from anywhere.
//
// The link works while this window stays open and the PC is awake. A new
// random link is created each time. Data is the normal local database
// (server/prisma/dev.db), so it persists between runs.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.DEMO_PORT ?? "4100";
const toolsDir = path.join(root, ".tools");

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) return reject(new Error(`download failed: HTTP ${res.statusCode}`));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function cloudflaredPath() {
  try {
    execSync("cloudflared --version", { stdio: "ignore" });
    return "cloudflared";
  } catch {}
  if (process.platform !== "win32") {
    console.error("Install cloudflared first: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    process.exit(1);
  }
  const exe = path.join(toolsDir, "cloudflared.exe");
  if (!fs.existsSync(exe)) {
    fs.mkdirSync(toolsDir, { recursive: true });
    console.log("Downloading Cloudflare's official cloudflared (one time, ~60 MB)...");
    await download("https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe", exe);
  }
  return exe;
}

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

if (!process.argv.includes("--no-build")) {
  console.log("Building web app and server...");
  process.env.VITE_SHOW_DEMO_ACCOUNTS = "true";
  run("npm run build");
}
run("npx prisma migrate deploy", path.join(root, "server"));

const portFree = await new Promise((resolve) => {
  const probe = net.createServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
  probe.listen(Number(PORT));
});
if (!portFree) {
  console.error(`Port ${PORT} is already in use (is a demo already running?). Stop it or run with DEMO_PORT=4200.`);
  process.exit(1);
}

const tunnelBin = await cloudflaredPath();
console.log("Opening Cloudflare tunnel...");
const tunnel = spawn(tunnelBin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { cwd: root });

const publicUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timed out waiting for the tunnel URL")), 60_000);
  const onData = (buf) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  };
  tunnel.stdout.on("data", onData);
  tunnel.stderr.on("data", onData);
  tunnel.on("exit", (code) => reject(new Error(`cloudflared exited (${code})`)));
});

const server = spawn(process.execPath, ["dist/index.js"], {
  cwd: path.join(root, "server"),
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT,
    APP_URL: publicUrl,
    CORS_ORIGINS: publicUrl,
  },
});

console.log(`
==============================================================
  PUBLIC DEMO LINK:  ${publicUrl}

  Web:     open the link in any browser
  Mobile:  login screen -> "Server: ... change" -> paste the link
  Login:   leader@nesma.dev / Nesma@2026  (members: sara@, omar@,
           youssef@, laila@nesma.dev - same password)

  Keep this window open. Press Ctrl+C to stop.
  (The link may take ~30 seconds to start working.)
==============================================================
`);

const stop = () => {
  server.kill();
  tunnel.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  console.error(`Server stopped (${code}).`);
  tunnel.kill();
  process.exit(code ?? 1);
});
