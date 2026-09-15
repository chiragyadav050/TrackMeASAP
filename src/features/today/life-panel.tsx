import { Activity, CalendarHeart, HeartPulse } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import {
  IMPORTANT_DATE_LABELS,
  MoodBadge,
  StreakBadge,
} from "@/features/life/components/life-badges";
import { cn } from "@/lib/utils";
import type { LifeSummaryDto } from "@/services/life/life.query";

/**
 * Habits and the check-in, as they matter to today.
 *
 * Habits due today are listed; those not scheduled are omitted entirely
 * rather than shown greyed out, because a Today page should only contain
 * things that are actually today's.
 */
export function LifePanel({ life }: { life: LifeSummaryDto }) {
  const dueToday = life.habits.habits.filter((habit) => habit.isDueToday);

  return (
    <>
      <SectionCard
        title="Habits today"
        icon={Activity}
        badge={
          dueToday.length > 0
            ? `${life.habits.doneTodayCount}/${dueToday.length}`
            : undefined
        }
        footer={
          <Link href="/habits" className="underline-offset-4 hover:underline">
            Manage habits →
          </Link>
        }
      >
        {dueToday.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Nothing due today"
            description={
              life.habits.habits.length === 0
                ? "Add a habit and it will appear here on the days it is scheduled."
                : "None of your habits are scheduled for today."
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {dueToday.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-meta",
                    habit.todayStatus === "DONE" &&
                      "text-muted-foreground line-through",
                  )}
                >
                  {habit.name}
                </span>

                {habit.todayStatus === "DONE" ? (
                  <span className="shrink-0 text-label text-success">Done</span>
                ) : habit.todayStatus === "MISSED" ? (
                  <span className="shrink-0 text-label text-danger">
                    Missed
                  </span>
                ) : (
                  <StreakBadge
                    days={habit.currentStreak}
                    className="shrink-0"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {life.upcomingDates.length > 0 ? (
        <SectionCard title="Coming up" icon={CalendarHeart}>
          <ul className="divide-y divide-border-subtle">
            {life.upcomingDates.map((date) => (
              <li
                key={date.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-meta">{date.title}</span>
                  <span className="block text-label text-muted-foreground">
                    {IMPORTANT_DATE_LABELS[date.kind]}
                    {date.yearsAtNextOccurrence !== null
                      ? ` · turning ${date.yearsAtNextOccurrence}`
                      : ""}
                  </span>
                </span>

                <span className="shrink-0 text-label text-muted-foreground">
                  {date.daysUntil === 0
                    ? "Today"
                    : date.daysUntil === 1
                      ? "Tomorrow"
                      : `${date.daysUntil}d`}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {life.checkIn?.hasAnyAnswer ? null : (
        <SectionCard title="Check in" icon={HeartPulse}>
          <div className="flex flex-col items-start gap-3 px-4 py-4">
            <p className="text-meta text-muted-foreground">
              How did today go? Every field is optional — a mood on its own is
              enough.
            </p>

            <Button
              size="sm"
              variant="outline"
              render={<Link href="/health">Record today</Link>}
            />
          </div>
        </SectionCard>
      )}

      {life.checkIn?.mood ? (
        <SectionCard title="Today's check-in" icon={HeartPulse}>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <MoodBadge mood={life.checkIn.mood} />

            {life.checkIn.sleepLabel ? (
              <span className="text-label text-muted-foreground">
                {life.checkIn.sleepLabel} sleep
              </span>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}
