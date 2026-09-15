"use client";

import { Activity, ChevronLeft, Flag, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { NativeSelect } from "@/components/form/native-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  createGoalMilestoneCommand,
  deleteGoalCommand,
  deleteGoalMilestoneCommand,
  setGoalMilestoneDoneCommand,
  setGoalProgressCommand,
  setGoalStatusCommand,
} from "@/features/life/actions";
import {
  GOAL_CATEGORY_LABELS,
  PaceBadge,
  StreakBadge,
} from "@/features/life/components/life-badges";
import { GoalProgressBar } from "@/features/life/components/goal-board";
import { GOAL_STATUSES } from "@/services/life/life.schema";
import { cn } from "@/lib/utils";
import type { GoalDetailDto } from "@/types/life";

const STATUS_LABELS: Record<(typeof GOAL_STATUSES)[number], string> = {
  ACTIVE: "Active",
  ACHIEVED: "Achieved",
  PAUSED: "Paused",
  ABANDONED: "Abandoned",
};

export function GoalDetail({ detail }: { detail: GoalDetailDto }) {
  const { goal, milestones, habits } = detail;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [milestoneDraft, setMilestoneDraft] = useState("");
  const [progressDraft, setProgressDraft] = useState(String(goal.currentValue));

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    fallback: string,
    onDone?: () => void,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? fallback);
        return;
      }

      if (onDone) {
        onDone();
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 text-muted-foreground"
          render={
            <Link href="/goals">
              <ChevronLeft className="size-3.5" />
              All goals
            </Link>
          }
        />

        <PageHeader
          eyebrow={GOAL_CATEGORY_LABELS[goal.category]}
          title={goal.title}
          description={goal.description ?? undefined}
          actions={
            <>
              <NativeSelect
                aria-label="Goal status"
                value={goal.status}
                disabled={isPending}
                className="h-9 w-auto"
                onChange={(event) =>
                  run(
                    () =>
                      setGoalStatusCommand({
                        goalId: goal.id,
                        status: event.target
                          .value as (typeof GOAL_STATUSES)[number],
                      }),
                    "Couldn't change the status.",
                  )
                }
              >
                {GOAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>

              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete this goal"
                className="text-danger"
                onClick={() => {
                  const confirmed = window.confirm(
                    `Delete "${goal.title}"? Its habits and tasks are kept and simply unlinked.`,
                  );

                  if (confirmed) {
                    run(
                      () => deleteGoalCommand({ goalId: goal.id }),
                      "Couldn't delete the goal.",
                      () => router.push("/goals"),
                    );
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          }
        />
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PaceBadge pace={goal.pace} />

          {goal.targetLabel ? (
            <span className="text-label text-muted-foreground">
              Target {goal.targetLabel}
              {goal.daysRemaining !== null
                ? goal.daysRemaining < 0
                  ? ` · ${Math.abs(goal.daysRemaining)}d ago`
                  : ` · ${goal.daysRemaining}d left`
                : ""}
            </span>
          ) : null}
        </div>

        <GoalProgressBar goal={goal} />

        {goal.isMeasured ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label
              htmlFor="currentValue"
              className="text-label text-muted-foreground"
            >
              Update progress
              <Input
                id="currentValue"
                type="number"
                min={0}
                step="any"
                value={progressDraft}
                onChange={(event) => setProgressDraft(event.target.value)}
                className="mt-1 h-9 w-32"
              />
            </label>

            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => {
                const value = Number(progressDraft);

                if (!Number.isFinite(value) || value < 0) {
                  toast.error("Enter a number of zero or more.");
                  return;
                }

                run(
                  () =>
                    setGoalProgressCommand({
                      goalId: goal.id,
                      currentValue: value,
                    }),
                  "Couldn't save the progress.",
                );
              }}
            >
              Save
            </Button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Milestones"
          icon={Flag}
          description={
            milestones.length === 0
              ? undefined
              : `${goal.milestonesCompleted} of ${goal.milestonesTotal} complete`
          }
        >
          {milestones.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="No milestones yet."
              description="Break the goal into checkpoints and progress becomes measurable."
            />
          ) : (
            <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
              {milestones.map((milestone) => (
                <li
                  key={milestone.id}
                  className="group flex items-center gap-3 px-4 py-2.5"
                >
                  <Checkbox
                    checked={milestone.isCompleted}
                    aria-label={`Mark "${milestone.title}" ${milestone.isCompleted ? "incomplete" : "complete"}`}
                    onCheckedChange={(checked) =>
                      run(
                        () =>
                          setGoalMilestoneDoneCommand({
                            milestoneId: milestone.id,
                            isCompleted: Boolean(checked),
                          }),
                        "Couldn't update the milestone.",
                      )
                    }
                  />

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-meta",
                        milestone.isCompleted &&
                          "text-muted-foreground line-through",
                      )}
                    >
                      {milestone.title}
                    </p>

                    {milestone.dueLabel ? (
                      <p
                        className={cn(
                          "text-label",
                          milestone.isOverdue
                            ? "text-danger"
                            : "text-muted-foreground",
                        )}
                      >
                        {milestone.dueLabel}
                        {milestone.isOverdue ? " · overdue" : ""}
                      </p>
                    ) : null}
                  </div>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete "${milestone.title}"`}
                    disabled={isPending}
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      run(
                        () =>
                          deleteGoalMilestoneCommand({
                            milestoneId: milestone.id,
                          }),
                        "Couldn't delete the milestone.",
                      )
                    }
                  >
                    <Trash2 className="size-3.5 text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-border-subtle p-3">
            <Input
              value={milestoneDraft}
              onChange={(event) => setMilestoneDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const title = milestoneDraft.trim();

                  if (title === "") return;

                  setMilestoneDraft("");
                  run(
                    () =>
                      createGoalMilestoneCommand({ goalId: goal.id, title }),
                    "Couldn't add the milestone.",
                  );
                }
              }}
              placeholder="Add a milestone"
              aria-label="Milestone title"
              className="h-9 flex-1"
            />

            <Button
              size="sm"
              disabled={isPending || milestoneDraft.trim() === ""}
              onClick={() => {
                const title = milestoneDraft.trim();

                if (title === "") return;

                setMilestoneDraft("");
                run(
                  () => createGoalMilestoneCommand({ goalId: goal.id, title }),
                  "Couldn't add the milestone.",
                );
              }}
            >
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
        </SectionCard>

        <SectionCard
          title="Habits serving this goal"
          icon={Activity}
          footer={
            <Link href="/habits" className="underline-offset-4 hover:underline">
              Manage habits →
            </Link>
          }
        >
          {habits.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No habits linked."
              description="Link a habit to this goal and its streak shows up here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {habits.map((habit) => (
                <li
                  key={habit.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-meta">
                    {habit.name}
                  </span>
                  <StreakBadge days={habit.currentStreak} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
