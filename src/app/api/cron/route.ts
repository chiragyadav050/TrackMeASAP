import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";
import {
  flushNotifications,
  proactiveScan,
  sweepReminders,
} from "@/server/jobs";

/**
 * Scheduled work, triggered by Vercel Cron.
 *
 * WHY THIS EXISTS. `pnpm worker` is a long-lived BullMQ consumer, and Vercel
 * has no long-lived processes — it cannot run there at all. Rather than bolt
 * on a second hosting provider just to fire reminders, the same job functions
 * are invoked from a serverless route on a schedule. They live in
 * `src/server/jobs.ts` precisely so both triggers run identical code.
 *
 * SECURITY. This endpoint starts work for EVERY user, so it is authenticated
 * and FAILS CLOSED:
 *
 *   • Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is
 *     set. It is compared in constant time.
 *   • With no CRON_SECRET configured, every request is REFUSED. An
 *     unconfigured secret must never mean "open to the internet" — this URL
 *     is public and guessable.
 *
 * IDEMPOTENCY is what makes an at-least-once scheduler safe here: every job
 * de-duplicates through a unique index, so a retried or doubled invocation
 * produces the same single notification.
 */

export const dynamic = "force-dynamic";

/**
 * A sweep touches every due reminder across all users, so it needs more than
 * the default serverless budget. Still far below Vercel's ceiling.
 */
export const maxDuration = 60;

const log = logger.child({ service: "cron" });

/** Which jobs to run. Reminders are frequent; the scan is hourly. */
type Job = "reminders" | "proactive";

function isAuthorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();

  if (!expected) {
    log.error("CRON_SECRET is not configured; refusing cron request.");
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");

  // Length is compared first because timingSafeEqual throws on a mismatch.
  // The length of a secret is not the part worth protecting.
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorised(request)) {
    // No body: a caller probing the endpoint learns nothing.
    return new NextResponse(null, { status: 401 });
  }

  const job = (new URL(request.url).searchParams.get("job") ??
    "reminders") as Job;

  try {
    if (job === "proactive") {
      const scan = await proactiveScan();
      log.info("Cron proactive scan complete", { ...scan });

      return NextResponse.json({ ok: true, job, scan });
    }

    const sweep = await sweepReminders();
    const flush = await flushNotifications();

    log.info("Cron reminder sweep complete", { ...sweep, ...flush });

    return NextResponse.json({ ok: true, job, sweep, flush });
  } catch (error) {
    // Logged, never echoed — a cron response should not describe internals.
    log.error("Cron job failed", {
      job,
      error: error instanceof Error ? error.message : "unknown",
    });

    // A real 500 so a failing schedule is visible in Vercel's dashboard
    // rather than silently reporting success.
    return NextResponse.json({ ok: false, job }, { status: 500 });
  }
}
