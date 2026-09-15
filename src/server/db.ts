import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { getServerEnv } from "@/config/env.server";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The single Prisma client for the whole application.
 *
 * Two properties this module has to guarantee:
 *
 * 1. ONE POOL. Next.js re-evaluates server modules on every edit in
 *    development, which would otherwise open a fresh connection pool per
 *    reload until PostgreSQL starts refusing connections. Caching on
 *    `globalThis` — which the module registry cannot invalidate — keeps
 *    exactly one alive.
 *
 * 2. LAZY. Construction is deferred until the first property access, so
 *    merely importing something that transitively imports `db` does not read
 *    `DATABASE_URL` or open a socket. That is what lets `next build` compile
 *    the module graph without runtime secrets, and lets unit tests import a
 *    service for its pure functions without needing a database.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const env = getServerEnv();

  return new PrismaClient({
    // Prisma 7 connects through a driver adapter rather than a schema-level URL.
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log:
      env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
    errorFormat: env.NODE_ENV === "development" ? "pretty" : "minimal",
  });
}

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

/**
 * Behaves exactly like a `PrismaClient`; the underlying client is built on
 * first use. The proxy is invisible to callers — `db.profile.findUnique(…)`,
 * `db.$queryRaw`, and everything else work unchanged.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrismaClient(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(getPrismaClient(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(getPrismaClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getPrismaClient(), property);
  },
});
