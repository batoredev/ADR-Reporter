# ADR Reporter (prototype)

AI-assisted adverse drug reaction (ADR) reporting and institutional verification, aligned with the
**PvPI Suspected ADR Reporting Form, version 1.4**.

> **Academic proof of concept. Fictional data only.** Every account, patient and case in this app is invented.
> Do not enter real patient information.

- Plan and architecture: [`docs/ARCHITECTURE_PLAN.md`](docs/ARCHITECTURE_PLAN.md)
- Official form and its verified field map: [`docs/reference/`](docs/reference/)

## Build status

| Step                            | Scope                                                                                        | Status   |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| 1. Foundation                   | Setup, design style, database, fictional demo data, login, role-based navigation, dashboard  | **Done** |
| 2. Structured reporting         | PvPI form sections A–D, drafts, validation, submission                                       | **Done** |
| 3. AI prescription demo         | Upload, extraction, verification, field population                                           | **Done** |
| 4. Review workflow + escalation | Shared queue, claim/release/reassign, checklist, comments, approve/return, urgent escalation | **Done** |
| 5. PDF + external tracking      | Filled official PvPI form, external submission records                                       | **Done** |
| 6. End-to-end check             | Unit, database and browser test suites                                                       | **Done** |

## What it does

1. **Report.** A reporter fills the PvPI form sections A–D. Drafts save automatically. Dates can be exact, month and
   year, year only, or approximate, and the official form never gets a made-up day. Fields that are genuinely unknown
   can be marked "Unknown". A completeness panel lists the mandatory fields that are still missing.
2. **AI help with prescriptions.** Upload a photo or PDF of a prescription and select **Extract medicines**. Each
   suggested value shows the text it was read from. Unclear values must be confirmed by a person before they are used.
   Nothing is added until the reporter checks it. Values that came from a document keep a link to it, so reviewers can
   see where they came from.
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
npm run dev                 # starts the app
```

Open <http://localhost:3000>.

### AI prescription extraction (optional)

Set the provider in `.env`:

| `AI_PROVIDER` | What happens                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `none`        | AI extraction shows as unavailable (default). Everything else works.                                 |
| `anthropic`   | Uses Claude. Put your key in `AI_API_KEY`. `AI_MODEL` chooses the model (default `claude-opus-5-5`). |
| `fixture`     | Returns saved results for the clean sample prescription. No key or network needed; used by tests.    |

Fictional prescriptions to try are in [`samples/prescriptions/`](samples/prescriptions/). One is clean and one is a
blurred, rotated scan. Never upload real prescriptions.

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
npm run test:e2e            # browser tests (starts its own server on port 3100, with AI_PROVIDER=fixture)
```

Other checks: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`.

## Starting over with fresh demo data

```bash
npm run db:reset
```

> ⚠️ This **permanently deletes everything** in the database named in `DATABASE_URL`, then reloads the fictional demo
> data. Use it only on your local development database.

## Deploy to Cloudflare

The app runs on **Cloudflare Workers** through the OpenNext adapter. **Cloudflare Pages cannot run it.** Pages hosts
static files, and this app needs a server for sign-in, the database and PDF generation. A Pages project connected to
this repository only publishes the repository's files (the README, `package.json`, …), so delete it or disconnect it
under **Workers & Pages → (the Pages project) → Settings**.

### What you need

- **The Cloudflare Workers Paid plan** (USD 5 a month). The Free plan allows 10 ms of CPU time per request. Checking a
  password takes about 75 ms and generating a PDF takes longer, so sign-in and approval would fail on the Free plan.
- **A PostgreSQL database reachable from the internet.** Cloudflare does not host PostgreSQL. Any provider works, for
  example [Supabase](https://supabase.com) or [Neon](https://neon.tech) (both have free tiers). Copy its connection
  string, with `?sslmode=require` at the end.

**With Supabase:** open your project, select **Connect**, and copy the **Session pooler** connection string (port 5432).
Replace `[YOUR-PASSWORD]` with your database password and add `?sslmode=require`. Use this string in step 1 and for
Hyperdrive below. The "Direct connection" string needs IPv6, which many networks lack, so use the pooler one.

### 1. Create the tables and demo data in the hosted database

**On the Supabase website (no computer needed):** follow [`supabase/README.md`](supabase/README.md). You paste six SQL
files into Supabase's SQL Editor, in order.

**Or from this folder on your computer,** for any PostgreSQL provider (macOS/Linux shown; on Windows set the variable with `set DATABASE_URL=...` first):

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require" npm run db:init
```

