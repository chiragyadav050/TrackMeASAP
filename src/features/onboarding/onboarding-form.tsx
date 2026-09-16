"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { TimeRangeField } from "@/components/form/time-range-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeOnboardingAction } from "@/features/settings/actions";
import { AcademicStep } from "@/features/onboarding/academic-step";
import { routes } from "@/config/site";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import { useDetectedTimeZone } from "@/hooks/use-detected-time-zone";
import { DEFAULT_TIME_ZONE, listTimeZones } from "@/lib/time";
import {
  THEME_PREFERENCES,
  WEEK_STARTS,
} from "@/services/profile/profile.schema";
import type { ProfileDto } from "@/types/profile";

const WEEK_START_LABELS: Record<(typeof WEEK_STARTS)[number], string> = {
  MONDAY: "Monday",
  SUNDAY: "Sunday",
  SATURDAY: "Saturday",
};

const THEME_LABELS: Record<(typeof THEME_PREFERENCES)[number], string> = {
  SYSTEM: "Match my system",
  LIGHT: "Light",
  DARK: "Dark",
};

type OnboardingFormProps = {
  readonly profile: ProfileDto;
};

/**
 * Six questions, one screen, no wizard.
 *
 * Everything asked here is something the product genuinely cannot work
 * without — a name to greet you by, a time zone to resolve "today" in, and
 * the two daily windows that future scheduling will plan around.
 */
export function OnboardingForm({ profile }: OnboardingFormProps) {
  const [state, formAction, isPending] = useActionState<
    ActionState<ProfileDto>,
    FormData
  >(completeOnboardingAction, IDLE_ACTION_STATE);

  const router = useRouter();
  const timeZones = useMemo(() => listTimeZones(), []);

  /**
   * Which of the two stages is on screen — DERIVED, not stored.
   *
   * The profile stage is a real `<form>` posting to a server action; the
   * academic stage calls a different one. Splitting them is what lets the
   * second be genuinely optional: skipping it still leaves a completed
   * profile, because that was already saved by the time this advances.
   *
   * Advancing on the action's own result rather than redirecting from inside
   * the action means a failed submit re-renders the form with its field
   * errors intact.
   */
  const stage = state.status === "success" ? "academics" : "profile";

  // The browser's zone is only knowable on the client. Reading it through a
  // store (rather than assigning it in an effect) means the server renders the
  // stored value, hydration swaps in the detected one, and there is no
  // cascading re-render.
  const detectedTimeZone = useDetectedTimeZone(profile.timeZone);

  // A zone the user has already saved always wins over detection; the
  // detected value only fills in the untouched `UTC` default.
  const suggestedTimeZone =
    profile.timeZone === DEFAULT_TIME_ZONE
      ? detectedTimeZone
      : profile.timeZone;

  // `null` means "the user has not touched the picker", so the suggestion
  // stays live. Derived state, not synchronised state.
  const [chosenTimeZone, setChosenTimeZone] = useState<string | null>(null);
  const timeZone = chosenTimeZone ?? suggestedTimeZone;

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const formError =
    state.status === "error"
      ? (fieldErrors?._form?.join(" ") ?? state.message)
      : null;

  if (stage === "academics") {
    return (
      <div className="space-y-7">
        <StageIndicator current={2} />
        <AcademicStep onDone={() => router.replace(routes.overview)} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-7" noValidate>
      <StageIndicator current={1} />

      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="displayName"
          label="What should we call you?"
          errors={fieldErrors?.displayName}
          className="sm:col-span-2"
        >
          <Input
            {...fieldAria("displayName", {
              hasError: Boolean(fieldErrors?.displayName),
            })}
            name="displayName"
            defaultValue={profile.displayName}
            autoComplete="name"
            autoFocus
            maxLength={80}
            required
          />
        </Field>

        <Field
          id="timeZone"
          label="Time zone"
          hint="Used to decide when your day starts and ends."
          errors={fieldErrors?.timeZone}
        >
          <NativeSelect
            {...fieldAria("timeZone", {
              hasHint: true,
              hasError: Boolean(fieldErrors?.timeZone),
            })}
            name="timeZone"
            value={timeZone}
            onChange={(event) => setChosenTimeZone(event.target.value)}
          >
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          id="weekStart"
          label="Week starts on"
          errors={fieldErrors?.weekStart}
        >
          <NativeSelect
            {...fieldAria("weekStart", {
              hasError: Boolean(fieldErrors?.weekStart),
            })}
            name="weekStart"
            defaultValue={profile.weekStart}
          >
            {WEEK_STARTS.map((value) => (
              <option key={value} value={value}>
                {WEEK_START_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <TimeRangeField
          label="Working hours"
          hint="When work and classes usually happen."
          startName="workingHoursStart"
          endName="workingHoursEnd"
          defaultStart={profile.workingHoursStart}
          defaultEnd={profile.workingHoursEnd}
          errors={fieldErrors?.workingHoursEnd}
        />

        <TimeRangeField
          label="Study hours"
          hint="Your usual window for focused study."
          startName="studyHoursStart"
          endName="studyHoursEnd"
          defaultStart={profile.studyHoursStart}
          defaultEnd={profile.studyHoursEnd}
          errors={fieldErrors?.studyHoursEnd}
        />

        <Field
          id="themePreference"
          label="Appearance"
          errors={fieldErrors?.themePreference}
          className="sm:col-span-2"
        >
          <NativeSelect
            {...fieldAria("themePreference", {
              hasError: Boolean(fieldErrors?.themePreference),
            })}
            name="themePreference"
            defaultValue={profile.themePreference}
          >
            {THEME_PREFERENCES.map((value) => (
              <option key={value} value={value}>
                {THEME_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? "Setting up…" : "Enter Life OS"}
          {isPending ? null : (
            <ArrowRight data-icon="inline-end" className="size-4" />
          )}
        </Button>

        <p className="text-label text-muted-foreground">
          You can change all of this later in Settings.
        </p>
      </div>
    </form>
  );
}

/**
 * Where the user is in setup.
 *
 * Two steps is few enough that a bare "1 of 2" would do, but the bars carry
 * one thing a number cannot: that the second step is short. People abandon
 * setup when they cannot see the end of it.
 *
 * `aria-hidden` on the bars with the count read out instead — a screen reader
 * gets the fact, not a description of two rectangles.
 */
function StageIndicator({ current }: { readonly current: 1 | 2 }) {
  return (
    <div className="space-y-2">
      <p className="text-label font-medium text-muted-foreground">
        Step {current} of 2
      </p>

      <div className="flex gap-1.5" aria-hidden>
        {[1, 2].map((step) => (
          <span
            key={step}
            className={
              step <= current
                ? "h-1 flex-1 rounded-full bg-brand"
                : "h-1 flex-1 rounded-full bg-border"
            }
          />
        ))}
      </div>
    </div>
  );
}
