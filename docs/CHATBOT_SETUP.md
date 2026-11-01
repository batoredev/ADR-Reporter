# Chatbot delivery: deployment and testing

The UI delivery is commit `911273b`; the completed chatbot delivery is `2023f3e`. See [CONTINUE_HERE.md](CONTINUE_HERE.md) for the current handoff and saved unfinished ML work. All data in this phase is fictional/testing data, English only, with no paid compute. Clinical use and clinical validation are outside this delivery.

## Activate it on the websites only (no computer setup)

Everything happens in the Supabase dashboard; GitHub is only used to copy files. Nothing is installed locally.

1. **Database tables.** Open `supabase/migrations/007_chat_reporting.sql` on GitHub, select **Copy raw file**, paste it
   into Supabase **SQL Editor → New query** and select **Run**. It adds the report assistant's tables and is safe to
   rerun.
2. **Background worker.** Do the same with `supabase/migrations/008_chat_worker_schedule.sql`. It enables `pg_cron`
   and `pg_net`, creates a random worker secret inside Supabase Vault and schedules the reading queue once a minute.
   The result shows one value, `chat_worker_secret`. The file itself contains no secret, so it is public; the value it
   shows is private.
3. **Secrets.** In **Edge Functions → Secrets**, add `CHAT_WORKER_SECRET` with the value from step 2. To read PDF
   files, also add `GEMINI_API_KEY` (Ollama reads photos only). Keep `OLLAMA_API_KEY` as it is.
4. **API.** Open **Edge Functions → api → Code**, replace everything with `supabase/functions/api/index.ts` (copy raw
   file from GitHub) and select **Deploy**. Keep **Verify JWT** off.
5. **Check.** <https://keoojymdmpnrwlmngaro.supabase.co/functions/v1/api/health> should show
   `{"ok":true,"features":{"reportChat":true}}`. The website (Cloudflare Pages) already contains the assistant and
   switches it on once the API reports this.

If step 2 reports that an extension is unavailable, enable `pg_cron` and `pg_net` under **Database → Extensions**,
then run the file again. Before release these steps were checked on Supabase's own PostgreSQL image (all SQL files
001-008 in order, reruns, the Vault secret and a real scheduled run) and the generated API was run in Supabase's Edge
Runtime (batch upload, PDF page, reading jobs, applying details, follow-up question, PvPI PDF, worker secret check).

## Or run this from PowerShell in the repository

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

## How the assistant fills the report (since 1 November 2026)

There is no per-detail approval any more. Readings and answers go straight into the report, and the reporter confirms
the whole report once, on **Review and submit** (the declaration covers everything filled automatically). Rules:

- The reporter's own answers override document readings and earlier answers; a document never overwrites a value
  already in the report (the difference is noted for the final look).
- Documents whose patient initials differ from the report are held back until the reporter says they belong.
- The same medicine from several sources is entered once, matched by ingredient ("Cap. Amoxycillin 500mg" =
  "amoxicillin"; common brand names such as Dolo or Augmentin are known). Look-alike names (ampicillin/amoxicillin,
  prednisone/prednisolone) are never merged; they are flagged.
- A new medicine is placed only after one question: suspected, another medicine, given to treat the reaction, or not
  relevant. Medicines described as given for the reaction are placed as treatment without asking.
- The route is filled in from an unambiguous dosage form (nasal spray → Nasal, eye drops → Ophthalmic, tablet → Oral);
  an injection without IV/IM/SC is asked.
- "Not sure", "n/a", "don't know" and similar answers are recorded as not known; they are never saved as values, and an
  optional question is skipped after two answers that cannot be used. Optional questions can be skipped together.
- Unclear readings, differing sources, held documents and similar names are listed under **Please take a quick look**
  in the assistant and on the submit page. Submitting marks every automatically filled value as confirmed.

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

The wrap-up check reran the full updated 108-test unit/database suite, all three chatbot browser checks and lint successfully. Deployment preparation was rerun locally and preserved the worker secret; it made no hosted changes.

Automated tests use saved replies, isolated PostgreSQL and fictional documents. They verify workflow correctness rather than clinical extraction accuracy. Provider output can still be wrong; source review remains necessary. Uploads and saved corrections do not automatically retrain a model. The supervised training/release pipeline is the third delivery and requires independently checked document labels for a meaningful trained extractor.
