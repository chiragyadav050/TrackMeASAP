import "server-only";

import { Queue, type ConnectionOptions } from "bullmq";

import { logger } from "@/lib/logger";

/**
 * Queue connections.
 *
 * Two rules shape this file.
 *
 * FIRST, importing must not connect. Next.js imports server modules during
 * the build and during route collection, and a module that opens a Redis
 * socket at import time makes the build fail on any machine without Redis
 * running. Queues are therefore created lazily, on first use, behind the same
 * `Proxy` pattern the Prisma client uses.
 *
 * SECOND, Redis is OPTIONAL. Life OS is fully usable without a worker — every
 * surface renders, every action works, reminders simply fire when a sweep
 * eventually runs. `isQueueAvailable()` lets callers degrade honestly instead
 * of throwing at a user who never asked for background jobs.
 */

const log = logger.child({ service: "queue" });

/**
 * Queue names.
 *
 * No colons: BullMQ rejects them, because it uses `:` itself to build Redis
 * keys. Namespacing is done with `QUEUE_PREFIX` instead, which is the
 * supported way to keep several apps apart in one Redis instance.
 */
export const QUEUE_NAMES = {
  reminders: "reminders",
  notifications: "notifications",
  maintenance: "maintenance",
} as const;

/** Keeps Life OS keys apart from anything else sharing this Redis. */
export const QUEUE_PREFIX = "life-os";

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Redis URL, or `null` when background processing is not configured. */
export function getRedisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isQueueConfigured(): boolean {
  return getRedisUrl() !== null;
}

export function connectionOptions(): ConnectionOptions {
  const url = getRedisUrl();

  if (!url) {
    throw new Error("REDIS_URL is not configured.");
  }

  return {
    url,
    // BullMQ requires this for blocking commands; without it a worker throws
    // on its first `brpoplpush` rather than at startup, which is far harder
    // to diagnose.
    maxRetriesPerRequest: null,
  } as ConnectionOptions;
}

/**
 * Default job options.
 *
 * Retries are EXPONENTIAL rather than fixed: a Redis blip recovers in
 * milliseconds, but an upstream outage should not be hammered every second.
 * Completed jobs are trimmed so the queue does not grow without bound.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
} as const;

const queues = new Map<string, Queue>();

/**
 * A queue, created on first use.
 *
 * Cached on `globalThis` in development so Next.js hot reloads do not leak a
 * new Redis connection on every edit — the same reason the Prisma client is
 * cached there.
 */
export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);

  if (existing) {
    return existing;
  }

  const queue = new Queue(name, {
    connection: connectionOptions(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queues.set(name, queue);
  log.debug("Queue created", { name });

  return queue;
}

/**
 * Enqueues a job, or does nothing when Redis is not configured.
 *
 * Returns whether the job was actually queued, so a caller can tell the user
 * the truth rather than claiming a background job was scheduled when no
 * worker exists to run it.
 */
export async function enqueue(
  name: QueueName,
  jobName: string,
  payload: Record<string, unknown>,
  options: { jobId?: string; delay?: number } = {},
): Promise<{ readonly queued: boolean; readonly jobId?: string }> {
  if (!isQueueConfigured()) {
    return { queued: false };
  }

  try {
    const job = await getQueue(name).add(jobName, payload, {
      // A caller-supplied `jobId` makes the enqueue idempotent: BullMQ ignores
      // a duplicate id, so a retried request cannot schedule the same work
      // twice.
      jobId: options.jobId,
      delay: options.delay,
    });

    return { queued: true, jobId: job.id };
  } catch (error) {
    // A queue failure must never break the request that triggered it. The
    // data is already committed; the job is best-effort.
    log.error("Failed to enqueue job", {
      queue: name,
      jobName,
      error: error instanceof Error ? error.message : "unknown",
    });

    return { queued: false };
  }
}

/** Closes every open queue. Used by tests and by graceful shutdown. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}

/** A one-line health summary for the diagnostics endpoint. */
export async function getQueueHealth(): Promise<{
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly counts: Record<string, number> | null;
}> {
  if (!isQueueConfigured()) {
    return { configured: false, reachable: false, counts: null };
  }

  try {
    const queue = getQueue(QUEUE_NAMES.reminders);
    const counts = await queue.getJobCounts();

    return { configured: true, reachable: true, counts };
  } catch {
    return { configured: true, reachable: false, counts: null };
  }
}
