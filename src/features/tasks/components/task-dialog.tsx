"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  createTaskAction,
  getTaskDetailCommand,
  setTaskCompletionCommand,
  updateTaskAction,
} from "@/features/tasks/actions";
import {
  CATEGORY_LABELS,
  PRIORITY_META,
  STATUS_LABELS,
} from "@/features/tasks/components/task-badges";
import { SubtaskList } from "@/features/tasks/components/subtask-list";
import {
  ENERGY_LEVELS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/services/task/task.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { TaskDetailDto } from "@/types/task";

const ENERGY_LABELS: Record<(typeof ENERGY_LEVELS)[number], string> = {
  LOW: "Low — routine",
  MEDIUM: "Medium",
  HIGH: "High — needs focus",
};

type TaskDialogProps = {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** `null` creates; an id edits. */
  readonly taskId: string | null;
  /** Pre-fills the title when escalating from quick capture. */
  readonly initialTitle?: string;
};

/**
 * Create and edit, in one dialog.
 *
 * Deliberately compact: a single column of real controls rather than a
 * full-screen form. Every field maps to a column that exists, and there are
 * no controls for things Phase 2 cannot do.
 *
 * All inputs are native and named, so the whole thing submits as `FormData`
 * through the standard server-action pipeline with no client-side
 * serialisation step.
 */
export function TaskDialog({
  isOpen,
  onOpenChange,
  taskId,
  initialTitle = "",
}: TaskDialogProps) {
  const isEditing = taskId !== null;

  const [detail, setDetail] = useState<TaskDetailDto | null>(null);

  const [createState, createAction, isCreating] = useActionState<
    ActionState<{ taskId: string }>,
    FormData
  >(createTaskAction, IDLE_ACTION_STATE);

  const [updateState, updateAction, isUpdating] = useActionState<
    ActionState<{ taskId: string }>,
    FormData
  >(updateTaskAction, IDLE_ACTION_STATE);

  const state = isEditing ? updateState : createState;
  const isPending = isEditing ? isUpdating : isCreating;
  const lastHandled = useRef<ActionState<{ taskId: string }> | null>(null);

  // Only trust loaded detail that belongs to the task currently open —
  // otherwise switching tasks would briefly render the previous one's fields.
  const activeDetail = detail?.id === taskId ? detail : null;

  // Derived rather than stored: "loading" IS "editing a task whose detail has
  // not arrived yet". Keeping it as state would mean a setState inside the
  // fetching effect, and a second render pass for no information gained.
  const isLoading = isEditing && activeDetail === null;

  /**
   * Re-reads the task. Called from the effect below and by the subtask list
   * after it mutates something; every state write happens in the promise
   * continuation, never synchronously inside an effect body.
   */
  const refreshDetail = useCallback(async () => {
    if (!taskId) {
      return;
    }

    const result = await getTaskDetailCommand({ taskId });

    if (result.status === "success" && result.data) {
      setDetail(result.data);
      return;
    }

    toast.error("Couldn't load that task.");
    onOpenChange(false);
  }, [taskId, onOpenChange]);

  useEffect(() => {
    if (!isOpen || !taskId) {
      return;
    }

    let isCancelled = false;

    void getTaskDetailCommand({ taskId }).then((result) => {
      if (isCancelled) {
        return;
      }

      if (result.status === "success" && result.data) {
        setDetail(result.data);
        return;
      }

      toast.error("Couldn't load that task.");
      onOpenChange(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, taskId, onOpenChange]);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success(isEditing ? "Task updated." : "Task created.");
      onOpenChange(false);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(
        state.message ??
          (isEditing
            ? "Couldn't save your changes."
            : "Couldn't create the task. Please try again."),
      );
    }
  }, [state, isEditing, onOpenChange]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const formError =
    state.status === "error" ? (fieldErrors?._form?.join(" ") ?? null) : null;

  // Both come from the server already resolved in the profile's zone.
  const dueDateValue = activeDetail?.dueDateInput ?? "";
  const dueTimeValue = activeDetail?.dueTimeInput ?? "";

  const suggestParentCompletion = useCallback(() => {
    if (!taskId) {
      return;
    }

    toast("All steps are done.", {
      description: "Mark the task itself complete?",
      action: {
        label: "Complete",
        onClick: () => {
          void setTaskCompletionCommand({ taskId, isCompleted: true }).then(
            (result) => {
              if (result.status === "success") {
                onOpenChange(false);
              }
            },
          );
        },
      },
    });
  }, [taskId, onOpenChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the details, or break the work into steps."
              : "Capture the details now, or just the title and refine later."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-meta text-muted-foreground">
            Loading…
          </p>
        ) : (
          <form
            action={isEditing ? updateAction : createAction}
            className="space-y-4"
            noValidate
          >
            {isEditing ? (
              <input type="hidden" name="taskId" value={taskId} />
            ) : null}

            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="title" label="Title" errors={fieldErrors?.title}>
              <Input
                {...fieldAria("title", {
                  hasError: Boolean(fieldErrors?.title),
                })}
                name="title"
                defaultValue={activeDetail?.title ?? initialTitle}
                maxLength={200}
                autoFocus
                required
              />
            </Field>

            <Field
              id="description"
              label="Description"
              hint="Optional. What does 'done' look like?"
              errors={fieldErrors?.description}
            >
              <Textarea
                {...fieldAria("description", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.description),
                })}
                name="description"
                defaultValue={activeDetail?.description ?? ""}
                rows={2}
                maxLength={2000}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="priority"
                label="Priority"
                errors={fieldErrors?.priority}
              >
                <NativeSelect
                  {...fieldAria("priority", {
                    hasError: Boolean(fieldErrors?.priority),
                  })}
                  name="priority"
                  defaultValue={activeDetail?.priority ?? "MEDIUM"}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_META[priority].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                id="category"
                label="Category"
                errors={fieldErrors?.category}
              >
                <NativeSelect
                  {...fieldAria("category", {
                    hasError: Boolean(fieldErrors?.category),
                  })}
                  name="category"
                  defaultValue={activeDetail?.category ?? "PERSONAL"}
                >
                  {TASK_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                id="dueDate"
                label="Due date"
                hint="Leave the time blank for an all-day task."
                errors={fieldErrors?.dueDate}
              >
                <Input
                  {...fieldAria("dueDate", {
                    hasHint: true,
                    hasError: Boolean(fieldErrors?.dueDate),
                  })}
                  type="date"
                  name="dueDate"
                  defaultValue={dueDateValue}
                  className="h-9"
                />
              </Field>

              <Field id="dueTime" label="Time" errors={fieldErrors?.dueTime}>
                <Input
                  {...fieldAria("dueTime", {
                    hasError: Boolean(fieldErrors?.dueTime),
                  })}
                  type="time"
                  name="dueTime"
                  defaultValue={dueTimeValue}
                  className="h-9"
                />
              </Field>

              <Field
                id="estimatedMinutes"
                label="Estimate"
                hint="In minutes."
                errors={fieldErrors?.estimatedMinutes}
              >
                <Input
                  {...fieldAria("estimatedMinutes", {
                    hasHint: true,
                    hasError: Boolean(fieldErrors?.estimatedMinutes),
                  })}
                  type="number"
                  name="estimatedMinutes"
                  min={1}
                  max={1440}
                  step={5}
                  defaultValue={activeDetail?.estimatedMinutes ?? ""}
                  className="h-9"
                />
              </Field>

              <Field id="energy" label="Energy" errors={fieldErrors?.energy}>
                <NativeSelect
                  {...fieldAria("energy", {
                    hasError: Boolean(fieldErrors?.energy),
                  })}
                  name="energy"
                  defaultValue={activeDetail?.energy ?? "MEDIUM"}
                >
                  {ENERGY_LEVELS.map((energy) => (
                    <option key={energy} value={energy}>
                      {ENERGY_LABELS[energy]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              {isEditing ? (
                <Field id="status" label="Status" errors={fieldErrors?.status}>
                  <NativeSelect
                    {...fieldAria("status", {
                      hasError: Boolean(fieldErrors?.status),
                    })}
                    name="status"
                    defaultValue={activeDetail?.status ?? "TODO"}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
            </div>

            <Field
              id="notes"
              label="Notes"
              hint="Optional. Anything else worth remembering."
              errors={fieldErrors?.notes}
            >
              <Textarea
                {...fieldAria("notes", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.notes),
                })}
                name="notes"
                defaultValue={activeDetail?.notes ?? ""}
                rows={2}
                maxLength={5000}
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
                {isPending
                  ? "Saving…"
                  : isEditing
                    ? "Save changes"
                    : "Create task"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Subtasks live outside the form: they save immediately, and nesting
            a second set of controls inside the form would let Enter submit
            the parent. */}
        {isEditing && activeDetail ? (
          <div className="border-t border-border-subtle pt-4">
            <SubtaskList
              taskId={activeDetail.id}
              subtasks={activeDetail.subtasks}
              onChanged={refreshDetail}
              onAllComplete={suggestParentCompletion}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
