import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { routes } from "@/config/site";
import type { Profile } from "@/generated/prisma/client";
import { internal, unauthorized } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  findProfileByClerkUserId,
  provisionProfile,
} from "@/services/profile/profile.service";

/**
 * The authentication boundary.
 *
 * Identity is ALWAYS derived from the Clerk session on the server. Nothing in
 * the application accepts a user id from the client, so an attacker cannot
 * address another user's data by editing a request. Every data-touching entry
 * point (server action, route handler, protected page) starts by calling one
 * of the `require*` helpers below.
 */

const log = logger.child({ module: "auth" });

/** The Clerk user id for the current request, or `null` when signed out. */
export async function getAuthUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/** Same, but refuses to continue without a session. */
export async function requireAuthUserId(): Promise<string> {
  const userId = await getAuthUserId();

  if (!userId) {
    throw unauthorized();
  }

  return userId;
}

/**
 * The current user's Profile, or `null` if they are signed out or have not
 * been provisioned yet. Does not create anything — use {@link ensureProfile}
 * for that.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const userId = await getAuthUserId();

  if (!userId) {
    return null;
  }

  return findProfileByClerkUserId(userId);
}

/**
 * Resolves the current user's Profile, creating it on first sight.
 *
 * This is the just-in-time half of user synchronisation: any authenticated
 * entry point can call it and be guaranteed a Profile exists, with no
 * dependency on webhook delivery.
 */
export async function ensureProfile(): Promise<Profile> {
  const userId = await requireAuthUserId();

  const existing = await findProfileByClerkUserId(userId);

  if (existing) {
    return existing;
  }

  const user = await currentUser();

  if (!user) {
    // A valid session token whose user Clerk cannot return means the session
    // is stale or the backend call failed; both are "not authenticated".
    log.warn("Session present but Clerk returned no user");
    throw unauthorized("Clerk session could not be resolved to a user");
  }

  return provisionProfile({
    clerkUserId: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    displayName: deriveDisplayName(user),
    avatarUrl: user.imageUrl || null,
  });
}

/**
 * The Profile for the current request, guaranteed to exist.
 *
 * Use this at the top of every authenticated server action and route handler,
 * where an anonymous caller should be met with a 401 rather than a redirect.
 */
export async function requireProfile(): Promise<Profile> {
  const profile = await ensureProfile();

  if (!profile) {
    throw internal("ensureProfile resolved without a profile");
  }

  return profile;
}

/**
 * The page-and-layout counterpart of {@link requireProfile}.
 *
 * Identical guarantee, different failure mode: a visitor without a session is
 * sent to the sign-in page instead of being shown an error, which is the only
 * sensible response to a browser asking for a document.
 *
 * This — not path matching in the proxy — is what actually protects a page.
 */
export async function requireProfileForPage(): Promise<Profile> {
  const userId = await getAuthUserId();

  if (!userId) {
    // `redirect` throws; nothing after this line runs.
    redirect(routes.signIn);
  }

  return requireProfile();
}

type ClerkUserLike = {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly primaryEmailAddress: { readonly emailAddress: string } | null;
};

/**
 * Best-effort human name from whatever identifiers Clerk actually has.
 *
 * Falls back through name → username → email local part → a neutral default,
 * because Clerk applications can be configured with any subset of these.
 */
export function deriveDisplayName(user: ClerkUserLike): string {
  const fullName = [user.firstName, user.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();

  if (fullName) {
    return fullName;
  }

  if (user.username?.trim()) {
    return user.username.trim();
  }

  const email = user.primaryEmailAddress?.emailAddress;
  const localPart = email?.split("@")[0]?.trim();

  if (localPart) {
    return localPart;
  }

  return "There";
}
