"use client";

import { ArrowDown, ArrowUp, Check, Flag, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  createMilestoneCommand,
  deleteMilestoneCommand,
  reorderMilestonesCommand,
  setMilestoneStatusCommand,
} from "@/features/work/actions";
import { cn } from "@/lib/utils";
import type { MilestoneDto } from "@/types/work";

/**
 * A project's checkpoints.
 *
 * Milestones are deliberately NOT what drives the progress percentage — one
 * project has three, another has thirty — so this panel shows its own count
 * and leaves the headline figure to the task ratio.
 */
export function MilestonePanel({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: readonly MilestoneDto[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

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

  const addMilestone = () => {
    const trimmed = title.trim();

    if (trimmed === "") {
      return;
    }

    setTitle("");
    setDueDate("");

    run(
      () =>
        createMilestoneCommand({
          projectId,
          title: trimmed,
          dueDate: dueDate || undefined,
        }),
      "Couldn't add the milestone.",
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;

    if (target < 0 || target >= milestones.length) {
      return;
    }

    const ordered = milestones.map((milestone) => milestone.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);

    run(
      () => reorderMilestonesCommand({ projectId, orderedIds: ordered }),
      "Couldn't reorder the milestones.",
    );
  };

  const completedCount = milestones.filter(
    (milestone) => milestone.status === "COMPLETED",
  ).length;

  return (
    <SectionCard
      title="Milestones"
      icon={Flag}
      description={
        milestones.length === 0
          ? undefined
          : `${completedCount} of ${milestones.length} complete`
      }
    >
      {milestones.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No milestones yet."
          description="Add the checkpoints that tell you the project is actually moving."
        />
      ) : (
        <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
          {milestones.map((milestone, index) => {
            const isComplete = milestone.status === "COMPLETED";

            return (
              <li
                key={milestone.id}
                className="group flex items-center gap-3 px-4 py-2.5"
              >
                <Checkbox
                  checked={isComplete}
                  aria-label={`Mark "${milestone.title}" ${isComplete ? "incomplete" : "complete"}`}
                  onCheckedChange={(checked) =>
                    run(
                      () =>
                        setMilestoneStatusCommand({
                          milestoneId: milestone.id,
                          status: checked ? "COMPLETED" : "PENDING",
                        }),
                      "Couldn't update the milestone.",
                    )
                  }
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-meta",
                      isComplete && "text-muted-foreground line-through",
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

                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move "${milestone.title}" up`}
                    disabled={index === 0 || isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move "${milestone.title}" down`}
                    disabled={index === milestones.length - 1 || isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete "${milestone.title}"`}
                    disabled={isPending}
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Delete the milestone "${milestone.title}"? This cannot be undone.`,
                      );

                      if (confirmed) {
                        run(
                          () =>
                            deleteMilestoneCommand({
                              milestoneId: milestone.id,
                            }),
                          "Couldn't delete the milestone.",
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-3.5 text-danger" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle p-3">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addMilestone();
            }
          }}
          placeholder="Add a milestone"
          aria-label="Milestone title"
          className="h-9 min-w-40 flex-1"
        />

        <Input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          aria-label="Milestone due date"
          className="h-9 w-auto"
        />

        <Button
          size="sm"
          onClick={addMilestone}
          disabled={isPending || title.trim() === ""}
        >
          {isPending ? (
            <Check className="size-3.5" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Add
        </Button>
      </div>
    </SectionCard>
  );
}
