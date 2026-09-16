"use client";

import { CheckCircle2, OctagonX, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createBlockerCommand,
  deleteBlockerCommand,
  resolveBlockerCommand,
} from "@/features/work/actions";
import type { BlockerDto } from "@/types/work";

/**
 * What is standing in the way.
 *
 * Raising a blocker moves the whole project to BLOCKED, and resolving the
 * last one returns it to ACTIVE — so this panel is not a notepad, it changes
 * how the project reads everywhere else. The copy says so plainly.
 */
export function BlockerPanel({
  projectId,
  blockers,
}: {
  projectId: string;
  blockers: readonly BlockerDto[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

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

  const addBlocker = () => {
    const trimmed = reason.trim();

    if (trimmed === "") {
      return;
    }

    setReason("");

    run(
      () => createBlockerCommand({ projectId, reason: trimmed }),
      "Couldn't record the blocker.",
    );
  };

  const open = blockers.filter((blocker) => !blocker.isResolved);
  const resolved = blockers.filter((blocker) => blocker.isResolved);

  return (
    <SectionCard
      title="Blockers"
      icon={OctagonX}
      description={
        open.length > 0
          ? `${open.length} open — the project reads as blocked until they clear`
          : undefined
      }
    >
      {blockers.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing is blocked."
          description="Record what you are waiting on and the project will show as blocked until it clears."
        />
      ) : (
        <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
          {[...open, ...resolved].map((blocker) => (
            <li
              key={blocker.id}
              className="group flex items-start gap-3 px-4 py-2.5"
            >
              {blocker.isResolved ? (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-hidden
                />
              ) : (
                <OctagonX
                  className="mt-0.5 size-4 shrink-0 text-danger"
                  aria-hidden
                />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-meta">{blocker.reason}</p>

                <p className="text-label text-muted-foreground">
                  {blocker.isResolved
                    ? `Raised ${blocker.createdLabel} · resolved after ${blocker.daysOpen}d`
                    : `Raised ${blocker.createdLabel} · open ${blocker.daysOpen}d`}
                </p>

                {blocker.resolutionNote ? (
                  <p className="mt-0.5 text-label text-muted-foreground">
                    {blocker.resolutionNote}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {blocker.isResolved ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => resolveBlockerCommand({ blockerId: blocker.id }),
                        "Couldn't resolve the blocker.",
                      )
                    }
                  >
                    Resolve
                  </Button>
                )}

                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete this blocker"
                  disabled={isPending}
                  className="reveal-on-hover"
                  onClick={() => {
                    const confirmed = window.confirm(
                      "Delete this blocker? Resolving it keeps the record of what happened.",
                    );

                    if (confirmed) {
                      run(
                        () => deleteBlockerCommand({ blockerId: blocker.id }),
                        "Couldn't delete the blocker.",
                      );
                    }
                  }}
                >
                  <Trash2 className="size-3.5 text-danger" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-border-subtle p-3">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addBlocker();
            }
          }}
          placeholder="What is blocking this?"
          aria-label="Blocker reason"
          className="h-9 flex-1"
        />

        <Button
          size="sm"
          variant="outline"
          onClick={addBlocker}
          disabled={isPending || reason.trim() === ""}
        >
          <Plus className="size-3.5" />
          Block
        </Button>
      </div>
    </SectionCard>
  );
}
