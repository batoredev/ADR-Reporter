// Runs a command with DATABASE_URL pointed at TEST_DATABASE_URL, so test
// setup never touches the development database.
//   node scripts/with-test-db.mjs npm run db:init
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("TEST_DATABASE_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL must point to a different database than DATABASE_URL.");
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, DATABASE_URL: testUrl },
});
process.exit(result.status ?? 1);
