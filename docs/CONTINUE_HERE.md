# Start here: project handoff

Checkpoint: 31 October 2026. The user asked to finish the chatbot and wrap up for now, preserving the plan so another agent can continue. **Do not continue building ML merely because it was in the earlier plan; wait for the user's next instruction to resume it.**

## Delivered and pushed

Repository: <https://github.com/batoredev/ADR-Reporter>.

The application branch is **`claude/compassionate-wright-7bah72`**, the repository's current default branch. Keep the existing branch/deployment arrangement unless the user requests a change.

| Delivery | State | Commit |
| --- | --- | --- |
| Focused UI redesign and plain product copy | Complete, pushed | `911273b` |
| Persistent chatbot reporting and batch extraction | Complete, pushed | `2023f3e` |
| Supervised extraction learning | Incomplete draft, saved separately; not deployed | `20be188` on `wip/supervised-extraction-pipeline` |

The chatbot implementation is complete. **Hosted activation still requires the user to run the Supabase setup below.** No hosted schema changes, secret changes or API deployment were performed during this delivery. A successful API health response alone does not prove the new chatbot API is deployed; it must include `features.reportChat: true`.

## User decisions to preserve

- Delivery order: UI first push, chatbot second push, full ML third push.
- Remove model names, provider names, fallback/pricing explanations and other backend workings from product screens. Use plain task language. Keep source quotes, uncertainty and meaningful verification controls.
- English only. Fictional/testing data only for now; the user will explicitly inform us before real clinical use.
- Free-first cloud services: Ollama, then Gemini; paid access remains controlled by **`ALLOW_PAID_AI = false`** in `src/server/ai/config.ts`.
- Upload limits: JPG/PNG/PDF, 20 files, 10 MB per file, 50 MB per batch; the implemented PDF bounds are 20 pages per PDF and 100 pages per batch.
- No labelled dataset yet. Local hardware only; no paid training or hosting purchases.
- Prepare migrations and deployment commands for the user to run. Do not block on Supabase CLI login or use the hosted database as a test database.
- User asked to finish the chatbot and stop for now on this checkpoint. Future ML work needs an explicit resume request.

## Activate the delivered chatbot

Follow [CHATBOT_SETUP.md](CHATBOT_SETUP.md). From PowerShell in the application checkout:

```powershell
npm ci
npm run chatbot:prepare
npm run build:api
npx --yes supabase@2.106.0 login
npx --yes supabase@2.106.0 secrets set --env-file supabase/.env.chat --project-ref keoojymdmpnrwlmngaro
```

Open **`supabase/.env.chatbot-setup.sql` locally**, copy its full contents into this project's Supabase SQL Editor and run it. This generated private file contains the combined additive schema migration, Prisma history entry, worker credential in Vault and scheduled queue worker. It is safe to rerun. Do not commit or share it.

```powershell
npx --yes supabase@2.106.0 functions deploy api --project-ref keoojymdmpnrwlmngaro --no-verify-jwt --use-api
Invoke-RestMethod "https://keoojymdmpnrwlmngaro.supabase.co/functions/v1/api/health" | ConvertTo-Json -Depth 4
```

Expected: `ok: true` and `features.reportChat: true`. The frontend is <https://adr-reporter.pages.dev> and uses the existing GitHub/Cloudflare deployment integration. Until the new API advertises support, the assistant is disabled on the new-report screen. Existing form and guided reporting remain available.

Existing Ollama/Gemini secrets continue to be used. No new model key is required for this chatbot delivery. The preparation script preserves the existing local worker secret. Do not run `db:reset`, reseed the hosted database, or apply the unfinished ML migration.

## Architecture and where to continue

The frontend is a static Next.js 16 export on Cloudflare Pages. It authenticates through the project's own session API. A Supabase Edge Function serves the bundled Node-compatible API; Prisma uses PostgreSQL. Private documents are stored through `StoredFile` records and authenticated file routes. The API source is under `src/server`; regenerate the tracked Edge bundle with `npm run build:api` after backend changes.

Read `AGENTS.md` and the relevant guides in `node_modules/next/dist/docs/` before changing Next.js code; this installed version has changed APIs. No delegation/subagents are required by the repository.

| Area | Main files |
| --- | --- |
| Overall execution plan | `docs/CHATBOT_ML_EXECUTION.md` |
| Deployment and operator instructions | `docs/CHATBOT_SETUP.md`, `scripts/prepare-chatbot-deploy.mjs` |
| Report assistant page | `src/app/(app)/reports/chat/page.tsx`, `chat-view.tsx` in the same directory |
| Candidate review | `src/components/report-chat/fact-review.tsx` |
| Allowed fields, validation and questions | `src/lib/domain/report-chat.ts` |
| Extended document extraction schema | `src/lib/domain/chat-extraction.ts` |
| Conversation persistence and applying checked details | `src/server/workflow/report-chat.ts` |
| Upload batches, PDF pages and leased jobs | `src/server/workflow/chat-documents.ts` |
| Browser PDF rendering | `src/lib/api/prepare-pdf.ts`, `scripts/prepare-site.mjs` |
| Document extraction and quality checks | `src/server/workflow/extraction.ts`, `src/server/ai/` |
| API endpoints and health feature flag | `src/server/api/routes.ts` |
| Shared form, review and PDFs | `src/server/workflow/cases.ts`, `review.ts`, `src/server/pdf/` |
| Chatbot schema | `prisma/schema.prisma`, `prisma/migrations/202610310001_chat_reporting/migration.sql` |
| Public SQL equivalent | `supabase/migrations/007_chat_reporting.sql` |
| Live fictional smoke check | `scripts/check-chat-provider.ts` (`npm run ai:chat-check`) |

