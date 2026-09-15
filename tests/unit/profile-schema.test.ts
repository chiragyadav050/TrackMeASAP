import { describe, expect, test } from "vitest";

import {
  onboardingSchema,
  preferencesSchema,
} from "@/services/profile/profile.schema";

const VALID_ONBOARDING = {
  displayName: "Chirag",
  timeZone: "Asia/Kolkata",
  weekStart: "MONDAY",
  themePreference: "SYSTEM",
  workingHoursStart: 540,
  workingHoursEnd: 1020,
  studyHoursStart: 1140,
  studyHoursEnd: 1320,
};

/** Collects the field paths a failed parse reported. */
function issuePaths(input: unknown, schema: typeof onboardingSchema): string[] {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("onboardingSchema", () => {
  test("accepts a complete, coherent payload", () => {
    const result = onboardingSchema.safeParse(VALID_ONBOARDING);
    expect(result.success).toBe(true);
  });

  test("coerces the numeric fields that arrive as FormData strings", () => {
    const result = onboardingSchema.safeParse({
      ...VALID_ONBOARDING,
      workingHoursStart: "540",
      workingHoursEnd: "1020",
      studyHoursStart: "1140",
      studyHoursEnd: "1320",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.workingHoursStart).toBe(540);
    }
  });

  test("trims the display name", () => {
    const result = onboardingSchema.safeParse({
      ...VALID_ONBOARDING,
      displayName: "  Chirag  ",
    });

    expect(result.success && result.data.displayName).toBe("Chirag");
  });

  test("rejects an empty or oversized display name", () => {
    expect(
      issuePaths({ ...VALID_ONBOARDING, displayName: "   " }, onboardingSchema),
    ).toContain("displayName");

    expect(
      issuePaths(
        { ...VALID_ONBOARDING, displayName: "a".repeat(81) },
        onboardingSchema,
      ),
    ).toContain("displayName");
  });

  test("rejects an unknown time zone", () => {
    expect(
      issuePaths(
        { ...VALID_ONBOARDING, timeZone: "Mars/Olympus" },
        onboardingSchema,
      ),
    ).toContain("timeZone");
  });

  test("rejects a minute-of-day outside a single day", () => {
    expect(
      issuePaths(
        { ...VALID_ONBOARDING, workingHoursStart: 1440 },
        onboardingSchema,
      ),
    ).toContain("workingHoursStart");

    expect(
      issuePaths(
        { ...VALID_ONBOARDING, studyHoursStart: -1 },
        onboardingSchema,
      ),
    ).toContain("studyHoursStart");
  });

  test("rejects a window that ends before it starts", () => {
    expect(
      issuePaths(
        { ...VALID_ONBOARDING, workingHoursStart: 1020, workingHoursEnd: 540 },
        onboardingSchema,
      ),
    ).toContain("workingHoursEnd");

    expect(
      issuePaths(
        { ...VALID_ONBOARDING, studyHoursStart: 1320, studyHoursEnd: 1140 },
        onboardingSchema,
      ),
    ).toContain("studyHoursEnd");
  });

  test("rejects a zero-length window", () => {
    expect(
      issuePaths(
        { ...VALID_ONBOARDING, workingHoursStart: 540, workingHoursEnd: 540 },
        onboardingSchema,
      ),
    ).toContain("workingHoursEnd");
  });

  test("rejects an unknown enum value", () => {
    expect(
      issuePaths(
        { ...VALID_ONBOARDING, weekStart: "TUESDAY" },
        onboardingSchema,
      ),
    ).toContain("weekStart");

    expect(
      issuePaths(
        { ...VALID_ONBOARDING, themePreference: "SEPIA" },
        onboardingSchema,
      ),
    ).toContain("themePreference");
  });
});

describe("preferencesSchema", () => {
  test("accepts a single-field update", () => {
    const result = preferencesSchema.safeParse({ themePreference: "DARK" });
    expect(result.success).toBe(true);
  });

  test("rejects an empty update", () => {
    const result = preferencesSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("still enforces window ordering when both ends are supplied", () => {
    const result = preferencesSchema.safeParse({
      workingHoursStart: 1020,
      workingHoursEnd: 540,
    });

    expect(result.success).toBe(false);
  });

  test("skips the window check when only one end is supplied", () => {
    // A partial update cannot be validated against a value it did not send;
    // the service applies it against the stored counterpart.
    const result = preferencesSchema.safeParse({ workingHoursStart: 600 });
    expect(result.success).toBe(true);
  });

  test("still validates the fields that are present", () => {
    const result = preferencesSchema.safeParse({ timeZone: "Nowhere/Real" });
    expect(result.success).toBe(false);
  });
});
