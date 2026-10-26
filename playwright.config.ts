import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// Browser tests run the real setup locally: the static site (out/) and the API
// against TEST_DATABASE_URL. The API runs on Node.js, or as the Supabase Edge
// Function bundle under Deno when DENO_BIN points to a Deno executable.
const SITE_PORT = 3100;
const API_PORT = 8100;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is not set. Add it to .env (see .env.example).");
}
const API_URL = `http://localhost:${API_PORT}/api`;

const apiEnv = {
  DATABASE_URL: testDatabaseUrl,
  API_PORT: String(API_PORT),
  // The saved test fixture stands in for the AI provider, so tests need no API key or network.
  AI_PROVIDER: "fixture",
  DEMO_MODE: "true",
  // The Edge Function fetches the blank PvPI form from the website.
  FORM_TEMPLATE_URL: `http://localhost:${SITE_PORT}/forms/pvpi-adrrf-v1.4.pdf`,
};
const deno = process.env.DENO_BIN;

export default defineConfig({
  testDir: "tests/e2e",
  // One worker: the tests share one seeded database.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: deno
        ? `node scripts/build-api.mjs && "${deno}" run -A supabase/functions/api/index.ts`
        : "npx tsx src/server/api/node-server.ts",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: apiEnv,
    },
    {
      command: `npm run build && node scripts/serve-static.mjs out ${SITE_PORT}`,
      url: `http://localhost:${SITE_PORT}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
