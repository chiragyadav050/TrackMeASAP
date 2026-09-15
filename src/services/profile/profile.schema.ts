import { z } from "zod";

import { MINUTES_PER_DAY, isValidTimeZone } from "@/lib/time";

/**
 * Profile input schemas.
 *
 * Isomorphic on purpose — the same schema validates the form in the browser
 * (fast feedback) and again on the server (the only check that counts).
 */

export const THEME_PREFERENCES = ["LIGHT", "DARK", "SYSTEM"] as const;
export const WEEK_STARTS = ["SUNDAY", "MONDAY", "SATURDAY"] as const;

export const themePreferenceSchema = z.enum(THEME_PREFERENCES);
export const weekStartSchema = z.enum(WEEK_STARTS);

const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Tell us what to call you.")
  .max(80, "That name is a little too long.");

const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Pick a time zone.")
  .refine(isValidTimeZone, "That is not a recognised time zone.");

/** Minutes since local midnight, as stored on `Profile`. */
const minuteOfDaySchema = z.coerce
  .number()
  .int("Use a valid time.")
  .min(0, "Use a valid time.")
  .max(MINUTES_PER_DAY - 1, "Use a valid time.");

const profileFieldsSchema = z.object({
  displayName: displayNameSchema,
  timeZone: timeZoneSchema,
  weekStart: weekStartSchema,
  themePreference: themePreferenceSchema,
  workingHoursStart: minuteOfDaySchema,
  workingHoursEnd: minuteOfDaySchema,
  studyHoursStart: minuteOfDaySchema,
  studyHoursEnd: minuteOfDaySchema,
});

/**
 * A start/end pair must describe a real window. Applied to both the full
 * onboarding payload and to partial settings updates, so an update that
 * touches only one end of a window is still checked against the other.
 */
const DAILY_WINDOWS = [
  {
    start: "workingHoursStart",
    end: "workingHoursEnd",
    message: "Work must end after it starts.",
  },
  {
    start: "studyHoursStart",
    end: "studyHoursEnd",
    message: "Study must end after it starts.",
  },
] as const;

function checkWindows(
  value: Partial<Record<string, unknown>>,
  ctx: z.RefinementCtx,
): void {
  for (const window of DAILY_WINDOWS) {
    const start = value[window.start];
    const end = value[window.end];

    // Partial updates may omit one side; there is nothing to compare then.
    if (typeof start !== "number" || typeof end !== "number") {
      continue;
    }

    if (start >= end) {
      ctx.addIssue({
        code: "custom",
        path: [window.end],
        message: window.message,
      });
    }
  }
}

/** Onboarding submits every field at once. */
export const onboardingSchema = profileFieldsSchema.superRefine(checkWindows);

export type OnboardingInput = z.infer<typeof onboardingSchema>;

/** Settings screen: same fields, each individually optional. */
export const preferencesSchema = profileFieldsSchema
  .partial()
  .superRefine((value, ctx) => {
    if (Object.values(value).every((entry) => entry === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Nothing to update.",
      });
      return;
    }

    checkWindows(value, ctx);
  });

export type PreferencesInput = z.infer<typeof preferencesSchema>;
