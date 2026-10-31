# Supabase database for ADR Reporter

> The chatbot upgrade adds `007_chat_reporting.sql`. Existing projects should follow [the chatbot deployment guide](../docs/CHATBOT_SETUP.md); the older AI-only update below needed no migration.

This folder sets up the app's PostgreSQL database on [Supabase](https://supabase.com): all tables, the database rules,
and the fictional demo data. You can do everything on the Supabase website; nothing needs to run on your computer.

```
supabase/
  config.toml                         Supabase CLI project settings (only used with the CLI)
  functions/api/index.ts              the app's server as one Edge Function (generated)
  migrations/
    001_schema.sql                    tables, enums, indexes, append-only audit log, frozen versions
    002_list_defaults_and_pdf.sql     empty-list defaults, declaration time, stored PDF references
    003_stored_files.sql              storage for uploaded documents and approved PDFs
    004_prisma_migration_history.sql  tells Prisma that 001-003 are already applied
    005_lock_down_data_api.sql        closes Supabase's public Data API to every table
    006_demo_data.sql                 fictional demo accounts and cases
```

## Set up the database on the Supabase website

1. **Create a project:** on supabase.com select **New project**. For the database password use letters and numbers
   only, since symbols such as `@ # / ? %` break the connection string, and save it. Choose the region nearest your users
   (for India: South Asia (Mumbai)). Wait until the project is ready.
2. **Run the six files, in order (001 to 006):** for each file:
   1. Open it on GitHub (in `supabase/migrations/`) and select **Copy raw file** (the copy icon above the file).
   2. In Supabase, open **SQL Editor → New query**, paste, and select **Run**.
   3. Wait for "Success. No rows returned" before moving to the next file.

   If Supabase warns about destructive operations, confirm and run it. The warning comes from words like `DELETE` in
   the safety rules (which stop the audit log from being changed); nothing is deleted.

3. **Check:** in **Table Editor** you should see tables such as `AdrCase`, `User` and `CaseVersion`, with 9 rows in
   `User` and 8 in `AdrCase`. Supabase may point out that the tables have Row Level Security on but no policies; that
   is intended (see below).
4. **Connection string (optional):** select **Connect**, choose **Session pooler** (port 5432), copy the
   URI, replace `[YOUR-PASSWORD]` with your password, and add `?sslmode=require` at the end. You only need it to
   connect from your own computer; the Edge Function connects by itself.

Running `006_demo_data.sql` a second time does nothing: it stops with "Demo data is already loaded".

## Sign in

All demo accounts use the password `AdrDemo#2026`, for example `pharmacist@demo.test` (reporter), `hod@demo.test`
(reviewer, queue lead, urgent contact) and `amc.coordinator@demo.test` (coordinator). The full list is in the main
README. Everything in the demo data is fictional.

## The Edge Function `api`

`functions/api/index.ts` is the whole server of the app: sign-in, reports, review, escalation, submissions, PDFs and
all AI workflows. It is one generated file (`npm run build:api` builds it from `src/server`). Deploy it in the dashboard
under **Edge Functions → Deploy a new function → Via Editor**: name it `api`, paste the file, deploy, then **turn off
JWT verification** for it, because the app signs users in with its own tokens. It connects to this project's database
automatically (`SUPABASE_DB_URL`), so it needs no database secret.

## Why the Data API is closed

Supabase automatically publishes every table in the `public` schema through a REST/GraphQL API that anyone with the
project's public anon key can call. This app never uses that API; its Edge Function connects to PostgreSQL directly as the
database owner. `005_lock_down_data_api.sql` therefore removes all access for the API roles (`anon`, `authenticated`)
and turns on Row Level Security with no policies, which denies them everything. The app, as table owner, is not
affected. You can also switch the Data API off entirely in the project's settings.

## With the Supabase CLI instead (optional)

From the repository folder: `npx supabase link --project-ref <your project ref>`, then `npx supabase db push`. Use
either the CLI or the SQL Editor for a project, not both, because each keeps its own record of what has been run.

## When the database schema changes

The source of truth is the Prisma schema (`prisma/schema.prisma`) and its migrations in `prisma/migrations/`. The
files 001-003 here are the same SQL. For a new Prisma migration:

1. Add its `migration.sql` here as the next numbered file (`007_...sql`).
2. In the same file, record it in Prisma's history like `004_prisma_migration_history.sql` does: insert a row whose
   `migration_name` is the Prisma folder name and whose `checksum` is the SHA-256 of that `migration.sql`
   (`sha256sum prisma/migrations/<folder>/migration.sql`).
3. New tables need Row Level Security switched on (`ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;`). The access
   removal in 005 already applies to tables created later.

The files were checked by applying them to an empty PostgreSQL database: Prisma reported the schema up to date with no
drift from `prisma/schema.prisma`, the API roles were refused access, and the app's database tests passed against it.

## AI setup and updates

This AI update uses existing case, extraction, provenance and append-only audit tables; no extra database migration is
needed. Set `AI_PROVIDER=auto`, `OLLAMA_API_KEY` and/or `GEMINI_API_KEY` under Edge Functions → Secrets. Keep all
provider keys out of `NEXT_PUBLIC_*` variables. Run `npm run build:api`, deploy `functions/api/index.ts`, and redeploy
the Cloudflare site for the new screens. The website and API must be updated together.

Paid Claude is blocked by `ALLOW_PAID_AI = false` in `src/server/ai/config.ts`, even if its secret is present. Change
the code to `true`, add `ANTHROPIC_API_KEY`, rebuild and redeploy only when paid fallback is wanted. Ollama/Gemini
account quotas and billing settings remain controlled in their own consoles.

See [the AI implementation guide](../docs/AI_IMPLEMENTATION.md) for testing and remaining live setup.
