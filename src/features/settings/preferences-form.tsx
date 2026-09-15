"use client";

import { useTheme } from "next-themes";
import { useActionState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { TimeRangeField } from "@/components/form/time-range-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updatePreferencesAction } from "@/features/settings/actions";
import { listTimeZones } from "@/lib/time";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import {
  THEME_PREFERENCES,
  WEEK_STARTS,
} from "@/services/profile/profile.schema";
import type { ProfileDto, ThemePreference } from "@/types/profile";

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

/** Maps the stored enum onto the string next-themes uses at runtime. */
const NEXT_THEMES_VALUE: Record<ThemePreference, string> = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
};

type PreferencesFormProps = {
  readonly profile: ProfileDto;
};

export function PreferencesForm({ profile }: PreferencesFormProps) {
  const [state, formAction, isPending] = useActionState<
    ActionState<ProfileDto>,
    FormData
  >(updatePreferencesAction, IDLE_ACTION_STATE);

  const { setTheme } = useTheme();
  const timeZones = useMemo(() => listTimeZones(), []);

  // `useActionState` keeps the same state object across re-renders, so the
  // effect below must only fire when a *new* result arrives.
  const lastHandled = useRef<ActionState<ProfileDto> | null>(null);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Preferences saved.");
      // Keep the live theme in step with what was just persisted.
      setTheme(NEXT_THEMES_VALUE[state.data.themePreference]);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message);
    }
  }, [state, setTheme]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const formError =
    state.status === "error" ? (fieldErrors?._form?.join(" ") ?? null) : null;

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
          label="Display name"
          errors={fieldErrors?.displayName}
        >
          <Input
            {...fieldAria("displayName", {
              hasError: Boolean(fieldErrors?.displayName),
            })}
            name="displayName"
            defaultValue={profile.displayName}
            autoComplete="name"
            maxLength={80}
          />
        </Field>

        <Field
          id="timeZone"
          label="Time zone"
          hint="Decides when your day rolls over."
          errors={fieldErrors?.timeZone}
        >
          <NativeSelect
            {...fieldAria("timeZone", {
              hasHint: true,
              hasError: Boolean(fieldErrors?.timeZone),
            })}
            name="timeZone"
            defaultValue={profile.timeZone}
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

        <Field
          id="themePreference"
          label="Appearance"
          hint="Also changeable any time from the header."
          errors={fieldErrors?.themePreference}
        >
          <NativeSelect
            {...fieldAria("themePreference", {
              hasHint: true,
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

        <TimeRangeField
          label="Working hours"
          startName="workingHoursStart"
          endName="workingHoursEnd"
          defaultStart={profile.workingHoursStart}
          defaultEnd={profile.workingHoursEnd}
          errors={fieldErrors?.workingHoursEnd}
        />

        <TimeRangeField
          label="Study hours"
          startName="studyHoursStart"
          endName="studyHoursEnd"
          defaultStart={profile.studyHoursStart}
          defaultEnd={profile.studyHoursEnd}
          errors={fieldErrors?.studyHoursEnd}
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
