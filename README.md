# ADR Reporter (prototype)

AI-assisted adverse drug reaction (ADR) reporting and institutional verification, aligned with the
**PvPI Suspected ADR Reporting Form, version 1.4**.

> **Academic proof of concept. Fictional data only.** Every account, patient and case in this app is invented.
> Do not enter real patient information.

- Current AI architecture and execution status: [`docs/AI_IMPLEMENTATION.md`](docs/AI_IMPLEMENTATION.md)
- Original plan: [`docs/ARCHITECTURE_PLAN.md`](docs/ARCHITECTURE_PLAN.md)
- Official form and its verified field map: [`docs/reference/`](docs/reference/)

## Build status

| Step                            | Scope                                                                                        | Status   |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| 1. Foundation                   | Setup, design style, database, fictional demo data, login, role-based navigation, dashboard  | **Done** |
| 2. Structured reporting         | PvPI form sections A–D, drafts, validation, submission                                       | **Done** |
| 3. AI assistance                | Guided reporting, document extraction, narratives, consistency checks                        | **Done** |
| 4. Review workflow + escalation | Shared queue, claim/release/reassign, checklist, comments, approve/return, urgent escalation | **Done** |
| 5. PDF + external tracking      | Filled official PvPI form, external submission records                                       | **Done** |
| 6. End-to-end check             | Unit, database and browser test suites                                                       | **Done** |

## What it does

1. **Report.** A reporter fills the PvPI form sections A–D. Drafts save automatically. Dates can be exact, month and
   year, year only, or approximate, and the official form never gets a made-up day. Fields that are genuinely unknown
   can be marked "Unknown". A completeness panel lists the mandatory fields that are still missing.
2. **AI assistance.** Choose guided questions or the structured form; both save the same answers. Upload fictional
   prescriptions, lab reports, discharge summaries or notes and select **Read with AI**. Verify each suggested value
   and its source text before applying it. Rough notes can become an editable narrative for item 7. **Check with AI**
   suggests contradictions and gaps, and saves your decisions for the reviewer. Draft narratives and extraction
   suggestions can be reopened after reload. AI does not determine causality or make submission decisions.
3. **Urgent escalation.** A potentially serious report can be escalated at any time, even as an incomplete draft. The
   designated urgent contacts are alerted without waiting for review. They acknowledge it, record any urgent
   notification made outside the app, and close it.
4. **Institutional review.** Submitted reports enter a shared queue, potentially serious ones first. A reviewer takes
   one up; two reviewers can never hold the same case. The reviewer works through a six-item checklist and raises issues
   on specific fields. An item can be marked as verified with an exception when information is genuinely unavailable.
   The reviewer then approves, or returns the report to the reporter. A returned report comes back to the same reviewer
   with the changed fields highlighted. Cases can be released to the pool or reassigned.
5. **Official PDF.** Approval fills the official PvPI form v1.4 and stores that PDF once, with a fingerprint (SHA-256
   hash). AMC/NCC-only identifiers, causality, receiving personnel and signatures are always left blank. Anything that
   does not fit goes on a continuation sheet. Earlier versions can be previewed as drafts.
6. **External submission tracking.** The app never sends reports itself. Coordinators record how and when the
   approved PDF was sent to the AMC or NCC, and any acknowledgement. Reviewers can see this list but cannot record on
   it.

Every action is written to an append-only audit log, shown as each case's timeline.

## Run it on your computer

### 1. Install the requirements

