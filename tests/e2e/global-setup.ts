import { execSync } from "node:child_process";

// Applies migrations to the test database and seeds it if it is empty.
// Never resets or wipes anything.
export default function globalSetup() {
  execSync("node scripts/with-test-db.mjs npm run db:init", { stdio: "inherit" });
}
