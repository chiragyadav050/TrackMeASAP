-- Close PostgREST access to Prisma's own bookkeeping table.
--
-- The previous migration deliberately skipped `_prisma_migrations`, out of
-- caution about interfering with migration tooling. Supabase's own database
-- linter flagged that as an ERROR, and it was right:
--
--   • PostgREST exposes the table to the ANON key like any other.
--   • It leaks the project's entire migration history — names such as
--     "add_telegram" and "add_ai_agent" describe the product's internals.
--   • Worse than the read: a WRITE would let someone delete or forge
--     migration records, so the next `migrate deploy` would try to re-create
--     existing tables and fail. That is an integrity problem, not just an
--     information leak.
--
-- The caution was misplaced. Prisma connects as `postgres`, which OWNS this
-- table, and a table owner bypasses RLS unless FORCE ROW LEVEL SECURITY is
-- set — which it is not. Migration tooling is unaffected.
--
-- EVERYTHING BELOW IS GUARDED BY AN EXISTENCE CHECK, and that is essential:
-- `prisma migrate dev` replays migrations into a throwaway SHADOW DATABASE
-- that has no `_prisma_migrations` table of its own. An unguarded ALTER there
-- fails with "relation does not exist" and breaks the ability to create any
-- future migration. Guarding makes this a no-op in the shadow database while
-- still applying to every real one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
     WHERE schemaname = 'public' AND tablename = '_prisma_migrations'
  ) THEN
    RETURN;
  END IF;

  -- REVOKE removes the grant PostgREST relies on — the actual fix.
  -- `anon` and `authenticated` are Supabase-specific and absent on a plain
  -- local Postgres, where this must still be a no-op.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM authenticated;
  END IF;

  -- RLS is defence in depth, and satisfies the linter, which checks
  -- `pg_tables.rowsecurity` rather than grants.
  ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
END
$$;
