-- ADR Reporter: background reading for the report assistant. Safe to rerun.
-- Run in the Supabase SQL Editor after 007_chat_reporting.sql.
--
-- This file holds no secret. It creates a random worker secret inside Supabase
-- Vault (once; reruns keep it) and schedules the document queue to be read once
-- a minute. The last statement shows the secret: copy it into Edge Functions ->
-- Secrets as CHAT_WORKER_SECRET. Never share it or commit it.
--
-- For a different Supabase project, replace keoojymdmpnrwlmngaro in the URL below
-- with that project's reference (and ap-south-1 with its database region).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $adr_worker_vault$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'adr_chat_worker_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'adr_chat_worker_secret',
      'ADR report document queue'
    );
  END IF;
END
$adr_worker_vault$;

-- Scheduling under the same name replaces the earlier schedule.
SELECT cron.schedule('adr-chat-extraction-worker', '* * * * *', $adr_worker_schedule$
  SELECT net.http_post(
    url := 'https://keoojymdmpnrwlmngaro.supabase.co/functions/v1/api/internal/chat-jobs/process?forceFunctionRegion=ap-south-1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'adr_chat_worker_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 145000
  );
$adr_worker_schedule$);

-- Copy this value into Edge Functions -> Secrets as CHAT_WORKER_SECRET.
SELECT decrypted_secret AS chat_worker_secret FROM vault.decrypted_secrets WHERE name = 'adr_chat_worker_secret';
