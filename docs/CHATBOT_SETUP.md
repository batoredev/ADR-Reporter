# Chatbot delivery: deployment and testing

The UI delivery is commit `911273b`. The chatbot is a separate delivery. All data in this phase is fictional/testing data, English only, with no paid compute. Clinical use and clinical validation are outside this delivery.

## Run this from PowerShell in the repository

```powershell
npm ci
npm run chatbot:prepare
npm run build:api
npx --yes supabase@2.106.0 login
npx --yes supabase@2.106.0 secrets set --env-file supabase/.env.chat --project-ref keoojymdmpnrwlmngaro
```

Open the generated **private** `supabase/.env.chatbot-setup.sql` locally, copy the entire file into the Supabase SQL Editor for this project, and run it once. This is one combined command: it applies the additive chatbot schema, records Prisma migration history, stores the worker credential in Vault and schedules reading once a minute. It is safe to rerun. Keep this generated file private; it contains the worker credential. Existing reports and users are preserved.

Then deploy the API:

```powershell
npx --yes supabase@2.106.0 functions deploy api --project-ref keoojymdmpnrwlmngaro --no-verify-jwt --use-api
Invoke-RestMethod "https://keoojymdmpnrwlmngaro.supabase.co/functions/v1/api/health"
```

Health should report `ok: true` and `features.reportChat: true`. Existing Ollama/Gemini secrets remain in place. `ALLOW_PAID_AI` stays `false`. The application uses its own signed-in sessions; the scheduled worker separately checks its private credential.

For another project, run `npm run chatbot:prepare -- yourprojectreference` and use that reference in the deployment commands. If Cron, pg_net or Vault is not enabled, enable the extension in the Supabase dashboard, then rerun the combined SQL. PDF page preparation resumes when the report is opened; background jobs read pages already prepared and stored.

The site deploys through the existing GitHub/Cloudflare integration. Until the API advertises chatbot support, the new-report screen keeps the assistant disabled and the existing form/guided modes remain usable. Redeploy the site if it has not picked up the pushed commit.

## Alternative: schema changes through Prisma

If `.env` contains the correct hosted `DATABASE_URL`, `npm run db:deploy` applies the same migration. Then run the generated combined SQL for the scheduler; it recognizes the migration history and skips already-applied schema changes. The public `supabase/migrations/007_chat_reporting.sql` is the schema-only equivalent for SQL Editor users.

Do not use `db:reset`. Do not reapply the original schema or demo seed to the existing hosted project.

## Working flow

1. Start a conversation or continue an existing draft with the report assistant.
2. Select/drop JPG, PNG and PDF files together: at most 20 files, 10 MB each, 50 MB per batch; PDFs at most 20 pages each and 100 pages per batch. Byte-identical files are deduplicated within the report.
3. Originals are saved atomically. Every PDF page is rendered locally using PDF.js, saved independently, and queued with its real page number. A refresh resumes missing pages. Each queued page has a lease, bounded retries and a separate retry control.
4. Source quotes, page numbers, differing values and unclear readings remain visible. Users choose medicine roles and confirm identity mismatches. Nothing is silently selected from conflicting sources.
5. Confirm selected details to fill the shared form atomically. Required versions and conversation revisions prevent stale writes; message/upload/apply identifiers prevent duplicate operations.
6. The question planner asks only unanswered applicable fields. A free-text answer can propose several facts, but each needs a quote present in the answer and must use an allowed field. Explicit unavailable answers remain distinct from missing mandatory information.
7. Continue in the form, run checks, draft a narrative, review/submit, complete institutional review and generate PDFs through the existing workflow.

Sources: [PDF.js rendering documentation](https://mozilla.github.io/pdf.js/examples/), [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets).

## Verification and limits

Validated with 19 passing browser checks, the 105-test unit/database regression suite and three additional recovery/date/medicine-role tests. `npm run ai:chat-check` passed against the configured live provider using the fictional prescription and a fictional multi-field message. The production static export and API bundle build passed.

Automated tests use saved replies, isolated PostgreSQL and fictional documents. They verify workflow correctness rather than clinical extraction accuracy. Provider output can still be wrong; source review remains necessary. Uploads and saved corrections do not automatically retrain a model. The supervised training/release pipeline is the third delivery and requires independently checked document labels for a meaningful trained extractor.
