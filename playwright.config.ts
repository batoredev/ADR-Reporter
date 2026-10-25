import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run against a separate dev server wired to TEST_DATABASE_URL.
const PORT = 3100;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is not set. Add it to .env (see .env.example).");
}

export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the tests share one seeded database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // The saved test fixture stands in for the AI provider, so tests need no API key or network.
    env: { DATABASE_URL: testDatabaseUrl, AI_PROVIDER: "fixture", DEMO_MODE: "true" },
  },
});
