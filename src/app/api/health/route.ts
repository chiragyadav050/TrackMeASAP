import { db } from "@/server/db";
import { apiSuccess, withApiErrorHandling } from "@/server/api";
import { getQueueHealth } from "@/server/queue";

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
  const queue = await getQueueHealth();

  return apiSuccess<HealthPayload>(
    {
      status: "ok",
      database: "reachable",
      worker: { configured: queue.configured, reachable: queue.reachable },
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
});
