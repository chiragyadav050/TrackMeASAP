import { connect } from "node:net";

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

/** A probe must never outlive the health check that asked for it. */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Whether a TCP connection to Redis can be opened.
 *
 * DELIBERATELY A BARE SOCKET rather than the queue module. `@/server/queue`
 * imports BullMQ and ioredis at module scope, and this route is the only one
 * that ever touched it — which is exactly how `/api/health` came to be the
 * single broken endpoint in production: the bundler hoisted the import into
 * the serverless function's cold start, ioredis found no Redis, and retried
 * against 127.0.0.1:6379 forever. The request never returned at all; it hung
 * until the platform killed it, while every other route answered in under a
 * second. Making the import lazy did not help, because the evaluation still
 * happened at load.
 *
 * A health check only needs to know whether the port answers, and a socket
 * answers that without a client library — so the dependency is gone rather
 * than deferred. It also cannot hang: the timeout is enforced here.
 */
async function isRedisReachable(url: string): Promise<boolean> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    // A malformed URL is a configuration problem, not a reachable Redis.
    return false;
  }

  const port = Number(parsed.port) || 6379;

  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: parsed.hostname, port });

    const settle = (reachable: boolean): void => {
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

export const GET = withApiErrorHandling("api.health", async () => {
  await db.$queryRaw`SELECT 1`;

  // Redis is OPTIONAL. An unreachable queue is reported, not thrown — the
  // application is fully usable without a worker, and a health check that
  // fails on an optional dependency would take a working app out of rotation.
  const redisUrl = process.env.REDIS_URL?.trim();

  const queue = {
    configured: Boolean(redisUrl),
    reachable: redisUrl ? await isRedisReachable(redisUrl) : false,
  };

  return apiSuccess<HealthPayload>(
    {
      status: "ok",
      database: "reachable",
      worker: { configured: queue.configured, reachable: queue.reachable },
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
});
