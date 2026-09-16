"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
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
 * ONE TAP.
 *
 * This screen used to ask six questions before anyone could see the product,
 * and every one of them already had a defensible answer: the name comes from
 * the sign-in provider, the time zone comes from the browser, and week start,
 * theme and the two daily windows all have defaults that suit most people and
 * are editable in Settings forever after.
 *
 * Asking anyway cost the thing that matters most — the first minute. A setup
 * form is not the product, and a person who signed up ten seconds ago has no
 * basis for deciding when their study hours are; they will guess, and a guess
 * stored as a preference is worse than a default, because it looks deliberate.
 *
 * So the defaults are stated as facts, not questions, and everything is still
 * one disclosure away for the minority who want to set it now. That is
 * progressive disclosure doing its actual job: the common path is a single
 * button, and nothing has been taken away.
 *
 * The inputs stay MOUNTED inside the disclosure rather than being conditionally
 * rendered — a collapsed `<details>` still submits its fields, so the action
 * and its schema are unchanged whether or not anyone opens it.
 */
export function OnboardingForm({ profile }: OnboardingFormProps) {
  const [state, formAction, isPending] = useActionState<
    ActionState<ProfileDto>,
    FormData
  >(completeOnboardingAction, IDLE_ACTION_STATE);

  const router = useRouter();
  const timeZones = useMemo(() => listTimeZones(), []);

  useEffect(() => {
    if (state.status === "success") {
      router.replace(routes.today);
    }
  }, [state, router]);

  // The browser's zone is only knowable on the client. Reading it through a
  // store (rather than assigning it in an effect) means the server renders the
  // stored value, hydration swaps in the detected one, and there is no
  // cascading re-render.
  const detectedTimeZone = useDetectedTimeZone(profile.timeZone);

  const suggestedTimeZone =
    profile.timeZone === DEFAULT_TIME_ZONE
      ? detectedTimeZone
      : profile.timeZone;

  const [chosenTimeZone, setChosenTimeZone] = useState<string | null>(null);
  const timeZone = chosenTimeZone ?? suggestedTimeZone;

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const formError =
    state.status === "error"
      ? (fieldErrors?._form?.join(" ") ?? state.message)
      : null;

  // A name is the one thing worth confirming: it is what every greeting in the
  // product says back, and the provider's version is sometimes an email stub.
  const [name, setName] = useState(profile.displayName);

  return (
    <form action={formAction} className="space-y-8" noValidate>
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-5">
        <Field
          id="displayName"
          label="What should we call you?"
          errors={fieldErrors?.displayName}
        >
          <Input
            {...fieldAria("displayName", {
              hasError: Boolean(fieldErrors?.displayName),
            })}
            name="displayName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            autoFocus
            maxLength={80}
            required
          />
        </Field>

        {/* The detected zone stated as a fact. It is right almost always, and
            when it is wrong the disclosure below fixes it in two clicks. */}
        <p className="text-meta text-muted-foreground">
          Your day will run on{" "}
          <span className="font-medium text-foreground">
            {timeZone.replaceAll("_", " ")}
          </span>
          , detected from this device.
        </p>
      </div>

      {/*
        Native `<details>`: keyboard-operable, screen-reader-announced and
        functional before JavaScript loads — none of which a hand-rolled
        toggle gives for free.
      */}
      <details className="group rounded-xl border border-border-subtle bg-surface-sunken/40">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-meta font-medium">
          Adjust preferences
          <ChevronDown
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>

        <div className="grid grid-cols-1 gap-5 border-t border-border-subtle p-4 sm:grid-cols-2">
          <Field
            id="timeZone"
            label="Time zone"
            errors={fieldErrors?.timeZone}
            className="sm:col-span-2"
          >
            <NativeSelect
              {...fieldAria("timeZone", {
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

          <Field
            id="themePreference"
            label="Appearance"
            errors={fieldErrors?.themePreference}
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
        </div>
      </details>

      <div className="space-y-3">
        <Button
          type="submit"
          size="lg"
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          {isPending ? "Setting up…" : "Start using Life OS"}
          {isPending ? null : (
            <ArrowRight data-icon="inline-end" className="size-4" />
          )}
        </Button>

        <p className="text-label text-muted-foreground">
          Everything here is editable later in Settings. Nothing is permanent.
        </p>
      </div>
    </form>
  );
}