### 2. Deploy

**Option A: automatic deploys from GitHub (Workers Builds).** In the Cloudflare dashboard open **Workers & Pages →
Create → Import a repository** and choose this repository. Then set:

| Setting        | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Project name   | `adr-reporter` (must match `name` in `wrangler.jsonc`) |
| Build command  | `npm run cf:build`                                     |
| Deploy command | `npx opennextjs-cloudflare deploy`                     |

After the project is created, open **Settings → Variables and Secrets** and add a **secret** named `DATABASE_URL` with
the connection string. Then retry the deployment. Every push to the production branch deploys again.

**Option B: deploy from your computer.**

```bash
npx wrangler login                    # once
npx wrangler secret put DATABASE_URL  # paste the connection string
npm run cf:deploy
```

The app is then live at `https://adr-reporter.<your-subdomain>.workers.dev`.

### Settings on Cloudflare

Plain settings are in `wrangler.jsonc` under `vars` (`DEMO_MODE`, `SESSION_TTL_HOURS`, `AI_PROVIDER`, `AI_MODEL`).
To turn on AI extraction, set `AI_PROVIDER` to `anthropic` and add a secret `AI_API_KEY`.

For faster database access, put [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) (Cloudflare's connection
pooler, included in every plan) in front of the database. This is the recommended setup with Supabase. Either run
`npx wrangler hyperdrive create adr-reporter --connection-string="<connection string>"`, or create one in the
dashboard under **Workers & Pages → Hyperdrive**. Then uncomment the `hyperdrive` block in `wrangler.jsonc`, put in
the id it shows, and push. The app then uses Hyperdrive instead of the `DATABASE_URL` secret. (For `npm run cf:preview`
with Hyperdrive enabled, also set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to your local database
URL.)

### Try the Cloudflare build locally

```bash
cp .env.example .dev.vars   # then keep only DATABASE_URL and any AI_* lines
npm run cf:preview          # builds, then serves it on http://localhost:8787 in Cloudflare's runtime
```

### How the Cloudflare build differs

- `npm run cf:build` (`scripts/build-cloudflare.mjs`) generates the Prisma client for Cloudflare's runtime, which loads
  its query engine as a WebAssembly module. Afterwards it restores the normal client for local development.
- Uploaded documents and approved PDFs are stored in the database (the `StoredFile` table), because Workers have no
  disk. Local development stores them the same way.
- On Workers, each request gets its own database connection; connections are never shared between requests.

## Project layout

```
docs/                 plan, official PvPI form, verified field map
prisma/               database schema, migrations, fictional seed data
supabase/             the same database as SQL files for Supabase's SQL Editor (see supabase/README.md)
samples/              fictional prescriptions for the AI demo
src/app/              pages and server actions (reports, review, escalations, submissions, …)
src/components/       interface components (shadcn/ui based)
src/lib/domain/       shared rules: form, dates, completeness, seriousness, access, labels
src/server/workflow/  case lifecycle: drafts, review, escalation, submissions, extraction
src/server/pdf/       fills the official PvPI form
src/server/ai/        AI providers (anthropic, fixture)
src/server/           database, sessions, audit log, file storage (in the database)
scripts/              test-database helper, Cloudflare build
wrangler.jsonc        Cloudflare Workers configuration
tests/                unit, integration (database) and browser tests
```

## Security notes for this prototype

- **Passwords and sessions:** passwords are stored as bcrypt hashes. Sessions are random tokens; only their hash is
  stored in the database. Cookies are httpOnly.
- **Access checks:** every page and every server action checks the signed-in user, their role and the case state on
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
