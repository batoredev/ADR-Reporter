import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Preparation only: no database changes, API calls or deployments happen here.
const projectRef = process.argv[2] ?? "keoojymdmpnrwlmngaro";
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("Use your Supabase project reference.");
const name = "202610310001_chat_reporting";
const migration = readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8").replace(/\r\n/g, "\n");
const checksum = createHash("sha256").update(migration).digest("hex");
const publicSql = `-- Existing ADR Reporter project: chatbot upgrade, safe to rerun.\nBEGIN;\nDO $adr_chat_upgrade$\nBEGIN\nIF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='${name}' AND finished_at IS NOT NULL) THEN\n${migration}\nINSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES ('c18e8625-a8a7-4b50-9e70-f3e71e3d2f88','${checksum}',now(),'${name}',now(),1);\nEND IF;\nEND\n$adr_chat_upgrade$;\nCOMMIT;\n`;
writeFileSync("supabase/migrations/007_chat_reporting.sql", publicSql);
const secretFile = "supabase/.env.chat";
let secret = existsSync(secretFile)
  ? readFileSync(secretFile, "utf8").match(/^CHAT_WORKER_SECRET=([a-f0-9]{64})\s*$/m)?.[1]
  : undefined;
if (existsSync(secretFile) && !secret)
  throw new Error("The existing private worker file is not in the expected format; it was left unchanged.");
if (!secret) {
  secret = randomBytes(32).toString("hex");
  writeFileSync(secretFile, `CHAT_WORKER_SECRET=${secret}\n`, { mode: 0o600 });
}
const cronSql = `
-- Background reading of pages that have already been prepared. Run as the database owner.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $adr_worker_vault$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name='adr_chat_worker_secret' LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret('${secret}','adr_chat_worker_secret','ADR report document queue');
  ELSE
    PERFORM vault.update_secret(existing_id,'${secret}','adr_chat_worker_secret','ADR report document queue');
  END IF;
END
$adr_worker_vault$;
SELECT cron.schedule('adr-chat-extraction-worker','* * * * *',$adr_worker_schedule$
  SELECT net.http_post(
    url:='https://${projectRef}.supabase.co/functions/v1/api/internal/chat-jobs/process?forceFunctionRegion=ap-south-1',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='adr_chat_worker_secret' LIMIT 1)),
    body:='{}'::jsonb, timeout_milliseconds:=145000
  );
$adr_worker_schedule$);
`;
writeFileSync("supabase/.env.chatbot-setup.sql", publicSql + cronSql, { mode: 0o600 });
console.log("Prepared supabase/migrations/007_chat_reporting.sql (schema only).");
console.log("Prepared private supabase/.env.chat and supabase/.env.chatbot-setup.sql (schema + scheduled worker).");
console.log("No hosted changes made. Follow docs/CHATBOT_SETUP.md. Do not commit or share the private files.");
