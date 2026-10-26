-- ADR Reporter: closes Supabase's automatic Data API (REST/GraphQL) to these tables.
--
-- Supabase publishes every table in the public schema through its Data API,
-- reachable with the project's anon key. This app never uses that API: the
-- Cloudflare Worker connects to PostgreSQL directly as the table owner. So the
-- API roles get no access at all, and Row Level Security is switched on with no
-- policies, which denies everything to them. The table owner (the app) is not
-- affected by Row Level Security.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Tables, sequences and functions created later in this schema start closed too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- The rule functions only raise errors; a fixed search_path satisfies Supabase's security advisor.
ALTER FUNCTION public.audit_log_reject_mutation() SET search_path = '';
ALTER FUNCTION public.case_version_reject_mutation() SET search_path = '';
ALTER FUNCTION public.stored_file_reject_mutation() SET search_path = '';
