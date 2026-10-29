# Deploy the AI update to the existing Supabase project

Run these commands in PowerShell from this project. The existing database has been verified through a successful
application login. No database migrations are needed for this AI update.

These commands pin Supabase CLI 2.106.0, whose configuration template was checked against `supabase/config.toml`.

```powershell
Set-Location "C:\Users\sriva\Desktop\ADR-Reporter"

npx supabase@2.106.0 login
npx supabase@2.106.0 link --project-ref keoojymdmpnrwlmngaro

npm run build:api

npx supabase@2.106.0 secrets set --env-file supabase/.env.ai --project-ref keoojymdmpnrwlmngaro

npx supabase@2.106.0 functions deploy api --project-ref keoojymdmpnrwlmngaro --no-verify-jwt --use-api

Invoke-RestMethod "https://keoojymdmpnrwlmngaro.supabase.co/functions/v1/api/health"
```

The health check should return `ok: true`. The private `supabase/.env.ai` file has already been prepared locally with
the configured AI settings. It is ignored by source control and excludes the database connection. The Edge Function
uses Supabase's injected database configuration. Add a Gemini key to this private file when PDF support is wanted,
then rerun `supabase secrets set`.

A successful health check only confirms that a function is responding. It does not confirm that the latest deploy
succeeded; a failed deploy leaves the previous function running.

If a CLI command reports `401: Invalid access token`, sign in again and verify account access before deploying:

```powershell
npx supabase@2.106.0 login
npx supabase@2.106.0 projects list
```

Complete the Supabase account login in the browser, then rerun the secrets and function-deploy commands above.
The configuration is compatible with this CLI version: the email test server section is `[inbucket]`, and the
optional `orioledb_version` setting belongs under `[experimental]`.

The `--use-api` option bundles on Supabase's servers without Docker. `--no-verify-jwt` lets the application's own
session-token authentication handle protected routes. The public health endpoint requires no login.
See the [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-functions-deploy) and
[secret-file instructions](https://supabase.com/docs/guides/functions/secrets).

Optional verification commands:

```powershell
npx supabase@2.106.0 functions list --project-ref keoojymdmpnrwlmngaro
npx supabase@2.106.0 secrets list --project-ref keoojymdmpnrwlmngaro
```

After deploying the API, publish the updated frontend through Cloudflare Pages with build command `npm run build`
and output directory `out`. The existing public production API address is already configured in `.env.production`.

For local development, `.env.development` points at `http://localhost:8000/api`. The backend runs with `npm run dev:api`
and the frontend with `npm run dev` in a separate terminal. Restart the frontend after changing its public API address.
