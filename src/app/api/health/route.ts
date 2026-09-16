import { db } from "@/server/db";
import { apiSuccess, withApiErrorHandling } from "@/server/api";

/**
 * Liveness + database readiness probe.
 *
 * Public by design (see the middleware's public matcher) so a load balancer
 * can reach it, and deliberately terse: it reports whether the process can
 * talk to PostgreSQL and nothing else. No version numbers, no connection
 * strings, no row counts — a health endpoint should not be a recon tool.
 */

// Never cached: a cached health check is worse than no health check.
export const dynamic = "force-dynamic";

type HealthPayload = {
  readonly status: "ok";
  readonly database: "reachable";
  /**
   * Whether background processing is available.
   *
   * Booleans only — no URL, no queue depths, no version. An operator needs to
   * know whether reminders will fire; an attacker learns nothing they could
   * not learn by watching whether reminders arrive.
   */
  readonly worker: {
    readonly configured: boolean;
    readonly reachable: boolean;
  };
};

export const GET = withApiErrorHandling("api.health", async () => {
  await db.$queryRaw`SELECT 1`;

  // Redis is OPTIONAL. An unreachable queue is reported, not thrown — the
  // application is fully usable without a worker, and a health check that
  // fails on an optional dependency would take a working app out of rotation.
  //
  // IMPORTED LAZILY, AND ONLY WHEN REDIS IS ACTUALLY CONFIGURED. `@/server/queue`
  // pulls in BullMQ and ioredis at module scope. A static import therefore
  // dragged both into this serverless function's cold start, where — with no
  // Redis to talk to — the request never completed at all: `/api/health` hung
  // until the platform timed it out, while every other route was fine.
  //
  // Reading the variable here rather than calling `isQueueConfigured()` is the
  // whole point: asking the queue module whether a queue exists would import
  // the very thing being avoided. This is the same separation that keeps
  // `src/server/jobs.ts` free of BullMQ so the cron route can use it.
  const queue = process.env.REDIS_URL?.trim()
    ? await import("@/server/queue").then((module) => module.getQueueHealth())
    : { configured: false, reachable: false };

  return apiSuccess<HealthPayload>(
    {
      status: "ok",
      database: "reachable",
      worker: { configured: queue.configured, reachable: queue.reachable },
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
});
