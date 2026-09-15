import type { Metadata } from "next";

import { GoalBoard } from "@/features/life/components/goal-board";
import { requireProfileForPage } from "@/server/auth";
import { listGoals } from "@/services/life/habit.query";

export const metadata: Metadata = {
  title: "Goals",
};

export default async function GoalsPage() {
  const profile = await requireProfileForPage();
  const goals = await listGoals(profile);

  return <GoalBoard goals={goals} />;
}
