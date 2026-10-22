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
| 2. Structured reporting         | PvPI form sections A–D, drafts, validation, submission                                       | Planned  |
| 3. AI prescription demo         | Upload, extraction, verification, field population                                           | Planned  |
| 4. Review workflow + escalation | Shared queue, claim/release/reassign, checklist, comments, approve/return, urgent escalation | Planned  |
| 5. PDF + external tracking      | Filled official PvPI form, external submission records                                       | Planned  |
| 6. End-to-end check             | Full browser test suite and sign-off                                                         | Planned  |

Pages for later steps are visible in the menu but show "Not built yet". They still enforce access rules.

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

## Tests

```bash
npm run test:db:init        # once: prepares the separate test database (never touches your data)
npm test                    # unit and database tests
npx playwright install chromium   # once: downloads the test browser
npm run test:e2e            # browser tests (starts its own server on port 3100)
```

Other checks: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`.

## Starting over with fresh demo data

```bash
npm run db:reset
```

> ⚠️ This **permanently deletes everything** in the database named in `DATABASE_URL`, then reloads the fictional demo
> data. Use it only on your local development database.

## Project layout

```
docs/                 plan, official PvPI form, verified field map
prisma/               database schema, migrations, fictional seed data
src/app/              pages (login, dashboard, …)
src/components/       interface components (shadcn/ui based)
src/lib/domain/       shared rules: dates, seriousness, access, labels
src/server/           server-only code: database, sessions, audit log, queries
tests/                unit, integration (database) and browser tests
```

## Security notes for this prototype

- **Passwords and sessions:** passwords are stored as bcrypt hashes. Sessions are random tokens; only their hash is
  stored in the database. Cookies are httpOnly.
- **Access checks:** every page checks the signed-in user and their role on the server.
- **Audit log:** append-only. The database rejects any attempt to edit or delete it, and also blocks edits to frozen
  report versions.
- **Demo password:** the login page shows it. Set `DEMO_MODE=false` in `.env` to hide the demo account list.
- **Not production-ready:** this is a local prototype. Hosting, institutional login, cloud storage and legal or
  regulatory review are out of scope.
