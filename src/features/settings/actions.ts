"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  onboardingSchema,
  preferencesSchema,
  themePreferenceSchema,
} from "@/services/profile/profile.schema";
import {
  completeOnboarding,
  completeTour,
  toProfileDto,
  updatePreferences,
} from "@/services/profile/profile.service";
import { requireProfile } from "@/server/auth";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { toAppError } from "@/lib/errors";
import type { ProfileDto } from "@/types/profile";

/**
 * Profile server actions.
 *
 * All of them go through `createAuthenticatedAction`, which resolves identity
 * from the Clerk session, rate limits per profile, validates with Zod and
 * converts any thrown error into safe user-facing copy. No action accepts a
 * profile id from the client.
 */

export const completeOnboardingAction = createAuthenticatedAction({
  name: "profile.completeOnboarding",
  schema: onboardingSchema,
  handler: async (input, { profile }): Promise<ProfileDto> => {
    const updated = await completeOnboarding(profile.id, input);
    revalidatePath("/", "layout");
    return toProfileDto(updated);
  },
});

export const updatePreferencesAction = createAuthenticatedAction({
  name: "profile.updatePreferences",
  schema: preferencesSchema,
  handler: async (input, { profile }): Promise<ProfileDto> => {
    const updated = await updatePreferences(profile.id, input);
    revalidatePath("/", "layout");
    return toProfileDto(updated);
  },
});

const themeArgumentSchema = z.object({
  themePreference: themePreferenceSchema,
});

/**
 * Mirrors a theme change into the database so the choice follows the user to
 * their next device.
 *
 * Deliberately fire-and-forget from the caller's point of view: the visible
 * theme has already changed client-side via next-themes, and a failed write
 * is a logged inconvenience, not something worth interrupting the user for.
 */
export async function persistThemePreferenceAction(
  input: unknown,
): Promise<void> {
  const log = logger.child({ action: "profile.persistTheme" });

  try {
    const parsed = themeArgumentSchema.safeParse(input);

    if (!parsed.success) {
      log.warn("Rejected invalid theme preference");
      return;
    }

    const profile = await requireProfile();

    await updatePreferences(profile.id, {
      themePreference: parsed.data.themePreference,
    });
  } catch (error) {
    const appError = toAppError(error);
    log.warn("Could not persist theme preference", {
      code: appError.code,
      detail: appError.message,
    });
  }
}

/**
 * Dismisses the first-run tour.
 *
 * No arguments: there is nothing to say beyond "this user is done with it",
 * and an action that accepted a profile id would be an ownership hole. The
 * identity comes from the session like every other action here.
 */
export const completeTourCommand = createAuthenticatedCommand({
  name: "profile.completeTour",
  schema: z.object({}),
  handler: async (_input, { profile }): Promise<ProfileDto> => {
    const updated = await completeTour(profile.id);
    revalidatePath("/", "layout");
    return toProfileDto(updated);
  },
});
