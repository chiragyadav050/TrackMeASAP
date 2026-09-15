import "server-only";

import { Worker, type Job } from "bullmq";

import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  connectionOptions,
  isQueueConfigured,
} from "@/server/queue";
import {
  flushNotifications,
  proactiveScan,
  sweepReminders,
} from "@/server/jobs";

/**
 * Background workers.
 *
 * Run as a SEPARATE PROCESS (`pnpm worker`), never inside the Next.js server.
 * A long-lived Redis consumer inside a request-scoped runtime would be
 * duplicated across serverless instances and killed mid-job on scale-down.
 *
 * The work itself lives in `src/server/jobs.ts`, which knows nothing about
 * BullMQ — the same functions run from Vercel's cron route. This module is
 * only the Redis wiring.
 *
 * Every job is IDEMPOTENT. The reminder sweep can run twice on the same row
 * and produce one notification, because `dedupeKey` is enforced by a unique
 * index rather than by hoping the worker is only ever running once.
 */

const log = logger.child({ service: "worker" });

export const JOB_NAMES = {
  sweepReminders: "sweep-reminders",
  flushNotifications: "flush-notifications",
  proactiveScan: "proactive-scan",
} as const;

/**
 * Starts the workers and returns a shutdown function.
 *
 * Throws when Redis is not configured, rather than silently doing nothing —
 * someone who ran `pnpm worker` explicitly asked for background processing
 * and deserves to be told it cannot start.
 */
export function startWorkers(): () => Promise<void> {
  if (!isQueueConfigured()) {
    throw new Error(
      [
        "REDIS_URL is not configured, so no worker can start.",
        "",
        "Add it to .env:",
        '  REDIS_URL="redis://localhost:6379"',
        "",
        "Then make sure Redis is running:",
        "  redis-cli ping   # should answer PONG",
      ].join("\n"),
    );
  }

  const connection = connectionOptions();

  const reminderWorker = new Worker(
    QUEUE_NAMES.reminders,
    async (job: Job) => {
      if (job.name === JOB_NAMES.sweepReminders) {
        const result = await sweepReminders();
        log.info("Reminder sweep complete", { ...result });
        return result;
      }

      log.warn("Unknown reminder job", { name: job.name });
      return null;
    },
    // Deliberately 1: the sweep is a whole-table pass, and running several at
    // once would only add contention for work that is already idempotent.
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );

  const notificationWorker = new Worker(
    QUEUE_NAMES.notifications,
    async (job: Job) => {
      if (job.name === JOB_NAMES.flushNotifications) {
        const result = await flushNotifications();
        log.info("Notification flush complete", { ...result });
        return result;
      }

      if (job.name === JOB_NAMES.proactiveScan) {
        const result = await proactiveScan();
        log.info("Proactive scan complete", { ...result });
        return result;
      }

      log.warn("Unknown notification job", { name: job.name });
      return null;
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 1 },
  );

  for (const worker of [reminderWorker, notificationWorker]) {
    worker.on("failed", (job, error) => {
      log.error("Job failed", {
        queue: worker.name,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: error.message,
      });
    });
  }

  log.info("Workers started", {
    queues: [QUEUE_NAMES.reminders, QUEUE_NAMES.notifications],
  });

  return async () => {
    await Promise.all([reminderWorker.close(), notificationWorker.close()]);
    await db.$disconnect();
    log.info("Workers stopped");
  };
}
