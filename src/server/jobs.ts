import "server-only";

import { logger } from "@/lib/logger";
import { runProactiveScan } from "@/services/intelligence/proactive.service";
import {
  findDueReminders,
  fireReminder,
  flushPendingNotifications,
} from "@/services/schedule/reminder.service";

/**
 * The scheduled work itself, with NO knowledge of what triggers it.
 *
 * Deliberately separate from `src/server/worker.ts`: that module imports
 * BullMQ, and on Vercel these same jobs run from a serverless cron route
 * where a Redis client has no business being bundled. Keeping the work here
 * means the long-running worker and the cron route execute the SAME code
 * rather than two implementations that can drift.
 *
 * Every job is idempotent — see the notes on `dedupeKey` in
 * notification.service.ts — so running one twice is harmless, which is what
 * makes an at-least-once scheduler safe to point at them.
 */

const log = logger.child({ service: "jobs" });

export type SweepResult = {
  readonly examined: number;
  readonly fired: number;
  readonly deduped: number;
  readonly delivered: number;
  readonly failed: number;
};

/**
 * Fires every reminder that is due.
 *
 * Failures are isolated PER REMINDER: one profile with corrupt data must not
 * stop every other user's reminders from firing, so each is wrapped and the
 * sweep continues.
 */
export async function sweepReminders(
  now: Date = new Date(),
  limit = 100,
): Promise<SweepResult> {
  const due = await findDueReminders(now, limit);

  let fired = 0;
  let deduped = 0;
  let delivered = 0;
  let failed = 0;

  for (const reminder of due) {
    try {
      const result = await fireReminder(reminder, now);

      if (result.created) {
        fired += 1;
      } else {
        deduped += 1;
      }

      if (result.delivered) {
        delivered += 1;
      }
    } catch (error) {
      failed += 1;

      // Logged without the reminder's title or message — a job log is not the
      // place for the contents of someone's private reminders.
      log.error("Failed to fire reminder", {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { examined: due.length, fired, deduped, delivered, failed };
}

/** Re-evaluates notifications held by quiet hours or the daily limit. */
export async function flushNotifications(now: Date = new Date()) {
  return flushPendingNotifications(now);
}

/**
 * The proactive scan.
 *
 * Acts at most ONCE PER LOCAL DAY per profile regardless of how often it is
 * invoked, so an hourly trigger simply gives every time zone a turn inside
 * its own waking window.
 */
export async function proactiveScan(now: Date = new Date()) {
  return runProactiveScan(now);
}
