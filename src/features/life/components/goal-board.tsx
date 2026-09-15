"use client";

import { Plus, Target } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createGoalAction } from "@/features/life/actions";
import {
  GOAL_CATEGORY_LABELS,
  PaceBadge,
} from "@/features/life/components/life-badges";
import { GOAL_CATEGORIES, GOAL_TIMEFRAMES } from "@/services/life/life.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { GoalDto } from "@/types/life";

const TIMEFRAME_LABELS: Record<(typeof GOAL_TIMEFRAMES)[number], string> = {
  WEEK: "This week",
  MONTH: "This month",
  QUARTER: "This quarter",
  SEMESTER: "This semester",
  YEAR: "This year",
  LONG_TERM: "Long term",
};

export function GoalBoard({ goals }: { goals: readonly GoalDto[] }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goals"
        description="The outcomes everything else is for."
        actions={
          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-3.5" />
            New goal
          </Button>
        }
      />

      {goals.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={Target}
            title="No goals yet."
            description="A goal can be measured (“read 12 books”) or broken into milestones. Life OS will only report progress it can actually compute."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                Set a goal
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {goals.map((goal) => (
            <li key={goal.id}>
              <Link
                href={`/goals/${goal.id}` as never}
                className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{goal.title}</p>
                    <p className="text-label text-muted-foreground">
                      {GOAL_CATEGORY_LABELS[goal.category]} ·{" "}
                      {TIMEFRAME_LABELS[goal.timeframe]}
                    </p>
                  </div>

                  {goal.status !== "ACTIVE" ? (
                    <Badge variant="secondary" className="shrink-0">
                      {goal.status === "ACHIEVED"
                        ? "Achieved"
                        : goal.status === "PAUSED"
                          ? "Paused"
                          : "Abandoned"}
                    </Badge>
                  ) : null}
                </div>

                <GoalProgressBar goal={goal} />

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                  <PaceBadge pace={goal.pace} />

                  {goal.targetLabel ? (
                    <span className="text-label text-muted-foreground">
                      {goal.targetLabel}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <GoalDialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </div>
  );
}

/**
 * Goal progress.
 *
 * An unmeasurable goal gets a written explanation instead of a bar, because
 * there is genuinely nothing to show and a 0% bar would imply failure rather
 * than absence of a measure.
 */
export function GoalProgressBar({ goal }: { goal: GoalDto }) {
  if (goal.progressPercent === null) {
    return (
      <p className="text-label text-muted-foreground">
        Add a target number or some milestones to track progress.
      </p>
    );
  }

  const rounded = Math.round(goal.progressPercent);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-label">
        <span className="text-muted-foreground">
          {goal.isMeasured
            ? `${goal.currentValue} of ${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ""}`
            : `${goal.milestonesCompleted} of ${goal.milestonesTotal} milestones`}
        </span>
        <span className="font-medium tabular-nums">{rounded}%</span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.title} progress`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            rounded === 100 ? "bg-success" : "bg-accent"
          }`}
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  );
}

function GoalDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  type GoalActionState = ActionState<{ goalId: string }>;

  const [state, formAction, isPending] = useActionState<
    GoalActionState,
    FormData
  >(createGoalAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<GoalActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Goal created.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't create the goal.");
    }
  }, [state, onOpenChange, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New goal</DialogTitle>
          <DialogDescription>
            Give it a number if you can measure it. If not, add milestones later
            — either way the progress shown will be real.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="title" label="Goal" errors={fieldErrors?.title}>
            <Input
              {...fieldAria("title", { hasError: Boolean(fieldErrors?.title) })}
              name="title"
              placeholder="Read 12 books"
              autoFocus
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="category" label="Area" errors={fieldErrors?.category}>
              <NativeSelect
                {...fieldAria("category", {})}
                name="category"
                defaultValue="PERSONAL"
              >
                {GOAL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {GOAL_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="timeframe"
              label="Horizon"
              errors={fieldErrors?.timeframe}
            >
              <NativeSelect
                {...fieldAria("timeframe", {})}
                name="timeframe"
                defaultValue="MONTH"
              >
                {GOAL_TIMEFRAMES.map((timeframe) => (
                  <option key={timeframe} value={timeframe}>
                    {TIMEFRAME_LABELS[timeframe]}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="targetValue"
              label="Target number"
              hint="Optional."
              errors={fieldErrors?.targetValue}
            >
              <Input
                {...fieldAria("targetValue", { hasHint: true })}
                type="number"
                name="targetValue"
                min={0}
                step="any"
                className="h-9"
              />
            </Field>

            <Field
              id="unit"
              label="Unit"
              hint="e.g. books, km."
              errors={fieldErrors?.unit}
            >
              <Input
                {...fieldAria("unit", { hasHint: true })}
                name="unit"
                className="h-9"
              />
            </Field>

            <Field
              id="targetDate"
              label="Target date"
              hint="Optional."
              errors={fieldErrors?.targetDate}
              className="sm:col-span-2"
            >
              <Input
                {...fieldAria("targetDate", { hasHint: true })}
                type="date"
                name="targetDate"
                className="h-9"
              />
            </Field>
          </div>

          <Field
            id="description"
            label="Why this matters"
            hint="Optional."
            errors={fieldErrors?.description}
          >
            <Textarea
              {...fieldAria("description", { hasHint: true })}
              name="description"
              rows={2}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
