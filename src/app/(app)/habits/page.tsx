import type { Metadata } from "next";

import { HabitBoard } from "@/features/life/components/habit-board";
import { requireProfileForPage } from "@/server/auth";
import { listHabits } from "@/services/life/habit.query";

export const metadata: Metadata = {
  title: "Habits",
};

export default async function HabitsPage() {
  const profile = await requireProfileForPage();
  const habits = await listHabits(profile);

  return <HabitBoard habits={habits} />;
}
