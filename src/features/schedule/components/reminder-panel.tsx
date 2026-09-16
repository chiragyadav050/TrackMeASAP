"use client";

import { Bell, Check, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
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
import {
  createReminderAction,
  deleteReminderCommand,
  setReminderStatusCommand,
  snoozeReminderCommand,
} from "@/features/schedule/actions";
import { RECURRENCE_LABELS } from "@/features/schedule/components/schedule-badges";
import { REMINDER_RECURRENCES } from "@/services/schedule/schedule.schema";
import { cn } from "@/lib/utils";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { ReminderDto } from "@/types/schedule";

/** Snooze durations a person actually asks for. */
const SNOOZE_OPTIONS = [
  { minutes: 10, label: "10 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "Tomorrow" },
] as const;

/**
 * Upcoming reminders.
 *
 * Snoozing pushes the FIRE time without touching the original `remindAt`, so
 * a recurring reminder snoozed once still recurs from its real schedule
 * rather than drifting later every time it is postponed.
 */
export function ReminderPanel({
  reminders,
  todayKey,
}: {
  reminders: readonly ReminderDto[];
  todayKey: string;
}) {
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

  return (
    <div className="space-y-4">
      <SectionCard
        title="Reminders"
        icon={Bell}
        badge={reminders.length > 0 ? String(reminders.length) : undefined}
        footer={
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => setIsDialogOpen(true)}
          >
            + New reminder
          </button>
        }
      >
        {reminders.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No reminders set."
            description="Set one and it fires at the time you chose, in your own time zone."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                <Plus className="size-3.5" />
                New reminder
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
            {reminders.map((reminder) => (
              <li key={reminder.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-meta">{reminder.title}</p>
                    <p
                      className={cn(
                        "text-label",
                        reminder.isOverdue
                          ? "text-danger"
                          : "text-muted-foreground",
                      )}
                    >
                      {reminder.dateLabel} · {reminder.timeLabel}
                      {reminder.isSnoozed ? " · snoozed" : ""}
                      {reminder.recurrence !== "NONE"
                        ? ` · ${RECURRENCE_LABELS[reminder.recurrence]}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Mark "${reminder.title}" done`}
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () =>
                            setReminderStatusCommand({
                              reminderId: reminder.id,
                              status: "COMPLETED",
                            }),
                          "Couldn't update the reminder.",
                        )
                      }
                    >
                      <Check className="size-3.5" />
                    </Button>

                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete "${reminder.title}"`}
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () =>
                            deleteReminderCommand({ reminderId: reminder.id }),
                          "Couldn't delete the reminder.",
                        )
                      }
                    >
                      <Trash2 className="size-3.5 text-danger" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-label text-muted-foreground">
                    Snooze
                  </span>

                  {SNOOZE_OPTIONS.map((option) => (
                    <Button
                      key={option.minutes}
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        run(
                          () =>
                            snoozeReminderCommand({
                              reminderId: reminder.id,
                              minutes: option.minutes,
                            }),
                          "Couldn't snooze the reminder.",
                        )
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <ReminderDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        defaultDateKey={todayKey}
      />
    </div>
  );
}

function ReminderDialog({
  isOpen,
  onOpenChange,
  defaultDateKey,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDateKey: string;
}) {
  const router = useRouter();
  const [recurrence, setRecurrence] = useState("NONE");

  type ReminderActionState = ActionState<{ reminderId: string }>;

  const [state, formAction, isPending] = useActionState<
    ReminderActionState,
    FormData
  >(createReminderAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ReminderActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Reminder set.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't set the reminder.");
    }
  }, [state, onOpenChange, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New reminder</DialogTitle>
          <DialogDescription>
            Fires at the time you pick, in your own time zone. Needs the worker
            running to arrive on schedule.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="title" label="Remind me to" errors={fieldErrors?.title}>
            <Input
              {...fieldAria("title", { hasError: Boolean(fieldErrors?.title) })}
              name="title"
              placeholder="Submit the lab report"
              autoFocus
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="remindDate"
              label="Date"
              errors={fieldErrors?.remindDate}
            >
              <Input
                {...fieldAria("remindDate", {
                  hasError: Boolean(fieldErrors?.remindDate),
                })}
                type="date"
                name="remindDate"
                defaultValue={defaultDateKey}
                required
                className="h-9"
              />
            </Field>

            <Field
              id="remindTime"
              label="Time"
              errors={fieldErrors?.remindTime}
            >
              <Input
                {...fieldAria("remindTime", {
                  hasError: Boolean(fieldErrors?.remindTime),
                })}
                type="time"
                name="remindTime"
                defaultValue="09:00"
                required
                className="h-9"
              />
            </Field>
          </div>

          <Field
            id="recurrence"
            label="Repeat"
            errors={fieldErrors?.recurrence}
          >
            <NativeSelect
              {...fieldAria("recurrence", {})}
              name="recurrence"
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value)}
            >
              {REMINDER_RECURRENCES.map((option) => (
                <option key={option} value={option}>
                  {RECURRENCE_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {recurrence === "WEEKDAYS" ? (
            <Field
              id="weekdays"
              label="Which days"
              errors={fieldErrors?.weekdays}
            >
              <div className="flex flex-wrap gap-3" id="weekdays">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                  (label, index) => (
                    <label
                      key={label}
                      className="flex items-center gap-1.5 text-meta"
                    >
                      <input
                        type="checkbox"
                        name="weekdays"
                        value={String(index + 1)}
                        className="size-4 rounded border-border"
                      />
                      {label}
                    </label>
                  ),
                )}
              </div>
            </Field>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Setting…" : "Set reminder"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
