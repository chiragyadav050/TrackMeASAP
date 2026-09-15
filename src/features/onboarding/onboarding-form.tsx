"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { TimeRangeField } from "@/components/form/time-range-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completeOnboardingAction } from "@/features/settings/actions";
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

  // Navigation happens here rather than via `redirect()` inside the action so
  // that a failed submit can re-render the form with its field errors intact.
  useEffect(() => {
    if (state.status === "success") {
      router.replace(routes.overview);
    }
  }, [state, router]);

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

  return (
    <form action={formAction} className="space-y-7" noValidate>
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
