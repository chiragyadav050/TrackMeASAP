"use client";

import {
  Activity,
  Archive,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteHabitCommand,
  logHabitCommand,
  setHabitArchivedCommand,
  toggleHabitTodayCommand,
} from "@/features/life/actions";
import { HabitDialog } from "@/features/life/components/habit-dialog";
import {
  RateFigure,
  StreakBadge,
} from "@/features/life/components/life-badges";
import { cn } from "@/lib/utils";
import type { HabitDto } from "@/types/life";

/**
 * The habits page.
 *
 * Three states per day, not two: done, deliberately missed, and unanswered.
 * The strip shows all three distinctly, because "I haven't got to it yet" and
 * "I skipped it" are different facts and collapsing them would make every
 * completion rate a lie.
 */
export function HabitBoard({ habits }: { habits: readonly HabitDto[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    fallback: string,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? fallback);
        return;
      }

      router.refresh();
    });
  };

  const dueToday = habits.filter((habit) => habit.isDueToday);
  const doneToday = dueToday.filter((habit) => habit.todayStatus === "DONE");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Habits"
        description={
          habits.length === 0
            ? "The small repeated things that compound over a semester."
            : `${doneToday.length} of ${dueToday.length} due today.`
        }
        actions={
          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-3.5" />
            New habit
          </Button>
        }
      />

      {habits.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={Activity}
            title="No habits yet."
            description="Add one thing you want to do regularly. Streaks and completion rates are computed from what you actually log — nothing is assumed."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                Add a habit
              </Button>
            }
          />
        </div>
      ) : (
        <ul
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          aria-busy={isPending}
        >
          {habits.map((habit) => (
            <li
              key={habit.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{habit.name}</p>
                  <p className="text-label text-muted-foreground">
                    {describeCadence(habit)}
                    {habit.goalTitle ? ` · ${habit.goalTitle}` : ""}
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`More actions for ${habit.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    }
                  />

                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          () =>
                            logHabitCommand({
                              habitId: habit.id,
                              logDate: habit.recentDays.at(-1)!.dateKey,
                              isCompleted: false,
                            }),
                          "Couldn't record the miss.",
                        )
                      }
                    >
                      <X className="size-4 text-muted-foreground" />
                      Mark today missed
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() =>
                        run(
                          () =>
                            setHabitArchivedCommand({
                              habitId: habit.id,
                              isArchived: !habit.isArchived,
                            }),
                          "Couldn't archive the habit.",
                        )
                      }
                    >
                      <Archive className="size-4 text-muted-foreground" />
                      {habit.isArchived ? "Restore" : "Archive"}
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      className="text-danger"
                      onClick={() => {
                        const confirmed = window.confirm(
                          `Delete "${habit.name}" and its entire history? Archiving keeps the record instead.`,
                        );

                        if (confirmed) {
                          run(
                            () => deleteHabitCommand({ habitId: habit.id }),
                            "Couldn't delete the habit.",
                          );
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                      Delete permanently
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div
                className="flex items-center gap-1"
                role="group"
                aria-label={`Last seven days for ${habit.name}`}
              >
                {habit.recentDays.map((day) => (
                  <span
                    key={day.dateKey}
                    title={`${day.dateKey}: ${
                      day.status === "DONE"
                        ? "done"
                        : day.status === "MISSED"
                          ? "missed"
                          : day.isScheduled
                            ? "not answered"
                            : "not scheduled"
                    }`}
                    className={cn(
                      "flex h-7 flex-1 items-center justify-center rounded text-label",
                      day.status === "DONE" && "bg-success/20 text-success",
                      day.status === "MISSED" && "bg-danger/15 text-danger",
                      day.status === null &&
                        day.isScheduled &&
                        "bg-surface-sunken text-muted-foreground",
                      day.status === null &&
                        !day.isScheduled &&
                        "text-muted-foreground/40",
                      day.isToday && "ring-1 ring-border-strong",
                    )}
                  >
                    {day.status === "DONE"
                      ? "✓"
                      : day.status === "MISSED"
                        ? "✕"
                        : day.shortLabel}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {habit.kind === "QUIT" ? (
                  <span className="text-label font-medium text-success">
                    {habit.daysClean} {habit.daysClean === 1 ? "day" : "days"}{" "}
                    clean
                  </span>
                ) : (
                  <StreakBadge days={habit.currentStreak} />
                )}

                <RateFigure
                  percent={habit.completionRate30}
                  className="text-muted-foreground"
                />
              </div>

              <Button
                size="sm"
                variant={habit.todayStatus === "DONE" ? "secondary" : "default"}
                disabled={isPending || !habit.isDueToday}
                className="mt-auto"
                onClick={() =>
                  run(
                    () => toggleHabitTodayCommand({ habitId: habit.id }),
                    "Couldn't update the habit.",
                  )
                }
              >
                {!habit.isDueToday
                  ? "Not scheduled today"
                  : habit.todayStatus === "DONE"
                    ? "Done today — undo"
                    : habit.todayStatus === "MISSED"
                      ? "Missed today — mark done"
                      : "Mark done"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <HabitDialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </div>
  );
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function describeCadence(habit: HabitDto): string {
  switch (habit.cadence) {
    case "SPECIFIC_DAYS":
      return habit.weekdays.map((day) => WEEKDAY_NAMES[day - 1]).join(", ");
    case "WEEKLY":
      return `${habit.weekCompleted} of ${habit.weekTarget} this week`;
    case "DAILY":
    default:
      return "Every day";
  }
}
