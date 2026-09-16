import type { ThemePreference, WeekStart } from "@/generated/prisma/client";

/**
 * The shape of a profile as the UI sees it.
 *
 * Deliberately a hand-written DTO rather than the raw Prisma model: it keeps
 * database-only columns out of client components and gives us a stable
 * contract to evolve the schema behind.
 */
export type ProfileDto = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly timeZone: string;
  readonly locale: string;
  readonly weekStart: WeekStart;
  readonly themePreference: ThemePreference;
  readonly workingHoursStart: number;
  readonly workingHoursEnd: number;
  readonly studyHoursStart: number;
  readonly studyHoursEnd: number;
  readonly hasCompletedOnboarding: boolean;
  /** Whether the first-run tour has been finished or dismissed. */
  readonly hasCompletedTour: boolean;
};

export type { ThemePreference, WeekStart };
