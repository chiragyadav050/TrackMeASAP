import "server-only";

import type { Profile } from "@/generated/prisma/client";
import { localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import { getHabitSummary, listGoals } from "@/services/life/habit.query";
import {
  getCheckIn,
  getMoneySummary,
  getUpcomingDates,
  listSubscriptions,
} from "@/services/life/money.query";
import type { LifeOverviewDto } from "@/types/life";

/**
 * The assembled Life view.
 *
 * Every slice runs in parallel: this page reads five unrelated domains and
 * running them in sequence would add their latencies together for no reason.
 */
export async function getLifeOverview(
  profile: Profile,
  now: Date = new Date(),
): Promise<LifeOverviewDto> {
  const todayKey = localDateKey(now, profile.timeZone);

  const [goals, habits, checkIn, money, upcomingDates, subscriptions] =
    await Promise.all([
      listGoals(profile, {}, now),
      getHabitSummary(profile, now),
      getCheckIn(profile, todayKey),
      getMoneySummary(profile, undefined, now),
      getUpcomingDates(profile, now),
      listSubscriptions(profile, false, now),
    ]);

  return {
    goals,
    activeGoalCount: goals.filter((goal) => goal.status === "ACTIVE").length,
    habits,
    checkIn,
    money,
    upcomingDates,
    upcomingSubscriptions: subscriptions.filter(
      (subscription) => subscription.isDueSoon,
    ),
  };
}

/**
 * The compact shape the Today and Overview tiles read.
 *
 * Deliberately narrower than the full overview — a dashboard tile must not
 * pull a month of money entries to render three numbers.
 */
export async function getLifeSummary(profile: Profile, now: Date = new Date()) {
  const todayKey = localDateKey(now, profile.timeZone);

  const [habits, checkIn, activeGoalCount, upcomingDates] = await Promise.all([
    getHabitSummary(profile, now),
    getCheckIn(profile, todayKey),
    db.goal.count({
      where: { profileId: profile.id, status: "ACTIVE", archivedAt: null },
    }),
    getUpcomingDates(profile, now),
  ]);

  return {
    habits,
    checkIn,
    activeGoalCount,
    // Only dates the user actually asked to be reminded about.
    upcomingDates: upcomingDates.filter((date) => date.isWithinReminderWindow),
  };
}

export type LifeSummaryDto = Awaited<ReturnType<typeof getLifeSummary>>;
