import "dotenv/config";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().optional().default(""),
  APP_URL: z.string().optional().default(""),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default(""),

  // "gemini" (free tier), "openai" (any OpenAI-compatible API: Groq, OpenRouter,
  // Ollama...) or "anthropic" (Claude). Empty = Claude if its key is set, else Gemini.
  AI_PROVIDER: z.enum(["gemini", "openai", "anthropic", ""]).optional().default(""),
  AI_API_KEY: z.string().optional().default(""),
  AI_BASE_URL: z.string().optional().default(""),
  AI_MODEL: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_AUTH_TOKEN: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  // Render sets this automatically to the service's public https URL.
  RENDER_EXTERNAL_URL: z.string().optional().default(""),

  EXPO_ACCESS_TOKEN: z.string().optional().default(""),

  CRON_DEADLINE_CHECK: z.string().default("*/10 * * * *"),
  CRON_MONTHLY_REPORT: z.string().default("0 7 1 * *"),
  REMINDER_WINDOW_HOURS: z.coerce.number().positive().default(24),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid server configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;

// On Render the public URL is known only at runtime; use it unless overridden.
config.APP_URL ||= config.RENDER_EXTERNAL_URL || "http://localhost:5173";
config.CORS_ORIGINS ||= config.RENDER_EXTERNAL_URL || "http://localhost:5173";
// Gmail and most providers require the sender to be the authenticated account.
config.EMAIL_FROM ||= config.SMTP_USER ? `Nesma Tasks <${config.SMTP_USER}>` : "Nesma Tasks <no-reply@nesma.local>";

if (config.NODE_ENV === "production" && config.JWT_ACCESS_SECRET.startsWith("change-me")) {
  console.error("Refusing to start in production with the example JWT_ACCESS_SECRET.");
  process.exit(1);
}

export const corsOrigins = config.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
export const isProd = config.NODE_ENV === "production";
