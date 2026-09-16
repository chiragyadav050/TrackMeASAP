"use client";

import { Plus, Settings2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickCreateTaskAction } from "@/features/tasks/actions";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";

type QuickCaptureProps = {
  /** Opens the full dialog, carrying whatever has been typed so far. */
  readonly onOpenFullForm: (title: string) => void;
  readonly autoFocus?: boolean;
};

/**
 * One-line task capture.
 *
 * The whole point is that the common case — "I need to remember this" — costs
 * a keystroke and a sentence, with no dialog. Enter creates and immediately
 * clears for the next thought; Escape gets out of the way.
 *
 * Anything that needs a due date or a priority escalates to the full dialog
 * via ⌘↵ or the adjacent button, carrying the typed title across.
 */
export function QuickCapture({
  onOpenFullForm,
  autoFocus = false,
}: QuickCaptureProps) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ taskId: string }>,
    FormData
  >(quickCreateTaskAction, IDLE_ACTION_STATE);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastHandled = useRef<ActionState<{ taskId: string }> | null>(null);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      // Clear and keep focus so several thoughts can be captured in a row.
      if (inputRef.current) {
        inputRef.current.value = "";
        inputRef.current.focus();
      }
      return;
    }

    toast.error(
      state.fieldErrors?.title?.join(" ") ??
        state.message ??
        "Couldn't create the task. Please try again.",
    );
  }, [state]);

  return (
    <form
      action={formAction}
      className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2 py-1.5"
    >
      <Plus
        className="ml-1 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <Input
        ref={inputRef}
        name="title"
        autoFocus={autoFocus}
        autoComplete="off"
        maxLength={200}
        placeholder="What needs to be done?"
        aria-label="Task title"
        data-tour="quick-capture"
        className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
        onKeyDown={(event) => {
          // ⌘↵ / Ctrl+↵ escalates to the full form with the text carried over.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onOpenFullForm(event.currentTarget.value);
            return;
          }

          if (event.key === "Escape") {
            event.currentTarget.value = "";
            event.currentTarget.blur();
          }
        }}
      />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add details"
        title="Add details (⌘↵)"
        onClick={() => onOpenFullForm(inputRef.current?.value ?? "")}
      >
        <Settings2 className="size-4" />
      </Button>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}
