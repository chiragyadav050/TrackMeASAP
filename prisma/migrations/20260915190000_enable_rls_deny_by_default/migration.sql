-- Enable Row Level Security on every table, with NO policies.
--
-- WHY THIS EXISTS (Supabase-specific, and it matters):
--
-- Supabase automatically exposes every table in the `public` schema through
-- PostgREST, reachable with the project's ANON key. That key is designed to
-- be public — it ships in browsers. On a table with RLS disabled, PostgREST
-- grants the `anon` and `authenticated` roles full read AND write access.
--
-- Life OS never uses PostgREST. It talks to Postgres through Prisma as the
-- `postgres` role. But the REST endpoint exists regardless of whether the
-- application uses it, so without this migration anyone holding the anon key
-- could read and modify every user's tasks, grades, finances and health data.
--
-- Enabling RLS with no policies makes PostgREST deny everything: RLS is
-- default-deny, and a table with zero policies permits nothing.
--
-- The application is UNAFFECTED. `postgres` owns these tables, and a table
-- owner bypasses RLS unless FORCE ROW LEVEL SECURITY is set — which it
-- deliberately is not. Authorisation for Life OS lives where it always has:
-- in the ownership checks every service performs, which are covered by ~90
-- dedicated tests.
--
-- NOTE FOR FUTURE MIGRATIONS: a table added later will NOT be covered. Either
-- re-run this block or enable RLS on the new table explicitly.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      -- Prisma's own bookkeeping table. Left alone so migration tooling keeps
      -- working exactly as it does everywhere else.
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      target.tablename
    );
  END LOOP;
END
$$;
