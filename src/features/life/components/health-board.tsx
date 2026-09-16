"use client";

import { HeartPulse, Moon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveCheckInAction } from "@/features/life/actions";
import {
  LevelPips,
  MOOD_META,
  MoodBadge,
} from "@/features/life/components/life-badges";
import { MOOD_LEVELS } from "@/services/life/life.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { CheckInDto } from "@/types/life";

/**
 * The daily check-in.
 *
 * Every field is optional and the form says so. A check-in carrying only a
 * mood is a real check-in; demanding a complete form is how daily tracking
 * dies in week two.
 */
export function HealthBoard({
  todayKey,
  todayLabel,
  checkIn,
  recent,
}: {
  todayKey: string;
  todayLabel: string;
  checkIn: CheckInDto | null;
  recent: readonly CheckInDto[];
}) {
  const router = useRouter();

  type CheckInActionState = ActionState<{ checkInDate: string }>;

  const [state, formAction, isPending] = useActionState<
    CheckInActionState,
    FormData
  >(saveCheckInAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<CheckInActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Check-in saved.");
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't save the check-in.");
    }
  }, [state, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={todayLabel}
        title="Health"
        description="Sleep, movement and energy — the inputs to everything else. Every field is optional."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Today's check-in"
          icon={HeartPulse}
          className="lg:col-span-2"
          description={
            checkIn?.hasAnyAnswer
              ? "Saved. Change anything and save again."
              : "Nothing recorded yet."
          }
        >
          <form action={formAction} className="space-y-4 p-4" noValidate>
            <input type="hidden" name="checkInDate" value={todayKey} />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="mood" label="Mood" errors={fieldErrors?.mood}>
                <NativeSelect
                  {...fieldAria("mood", {})}
                  name="mood"
                  defaultValue={checkIn?.mood ?? ""}
                >
                  <option value="">Not saying</option>
                  {MOOD_LEVELS.map((mood) => (
                    <option key={mood} value={mood}>
                      {MOOD_META[mood].label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <Field
                id="energy"
                label="Energy"
                hint="1–5."
                errors={fieldErrors?.energy}
              >
                <Input
                  {...fieldAria("energy", { hasHint: true })}
                  type="number"
                  name="energy"
                  min={1}
                  max={5}
                  defaultValue={checkIn?.energy ?? ""}
                  className="h-9"
                />
              </Field>

              <Field
                id="stress"
                label="Stress"
                hint="1–5."
                errors={fieldErrors?.stress}
              >
                <Input
                  {...fieldAria("stress", { hasHint: true })}
                  type="number"
                  name="stress"
                  min={1}
                  max={5}
                  defaultValue={checkIn?.stress ?? ""}
                  className="h-9"
                />
              </Field>

              <Field
                id="sleepMinutes"
                label="Sleep"
                hint="Minutes."
                errors={fieldErrors?.sleepMinutes}
              >
                <Input
                  {...fieldAria("sleepMinutes", { hasHint: true })}
                  type="number"
                  name="sleepMinutes"
                  min={0}
                  max={1440}
                  defaultValue={checkIn?.sleepMinutes ?? ""}
                  className="h-9"
                />
              </Field>

              <Field
                id="exerciseMinutes"
                label="Exercise"
                hint="Minutes."
                errors={fieldErrors?.exerciseMinutes}
              >
                <Input
                  {...fieldAria("exerciseMinutes", { hasHint: true })}
                  type="number"
                  name="exerciseMinutes"
                  min={0}
                  max={1440}
                  defaultValue={checkIn?.exerciseMinutes ?? ""}
                  className="h-9"
                />
              </Field>

              <Field
                id="waterGlasses"
                label="Water"
                hint="Glasses."
                errors={fieldErrors?.waterGlasses}
              >
                <Input
                  {...fieldAria("waterGlasses", { hasHint: true })}
                  type="number"
                  name="waterGlasses"
                  min={0}
                  max={50}
                  defaultValue={checkIn?.waterGlasses ?? ""}
                  className="h-9"
                />
              </Field>
            </div>

            <Field
              id="highlight"
              label="Best thing about today"
              hint="Optional."
              errors={fieldErrors?.highlight}
            >
              <Input
                {...fieldAria("highlight", { hasHint: true })}
                name="highlight"
                defaultValue={checkIn?.highlight ?? ""}
              />
            </Field>

            <Field
              id="notes"
              label="Anything else"
              hint="Your own words. Never analysed or rewritten."
              errors={fieldErrors?.notes}
            >
              <Textarea
                {...fieldAria("notes", { hasHint: true })}
                name="notes"
                rows={3}
                defaultValue={checkIn?.notes ?? ""}
              />
            </Field>

            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save check-in"}
            </Button>
          </form>
        </SectionCard>

        <SectionCard
          title="Recent days"
          icon={Moon}
          description="Only days you actually recorded."
        >
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-meta text-muted-foreground">
              No check-ins yet. There is nothing to chart until you record one.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {[...recent].reverse().map((day) => (
                <li
                  key={day.checkInDateInput}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="text-label text-muted-foreground tabular-nums">
                    {day.checkInDateInput}
                  </span>

                  <span className="flex items-center gap-3">
                    {day.mood ? <MoodBadge mood={day.mood} /> : null}
                    {day.energy ? (
                      <LevelPips value={day.energy} label="Energy" />
                    ) : null}
                    {day.sleepLabel ? (
                      <span className="text-label text-muted-foreground">
                        {day.sleepLabel}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
