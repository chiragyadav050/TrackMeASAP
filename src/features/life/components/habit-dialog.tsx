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
import { createHabitAction } from "@/features/life/actions";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

/**
 * Create a habit.
 *
 * The cadence controls which fields matter, so the form shows only those —
 * a weekly target next to a set of chosen weekdays would let a user configure
 * something the scheduler cannot honour.
 */
export function HabitDialog({
  isOpen,
  onOpenChange,
  goals = [],
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  goals?: readonly { id: string; title: string }[];
}) {
  const router = useRouter();
  const [cadence, setCadence] = useState("DAILY");
  const [kind, setKind] = useState("BUILD");

  type HabitActionState = ActionState<{ habitId: string }>;

  const [state, formAction, isPending] = useActionState<
    HabitActionState,
    FormData
  >(createHabitAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<HabitActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Habit added.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't add the habit.");
    }
  }, [state, onOpenChange, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New habit</DialogTitle>
          <DialogDescription>
            Streaks and rates are computed from what you log. Nothing is
            back-filled or assumed.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="name" label="Habit" errors={fieldErrors?.name}>
            <Input
              {...fieldAria("name", { hasError: Boolean(fieldErrors?.name) })}
              name="name"
              placeholder="Meditate for 10 minutes"
              autoFocus
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="kind"
              label="Type"
              hint={
                kind === "QUIT"
                  ? "Counts days clean; silence is success."
                  : "Counts days done."
              }
              errors={fieldErrors?.kind}
            >
              <NativeSelect
                {...fieldAria("kind", { hasHint: true })}
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="BUILD">Build a habit</option>
                <option value="QUIT">Quit something</option>
              </NativeSelect>
            </Field>

            <Field id="cadence" label="How often" errors={fieldErrors?.cadence}>
              <NativeSelect
                {...fieldAria("cadence", {})}
                name="cadence"
                value={cadence}
                onChange={(event) => setCadence(event.target.value)}
              >
                <option value="DAILY">Every day</option>
                <option value="SPECIFIC_DAYS">Specific days</option>
                <option value="WEEKLY">A number of times a week</option>
              </NativeSelect>
            </Field>
          </div>

          {cadence === "SPECIFIC_DAYS" ? (
            <Field
              id="weekdays"
              label="Which days"
              errors={fieldErrors?.weekdays}
            >
              <div className="flex flex-wrap gap-3" id="weekdays">
                {WEEKDAYS.map((day) => (
                  <label
                    key={day.value}
                    className="flex items-center gap-1.5 text-meta"
                  >
                    <Checkbox name="weekdays" value={String(day.value)} />
                    {day.label}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}

          {cadence === "WEEKLY" ? (
            <Field
              id="targetPerPeriod"
              label="Times per week"
              errors={fieldErrors?.targetPerPeriod}
            >
              <Input
                {...fieldAria("targetPerPeriod", {})}
                type="number"
                name="targetPerPeriod"
                min={1}
                max={7}
                defaultValue={3}
                className="h-9"
              />
            </Field>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="reminderMinute"
              label="Reminder"
              hint="Optional. Minutes past midnight."
              errors={fieldErrors?.reminderMinute}
            >
              <Input
                {...fieldAria("reminderMinute", { hasHint: true })}
                type="number"
                name="reminderMinute"
                min={0}
                max={1439}
                className="h-9"
              />
            </Field>

            {goals.length > 0 ? (
              <Field
                id="goalId"
                label="Goal"
                hint="Optional."
                errors={fieldErrors?.goalId}
              >
                <NativeSelect
                  {...fieldAria("goalId", { hasHint: true })}
                  name="goalId"
                  defaultValue=""
                >
                  <option value="">No goal</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add habit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
