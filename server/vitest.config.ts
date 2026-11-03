import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    // All suites share one SQLite file, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "file:./test.db",
      JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
      // Pin the AI setup so a developer's server/.env never leaks into tests.
      AI_PROVIDER: "anthropic",
      AI_API_KEY: "",
      ANTHROPIC_API_KEY: "test-key-not-used",
      SMTP_HOST: "",
      APP_URL: "http://localhost:5173",
    },
  },
});
