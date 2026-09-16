"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { createEventAction } from "@/features/schedule/actions";
import { CALENDAR_EVENT_KINDS } from "@/services/schedule/schedule.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";

const KIND_LABELS: Record<(typeof CALENDAR_EVENT_KINDS)[number], string> = {
  PERSONAL: "Personal",
  CLASS: "Class",
  EXAM: "Exam",
  DEADLINE: "Deadline",
  WORK: "Work",
  SOCIAL: "Social",
  TRAVEL: "Travel",
  OTHER: "Other",
};

/**
 * Create a calendar event.
 *
 * All-day events hide the time fields entirely rather than disabling them —
 * a greyed-out time input next to an "all day" checkbox invites the user to
 * wonder whether it still matters.
 */
export function EventDialog({
  isOpen,
  onOpenChange,
  defaultDateKey,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDateKey: string;
}) {
  const router = useRouter();
  const [isAllDay, setIsAllDay] = useState(false);

  type EventActionState = ActionState<{ eventId: string }>;

  const [state, formAction, isPending] = useActionState<
    EventActionState,
    FormData
  >(createEventAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<EventActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Event added.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't add the event.");
    }
  }, [state, onOpenChange, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Blocks marked busy are checked for overlaps with classes, exams and
            your other events.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="title" label="Title" errors={fieldErrors?.title}>
            <Input
              {...fieldAria("title", { hasError: Boolean(fieldErrors?.title) })}
              name="title"
              placeholder="Study group"
              autoFocus
              required
            />
          </Field>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-meta">
              <Checkbox
                name="isAllDay"
                value="true"
                checked={isAllDay}
                onCheckedChange={(checked) => setIsAllDay(Boolean(checked))}
              />
              All day
            </label>

            <label className="flex items-center gap-2 text-meta">
              <Checkbox name="isBusy" value="true" defaultChecked />
              Counts as busy
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="startDate"
              label="Starts"
              errors={fieldErrors?.startDate}
            >
              <Input
                {...fieldAria("startDate", {
                  hasError: Boolean(fieldErrors?.startDate),
                })}
                type="date"
                name="startDate"
                defaultValue={defaultDateKey}
                required
                className="h-9"
              />
            </Field>

            <Field id="endDate" label="Ends" errors={fieldErrors?.endDate}>
              <Input
                {...fieldAria("endDate", {
                  hasError: Boolean(fieldErrors?.endDate),
                })}
                type="date"
                name="endDate"
                defaultValue={defaultDateKey}
                className="h-9"
              />
            </Field>

            {isAllDay ? null : (
              <>
                <Field
                  id="startTime"
                  label="From"
                  errors={fieldErrors?.startTime}
                >
                  <Input
                    {...fieldAria("startTime", {
                      hasError: Boolean(fieldErrors?.startTime),
                    })}
                    type="time"
                    name="startTime"
                    defaultValue="10:00"
                    className="h-9"
                  />
                </Field>

                <Field id="endTime" label="To" errors={fieldErrors?.endTime}>
                  <Input
                    {...fieldAria("endTime", {
                      hasError: Boolean(fieldErrors?.endTime),
                    })}
                    type="time"
                    name="endTime"
                    defaultValue="11:00"
                    className="h-9"
                  />
                </Field>
              </>
            )}

            <Field id="kind" label="Type" errors={fieldErrors?.kind}>
              <NativeSelect
                {...fieldAria("kind", {})}
                name="kind"
                defaultValue="PERSONAL"
              >
                {CALENDAR_EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="location"
              label="Where"
              hint="Optional."
              errors={fieldErrors?.location}
            >
              <Input
                {...fieldAria("location", { hasHint: true })}
                name="location"
                className="h-9"
              />
            </Field>
          </div>

          <Field
            id="description"
            label="Notes"
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
              {isPending ? "Adding…" : "Add event"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