- **Node.js 22** or newer: <https://nodejs.org>
- **PostgreSQL 16**: either install it (<https://www.postgresql.org/download/>) or use Docker (step 2, option B)

### 2. Create the databases

The app uses one database for your data and a second one for automated tests.

**Option A: installed PostgreSQL.** Open `psql` as the `postgres` superuser and run:

```sql
CREATE ROLE adr WITH LOGIN PASSWORD 'adr_dev_password' CREATEDB;
CREATE DATABASE adr_reporter OWNER adr;
CREATE DATABASE adr_reporter_test OWNER adr;
```

**Option B: Docker.** From this folder run `docker compose up -d`. It creates both databases with the same user and
password.

### 3. Install and start

```bash
npm install                 # installs packages and generates the database client
cp .env.example .env        # on Windows: copy .env.example .env
npm run db:init             # creates the tables and loads the fictional demo data
npm run dev:api             # terminal 1: the API on http://localhost:8000/api
npm run dev                 # terminal 2: the website
```

Open <http://localhost:3000>.

### AI features

Set these **backend-only** values in `.env` for the local API, or Supabase Edge Function secrets for deployment:

```dotenv
AI_PROVIDER=auto
OLLAMA_API_KEY=your_ollama_key
GEMINI_API_KEY=your_gemini_key
```

The default order is **Ollama Cloud → Gemini → Claude (only if enabled)**. Missing keys are skipped. The free-provider
models are configurable with `OLLAMA_MODEL` and `GEMINI_MODEL`; see `.env.example` for defaults.

Paid Claude is disabled by this code statement in [`src/server/ai/config.ts`](src/server/ai/config.ts):

```ts
export const ALLOW_PAID_AI: boolean = false;
```

Change it to `true`, set `ANTHROPIC_API_KEY`, rebuild the API and redeploy to allow Claude after the preferred providers
fail. An environment variable cannot bypass this switch. Use Ollama/Gemini accounts without paid billing to stay
within their free tiers; the application cannot change provider account billing or quota.

`AI_PROVIDER=none` disables AI. `AI_PROVIDER=fixture` uses visibly labelled saved test replies for all four tasks,
without a key or network. Fixed guided questions and manual reporting work even when AI is unavailable.

```bash
npm run ai:check             # checks all four tasks using the configured provider chain; fictional inputs only
npm run ai:evaluate          # compares live extractor results against known sample facts; requires real provider keys
```

Fictional samples are in [`samples/`](samples/). PDF extraction skips Ollama and uses a configured provider that reads
PDFs (Gemini or enabled Claude). For Ollama-only use, upload JPG/PNG. Live AI setup, limitations and deployment steps
are in [`docs/AI_IMPLEMENTATION.md`](docs/AI_IMPLEMENTATION.md).

If you used a different database user, password or port, edit `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` first.

### 4. Sign in

The login page lists every demo account. Select one to sign in. All accounts use the password **`AdrDemo#2026`**.

| Account                       | Role                                    |
| ----------------------------- | --------------------------------------- |
| `pharmacist@demo.test`        | Reporter                                |
| `physician@demo.test`         | Reporter                                |
| `hod@demo.test`               | Reviewer · queue lead · urgent contact  |
| `chief.pharmacist@demo.test`  | Reviewer · urgent contact               |
| `amc.coordinator@demo.test`   | Reviewer · coordinator · urgent contact |
| `pharmacologist@demo.test`    | Reviewer                                |
| `senior.pharmacist@demo.test` | Reviewer                                |
| `consultant@demo.test`        | Reviewer                                |
| `pv.officer@demo.test`        | Reviewer · coordinator                  |

**Fictional cases:**

| Case    | State                                           |
| ------- | ----------------------------------------------- |
| ADR-001 | Submitted (the spec's amoxicillin rash example) |
| ADR-002 | Draft                                           |
| ADR-003 | Under review                                    |
| ADR-004 | Returned for correction                         |
| ADR-005 | Approved                                        |
| ADR-006 | Submitted, potentially serious                  |
| ADR-007 | Draft, potentially serious, urgently escalated  |
| ADR-008 | Externally submitted and acknowledged           |

**Try the whole flow:**

1. As `pharmacist@demo.test`, start a new report, fill a few fields and upload a sample prescription.
2. As `hod@demo.test`, open **Review queue**, take up the report, raise an issue and return it.
3. As the pharmacist, correct and resubmit it.
4. As the HoD again, resume, close the issue, complete the checklist and approve.
5. As `amc.coordinator@demo.test`, record the submission and acknowledgement under **External submissions**.

## Tests

```bash
npm run test:db:init        # once: prepares the separate test database (never touches your data)
npm test                    # unit and database tests (each run adds a few fictional cases to the test database)
npx playwright install chromium   # once: downloads the test browser
npm run test:e2e            # browser tests: builds the static site and starts the API (AI_PROVIDER=fixture)
DENO_BIN=$(which deno) npm run test:e2e   # the same, with the API as the Edge Function bundle under Deno
```

Supabase's Edge Runtime is stricter than plain Deno, so check `supabase/functions/api/index.ts` in it before deploying
(needs Docker; the API then answers on <http://localhost:8100/api/health>):

```bash
npm run build:api
docker run --rm --network host \
  -v "$PWD/supabase/functions:/home/deno/functions" -v "$PWD/scripts/edge-runtime/main:/home/deno/main" \
  -e SUPABASE_DB_URL="<TEST_DATABASE_URL from .env>" -e AI_PROVIDER=fixture \
  -e FORM_TEMPLATE_URL=http://localhost:3100/forms/pvpi-adrrf-v1.4.pdf \
  ghcr.io/supabase/edge-runtime:v1.77.8 start --main-service /home/deno/main --port 8100
```

With it running, the browser tests can use it in place of the API server Playwright would start.

Other checks: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`.

## Starting over with fresh demo data

```bash
npm run db:reset
```

> ⚠️ This **permanently deletes everything** in the database named in `DATABASE_URL`, then reloads the fictional demo
> data. Use it only on your local development database.

## Deploy: Supabase + Cloudflare Pages

How the deployed app is put together:

- **Website:** static files on **Cloudflare Pages**. The free plan is enough. Every page loads its data from the API.
- **API:** one **Supabase Edge Function** named `api` (`supabase/functions/api/index.ts`). It holds all the server logic:
  sign-in, reports, review, escalation, submissions, PDFs and all AI workflows.
- **Database:** Supabase PostgreSQL. The tables and demo data come from `supabase/migrations/`.

No passwords or keys go into GitHub. The Edge Function gets its database connection from Supabase automatically. The
only setting in the repository is the public API address in `.env.production`.

### 1. Supabase

1. **Database:** run the six SQL files in `supabase/migrations/` in the SQL Editor, in order (see
   [`supabase/README.md`](supabase/README.md)).
2. **Edge Function:** go to **Edge Functions → Deploy a new function → Via Editor**. Name it `api`, replace the
   editor's code with the whole of `supabase/functions/api/index.ts`, and deploy.
3. **Turn off JWT verification** for `api`, in the function's settings. The app signs users in with its own tokens.
4. **Optional:** add secrets under **Edge Functions → Secrets**:
   - `AI_PROVIDER` = `auto`, `OLLAMA_API_KEY` and/or `GEMINI_API_KEY`, for live AI;
   - `ANTHROPIC_API_KEY` only if you explicitly enable the paid code switch and redeploy;
   - `DEMO_MODE` = `false`, to hide the demo accounts;
   - `FORM_TEMPLATE_URL`, if the website is not at `https://adr-reporter.pages.dev`.

Check it: `https://<project>.supabase.co/functions/v1/api/health` should show `{"ok":true}`.

### 2. Cloudflare Pages

Connect the repository and use these build settings:

| Setting                | Value                 |
| ---------------------- | --------------------- |
| Framework preset       | None                  |
| Build command          | `npm run build`       |
| Build output directory | `out`                 |
| Production branch      | the branch to publish |

The API address comes from `.env.production`. If your Supabase project is different, change
`NEXT_PUBLIC_API_URL` there, and set `NEXT_PUBLIC_API_REGION` to the project's database region (shown under Project
Settings, e.g. `ap-south-1`). Supabase otherwise runs the function near each visitor, and a visitor far from the
database waits for every query to cross that distance (measured: about 5.5 s for the dashboard instead of 2 s).

### When the server code changes

`supabase/functions/api/index.ts` is generated: run `npm run build:api` after changing anything in `src/server`, then
redeploy the function. With the Supabase CLI: `npx supabase functions deploy api --project-ref <project ref>`.

## Project layout

```
docs/                 plan, official PvPI form, verified field map
prisma/               database schema, migrations, fictional seed data
samples/              fictional prescriptions for the AI demo
src/app/              pages (static; each loads its data from the API)
src/components/       interface components (shadcn/ui based)
src/lib/domain/       shared rules: form, dates, completeness, seriousness, access, labels
src/server/api/       the API: routes, sign-in tokens, files (runs as the Supabase Edge Function)
src/server/workflow/  case lifecycle: drafts, review, escalation, submissions, extraction
src/server/pdf/       fills the official PvPI form
src/server/ai/        AI providers (anthropic, fixture)
src/server/           database, sessions, audit log, file storage (in the database)
scripts/              API bundle build, static preview server, test-database helper
supabase/             SQL migrations and the generated Edge Function (supabase/README.md)
tests/                unit, integration (database) and browser tests
```

## Security notes for this prototype

- **Passwords and sessions:** passwords are stored as bcrypt hashes. A session is a random token; only its hash is
  stored in the database. Because the website and the API are on different domains, the browser keeps the token in
  localStorage and sends it with each request, rather than in an httpOnly cookie. Any script running on the site could
  read it, so the site loads no third-party scripts.
- **Access checks:** every API request checks the signed-in user, their role and the case state on
  the server. Two people editing the same draft cannot overwrite each other.
- **Uploads:** files up to 10 MB. The type is checked from the file contents (PNG, JPEG or PDF only). Files are
  stored in the database, never in a public folder, and served only to people who may view the case. Stored files
  cannot be changed or deleted.
- **AI:** suggestions are never written into a report without a person checking them. Each extraction records the
  provider and model used.
- **Audit log:** append-only. The database rejects any attempt to edit or delete it, and also blocks edits to frozen
  report versions. Approved PDFs are stored with a SHA-256 hash.
- **Demo password:** the login page shows it. Set `DEMO_MODE=false` in `.env` (or in the Cloudflare variables) to hide
  the demo account list. On a public deployment, anyone with the link can sign in with the demo accounts, so it must
  only ever hold fictional data.
- **Not production-ready:** this is a prototype. Institutional login and legal or regulatory review are out of
  scope.
