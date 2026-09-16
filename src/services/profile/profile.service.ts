import "server-only";

import type { Profile } from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "@/lib/time";
import { db } from "@/server/db";
import type {
  OnboardingInput,
  PreferencesInput,
} from "@/services/profile/profile.schema";
import type { ProfileDto } from "@/types/profile";

/**
 * Profile business logic.
 *
 * Every function here takes identity as an explicit argument and never reads
 * the ambient session itself — resolving "who is asking" is the caller's job
 * (see `src/server/auth.ts`). That keeps this layer pure enough to test and
 * makes it impossible to accidentally write a function that trusts a
 * client-supplied id.
 */

const log = logger.child({ service: "profile" });

/** Strips database-only columns and derives UI-facing flags. */
export function toProfileDto(profile: Profile): ProfileDto {
  return {
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
    timeZone: profile.timeZone,
    locale: profile.locale,
    weekStart: profile.weekStart,
    themePreference: profile.themePreference,
    workingHoursStart: profile.workingHoursStart,
    workingHoursEnd: profile.workingHoursEnd,
    studyHoursStart: profile.studyHoursStart,
    studyHoursEnd: profile.studyHoursEnd,
    hasCompletedOnboarding: profile.onboardingCompletedAt !== null,
    hasCompletedTour: profile.tourCompletedAt !== null,
  };
}

export async function findProfileByClerkUserId(
  clerkUserId: string,
): Promise<Profile | null> {
  return db.profile.findUnique({ where: { clerkUserId } });
}

export type ProvisionProfileInput = {
  readonly clerkUserId: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

/**
 * Just-in-time user synchronisation.
 *
 * Creates the application-side Profile the first time a Clerk user is seen,
 * and refreshes the mirrored identity fields (email, avatar) on every later
 * visit. This is the primary sync mechanism precisely because it needs no
 * external configuration and cannot silently fall behind the way a missed
 * webhook can.
 *
 * Fields the user owns — time zone, schedule, theme — are never overwritten
 * here; only the Clerk-owned mirror columns are.
 */
export async function provisionProfile(
  input: ProvisionProfileInput,
): Promise<Profile> {
  const profile = await db.profile.upsert({
    where: { clerkUserId: input.clerkUserId },
    create: {
      clerkUserId: input.clerkUserId,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      timeZone: DEFAULT_TIME_ZONE,
    },
    update: {
      email: input.email,
      avatarUrl: input.avatarUrl,
    },
  });

  log.debug("Profile provisioned", { profileId: profile.id });

  return profile;
}

/**
 * Completes onboarding for a profile the caller has already proven they own.
 *
 * `onboardingCompletedAt` is only stamped once, so re-submitting the form
 * (or replaying the action) updates preferences without rewriting history.
 */
export async function completeOnboarding(
  profileId: string,
  input: OnboardingInput,
): Promise<Profile> {
  const existing = await db.profile.findUnique({ where: { id: profileId } });

  if (!existing) {
    throw notFound("Profile");
  }

  const profile = await db.profile.update({
    where: { id: profileId },
    data: {
      displayName: input.displayName,
      timeZone: normaliseTimeZone(input.timeZone),
      weekStart: input.weekStart,
      themePreference: input.themePreference,
      workingHoursStart: input.workingHoursStart,
      workingHoursEnd: input.workingHoursEnd,
      studyHoursStart: input.studyHoursStart,
      studyHoursEnd: input.studyHoursEnd,
      onboardingCompletedAt: existing.onboardingCompletedAt ?? new Date(),
    },
  });

  log.info("Onboarding completed", { profileId: profile.id });

  return profile;
}

/** Partial preference update from the settings screen. */
export async function updatePreferences(
  profileId: string,
  input: PreferencesInput,
): Promise<Profile> {
  const profile = await db.profile.update({
    where: { id: profileId },
    data: {
      ...input,
      ...(input.timeZone === undefined
        ? {}
        : { timeZone: normaliseTimeZone(input.timeZone) }),
    },
  });

  log.info("Preferences updated", {
    profileId: profile.id,
    fields: Object.keys(input),
  });

  return profile;
}

/**
 * Removes a user's application data. Called by the Clerk `user.deleted`
 * webhook; safe to invoke for an id that no longer exists.
 */
export async function deleteProfileByClerkUserId(
  clerkUserId: string,
): Promise<void> {
  const result = await db.profile.deleteMany({ where: { clerkUserId } });

  log.info("Profile deleted", { deletedCount: result.count });
}

/**
 * Last line of defence against a zone identifier that passed schema
 * validation on a runtime with a richer ICU database than this one.
 */
function normaliseTimeZone(timeZone: string): string {
  if (isValidTimeZone(timeZone)) {
    return timeZone;
  }

  log.warn("Rejected unrecognised time zone; falling back", {
    fallback: DEFAULT_TIME_ZONE,
  });

  return DEFAULT_TIME_ZONE;
}

/**
 * Marks the first-run tour as finished or dismissed.
 *
 * STAMPED ONCE. Like `onboardingCompletedAt`, a second call must not move the
 * timestamp: the interesting fact is when the user first got past the tour,
 * and re-stamping would let a stray call resurrect it.
 */
export async function completeTour(profileId: string): Promise<Profile> {
  const existing = await db.profile.findUnique({ where: { id: profileId } });

  if (!existing) {
    throw notFound("Profile");
  }

  if (existing.tourCompletedAt) {
    return existing;
  }

  return db.profile.update({
    where: { id: profileId },
    data: { tourCompletedAt: new Date() },
  });
}