Chatbot flow: save a draft → atomically upload/deduplicate files → render PDF pages → durable page jobs → collect source-linked candidate facts → resolve conflicts/identity and medicine roles → user confirms selected details → apply to the common form with version checks → ask only remaining applicable questions → normal checks/narrative/review/PDF flow.

Conversation, uploads and apply actions use idempotency identifiers. Job leases recover expired work. Retryable failures preserve files and progress. Source-page provenance, uncertainty, explicit unavailable answers, skipped facts and user edits are separate concepts. Do not replace these with a single opaque conversation prompt or auto-apply model output.

## Verification evidence

The chatbot delivery passed the full **105-test unit/database suite and 19 browser tests**, followed by three additional database checks for exhausted job recovery, extra approximate-date facts and safe medicine-role handling. The final chatbot-focused subset contains **16 unit/database checks**. Both document and free-text chat smoke checks passed against the configured live service using fictional input. Static production export, API build and lint passed.

At the wrap-up checkpoint, the entire updated **108-test unit/database suite**, lint and all **three chatbot browser tests** passed again on the application branch. The browser checks cover batch photos/multi-page PDFs becoming verified form details without duplicate medicines, phone refresh recovery, and safe fallback when a hosted API has not enabled chat.

The production static export and API bundle were then rebuilt successfully. The static output was checked to contain the hosted API address and no browser-test API address. Private deployment files and local ML artifacts remain ignored by Git.

Automated workflow tests use fixture replies and an isolated local database. They establish workflow behavior; they do not establish clinical extraction accuracy. Human source review remains necessary. Uploads, rejected suggestions and report edits do **not** automatically train weights.

To rerun locally, use an explicitly isolated, migrated and seeded PostgreSQL database:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/adr_ai_test?schema=public'
npx vitest run tests/unit/report-chat.test.ts tests/integration/report-chat.test.ts
npx playwright test tests/e2e/chat-report.spec.ts
npm run lint
npm run build
npm run build:api
```

Playwright builds a temporary static export for API port 8100. Run `npm run build` afterward to restore the production API address. Browser tests require Chromium; optionally set `TEST_BROWSER_EXECUTABLE` to an existing compatible executable. `scripts/with-test-db.mjs` guards migration commands against accidentally using a different `DATABASE_URL`. Never print `.env` contents.

## Saved ML work: explicitly unfinished

The separately pushed **`wip/supervised-extraction-pipeline`** branch preserves the draft source files, schema export and dependency pins. It is a recovery checkpoint, **not the third delivery**. It has not passed build or tests. It is intentionally absent from the application branch so its unfinished migration and TypeScript do not affect the delivered app.

Use a separate checkout when resuming:

```powershell
git fetch origin
git worktree add ../ADR-Reporter-ml wip/supervised-extraction-pipeline
```

Read that branch's `ml/DRAFT_STATUS.md` before changing anything. Its `202610310002_supervised_learning` migration is generated DDL only, unapplied even to the local test database, and still needs constraints, RLS and immutability protection. **Do not deploy it as supplied.**

Drafted: eight Prisma models for document permissions, immutable label revisions/reviews, datasets/samples, training runs, model versions and deployment state; label/reason validation; connected-source split logic; field/entity/source-support metrics and release policy; partial reviewer backend. Missing: completed APIs and annotation UI, safe sealed exports, actual trainer/checkpoints, independent evaluation/registry/release/rollback, authenticated inference integration, complete migrations and tests. No supervised training run has occurred and no trained adapter has been released.

Local preparation on the original computer: Python 3.12.2, RTX 3050 Laptop GPU with 4 GB VRAM, a CUDA-enabled `.venv-ml`, torch 2.8.0+cu128, torchvision 0.23.0+cu128, transformers 4.57.6 and PEFT 0.18.1. Downloaded base: `HuggingFaceTB/SmolVLM-256M-Instruct`, immutable revision `7e3e67edbbed1bf9888184d9df282b700a323964`, under ignored `ml/artifacts/base-model/`. Weights, environment, datasets and private receipts are local and **not** pushed. A new machine must recreate these. Downloading a pretrained base is not training.

Meaningful release work needs varied fictional/de-identified uploads, explicit training/evaluation permission, document-only transcription/labels and a second independent reviewer. Keep patient/case/duplicate sources in one split, seal test labels from the trainer, compare against the existing extractor, and reject synthetic-only pilots for application promotion. The provisional engineering gates are not clinical validation standards. Real clinical use would require a separate review once the user requests it.

Other local state: `docs/design/` contains the earlier large design previews, is untracked, and was deliberately left alone. Do not delete it or accidentally include it in a code commit. `.env`, `supabase/.env.*`, `.venv-ml`, `ml/artifacts`, `ml/data`, `ml/runs`, `storage` and test output are private/ignored; never commit their contents.

## Suggested continuation request

> Read AGENTS.md, docs/CONTINUE_HERE.md and docs/CHATBOT_ML_EXECUTION.md. UI and chatbot are delivered. First check whether I have applied CHATBOT_SETUP.md. Resume the full ML third delivery only if I explicitly request it; use the saved WIP branch as a draft, finish and verify it, then push. Preserve English/testing-only/local-compute/free-first choices and keep backend/model details out of product UI.
