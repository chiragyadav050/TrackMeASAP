import type { Metadata } from "next";

import { PlanBoard } from "@/features/planning/components/plan-board";
import { localDateKey } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import {
  buildPlanForDay,
  buildWeekendPlan,
  getExamMode,
  getProcrastinationSignals,
  getRecoveryPlan,
  getWeeklyReview,
} from "@/services/planning/planning.query";

export const metadata: Metadata = {
  title: "Plan",
};

/**
 * The planning surface.
 *
 * Every slice runs in parallel and none calls a model — this page works
 * identically whether or not an API key is configured.
 */
export default async function PlanPage() {
  const profile = await requireProfileForPage();

  const now = new Date();
  const todayKey = localDateKey(now, profile.timeZone);

  const [plan, weekend, recovery, examMode, procrastination, review] =
    await Promise.all([
      buildPlanForDay(profile, todayKey, now),
      buildWeekendPlan(profile, now),
      getRecoveryPlan(profile, now),
      getExamMode(profile, now),
      getProcrastinationSignals(profile, now),
      getWeeklyReview(profile, now),
    ]);

  return (
    <PlanBoard
      plan={plan}
      weekend={weekend}
      recovery={recovery}
      examMode={examMode}
      procrastination={procrastination}
      review={review}
    />
  );
}
