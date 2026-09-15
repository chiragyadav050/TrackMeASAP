import "dotenv/config";

import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved connection configuration out of `schema.prisma` and into this
 * file. The URL here is used exclusively by the Prisma CLI (migrate, db pull,
 * studio); the application itself connects through the `@prisma/adapter-pg`
 * driver adapter configured in `src/server/db.ts`.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    /**
     * Migrations use the DIRECT connection when one is configured.
     *
     * A transaction pooler (Supabase's port 6543, PgBouncer) multiplexes
     * statements across backends and does not support the session-level
     * constructs migrations rely on — advisory locks, prepared statements,
     * `CREATE TYPE` inside a transaction. Running `migrate deploy` through it
     * fails in confusing, half-applied ways.
     *
     * Falls back to DATABASE_URL so a plain local Postgres needs no extra
     * variable.
     */
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
