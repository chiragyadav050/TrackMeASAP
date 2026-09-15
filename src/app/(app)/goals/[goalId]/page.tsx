import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GoalDetail } from "@/features/life/components/goal-detail";
import { requireProfileForPage } from "@/server/auth";
import { getGoalDetail } from "@/services/life/habit.query";

export const metadata: Metadata = {
  title: "Goal",
};

/**
 * One goal. `getGoalDetail` scopes on `profileId`, so another user's id
 * resolves to `null` and lands on the ordinary 404 — indistinguishable from
 * an id that never existed.
 */
export default async function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  const profile = await requireProfileForPage();
  const { goalId } = await params;
  const detail = await getGoalDetail(profile, goalId);

  if (!detail) {
    notFound();
  }

  return <GoalDetail detail={detail} />;
}
