// Creates server/.env from .env.example on first setup, with a freshly
// generated JWT secret. Never overwrites an existing .env.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, ".env");
if (fs.existsSync(target)) {
  console.log("server/.env already exists - leaving it unchanged.");
} else {
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(target, example.replace("change-me-access-secret-at-least-32-chars", secret));
  console.log("Created server/.env with a random JWT_ACCESS_SECRET. Add ANTHROPIC_API_KEY to enable AI.");
}
