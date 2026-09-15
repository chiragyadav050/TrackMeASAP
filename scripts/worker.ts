import "dotenv/config";

import { logger } from "@/lib/logger";
import {
  QUEUE_NAMES,
  closeQueues,
  getQueue,
  isQueueConfigured,
} from "@/server/queue";
import { JOB_NAMES, startWorkers } from "@/server/worker";

/**
 * The worker entrypoint: `pnpm worker`.
 *
 * A SEPARATE PROCESS from the Next.js server. A long-lived Redis consumer
 * inside a request-scoped runtime would be duplicated across instances and
 * killed mid-job on scale-down.
 *
 * Repeatable jobs are registered here rather than in application code so that
 * starting a second web instance cannot register the schedule twice. BullMQ
 * keys a repeatable job by name + pattern, so re-running this script is safe.
 */

const log = logger.child({ service: "worker-main" });

async function main(): Promise<void> {
  if (!isQueueConfigured()) {
    log.error("REDIS_URL is not set. Add it to .env and start Redis.");
    process.exit(1);
  }

  const stop = startWorkers();

  // Every minute. A reminder set for 09:00 should not arrive at 09:04, and a
  // per-minute sweep of an indexed, bounded query is cheap.
  await getQueue(QUEUE_NAMES.reminders).upsertJobScheduler(
    "reminder-sweep",
    { pattern: "* * * * *" },
    { name: JOB_NAMES.sweepReminders },
  );

  // Every five minutes: this only picks up notifications deferred by quiet
  // hours or the daily limit, so it does not need to be as prompt.
  await getQueue(QUEUE_NAMES.notifications).upsertJobScheduler(
    "notification-flush",
    { pattern: "*/5 * * * *" },
    { name: JOB_NAMES.flushNotifications },
  );

  // Hourly. The job itself acts at most once per LOCAL day per profile, so
  // this cadence exists only to give every time zone a turn inside its own
  // waking window.
  await getQueue(QUEUE_NAMES.notifications).upsertJobScheduler(
    "proactive-scan",
    { pattern: "0 * * * *" },
    { name: JOB_NAMES.proactiveScan },
  );

  log.info("Worker ready. Press Ctrl+C to stop.");

  const shutdown = async (signal: string) => {
    log.info("Shutting down", { signal });

    // Close the workers first so an in-flight job finishes rather than being
    // severed mid-transaction.
    await stop();
    await closeQueues();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
