// A local PostgreSQL for trying the app on this computer, with its data in .local-db/ (gitignored). Never used for
// real patient data, and never the hosted database.
//   npm run db:local        (leave it running; first run creates the database)
// Then, once: set DATABASE_URL below in .env and run `npm run db:init`.
import { existsSync } from "node:fs";

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
} catch {
  console.error("Install the local database once: npm install -D --save-exact embedded-postgres@17.5.0-beta.15");
  process.exit(1);
}

const dir = new URL("../.local-db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "adr",
  password: "adr_dev_password",
  port: 54330,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
if (!existsSync(dir)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("adr_reporter");
} catch {
  // already created
}
console.log("Local database ready. DATABASE_URL=postgresql://adr:adr_dev_password@127.0.0.1:54330/adr_reporter");
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
