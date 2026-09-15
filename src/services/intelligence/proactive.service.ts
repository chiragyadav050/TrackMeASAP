import "server-only";

import { logger } from "@/lib/logger";
import { localTimeKey, startOfLocalDay } from "@/lib/time";
import { db } from "@/server/db";
import { buildIntelligenceReport } from "@/services/intelligence/intelligence.query";
import {
  enqueueNotification,
  evaluateDelivery,
  markSent,
} from "@/services/schedule/notification.service";

/**
 * The proactive scan.
 *
 * Runs on a schedule and decides whether to tell a user something they did not
 * ask about. That makes restraint the primary design goal, so:
 *
 *  - It runs ONCE PER LOCAL DAY per profile, in a window the user is plausibly
 *    awake for. A scan that fired hourly would produce hourly interruptions.
 *  - Notifications go through the SAME delivery rules as everything else:
 *    quiet hours, the daily limit, per-kind preferences. Proactive alerts get
 *    no special privilege — if anything they deserve less.
 *  - Every notification is idempotent on its dedupe key, so a retry or a
 *    second worker cannot double-notify.
 *  - Nothing is sent when there is nothing to say. Silence is a valid and
 *    frequent outcome.
 */

const log = logger.child({ service: "intelligence.proactive" });

/**
 * The local hour the scan may run in.
 *
 * Late enough that the day has shape, early enough to be actionable. Outside
 * this window the profile is skipped rather than deferred — tomorrow's scan
 * will pick it up, and a backlog of yesterday's observations is not useful.
 */
export const SCAN_HOUR_START = 8;
export const SCAN_HOUR_END = 21;

export type ScanResult = {
  readonly profilesExamined: number;
  readonly profilesSkipped: number;
  readonly insightsFound: number;
  readonly notificationsCreated: number;
  readonly notificationsDelivered: number;
  readonly failures: number;
};

/**
 * Scans every onboarded profile.
 *
 * Failures are isolated PER PROFILE: one user's corrupt data must not stop
 * everyone else's scan.
 */
export async function runProactiveScan(
  now: Date = new Date(),
  limit = 500,
): Promise<ScanResult> {
  const profiles = await db.profile.findMany({
    where: { onboardingCompletedAt: { not: null } },
    take: limit,
  });

  let profilesExamined = 0;
  let profilesSkipped = 0;
  let insightsFound = 0;
  let notificationsCreated = 0;
  let notificationsDelivered = 0;
  let failures = 0;

  for (const profile of profiles) {
    const localHour = Number(localTimeKey(now, profile.timeZone).slice(0, 2));

    if (localHour < SCAN_HOUR_START || localHour >= SCAN_HOUR_END) {
      profilesSkipped += 1;
      continue;
    }

    // One scan per local day. The check is against notifications actually
    // created, so it survives a restart.
    const alreadyScanned = await db.notification.count({
      where: {
        profileId: profile.id,
        kind: "PROACTIVE",
        scheduledFor: { gte: startOfLocalDay(now, profile.timeZone) },
      },
    });

    if (alreadyScanned > 0) {
      profilesSkipped += 1;
      continue;
    }

    try {
      profilesExamined += 1;

      const report = await buildIntelligenceReport(profile, now);
      insightsFound += report.insights.length;

      for (const insight of report.insights) {
        const { notification, created } = await enqueueNotification({
          profileId: profile.id,
          kind: "PROACTIVE",
          title: insight.title,
          // The EVIDENCE travels with the claim. A proactive alert without
          // its numbers is an assertion the user cannot check.
          body: `${insight.body} ${insight.evidence}`,
          href: insight.href,
          dedupeKey: insight.key,
          scheduledFor: now,
        });

        if (!created) {
          continue;
        }

        notificationsCreated += 1;

        const decision = await evaluateDelivery(profile, notification, now, {
          // Proactive alerts are NEVER urgent. They do not get to override
          // quiet hours — the user did not ask for them.
          isUrgent: false,
        });

        if (decision.allow) {
          await markSent(notification.id);
          notificationsDelivered += 1;
        }
      }
    } catch (error) {
      failures += 1;

      // No profile data in the log line — only the id.
      log.error("Proactive scan failed for a profile", {
        profileId: profile.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return {
    profilesExamined,
    profilesSkipped,
    insightsFound,
    notificationsCreated,
    notificationsDelivered,
    failures,
  };
}
