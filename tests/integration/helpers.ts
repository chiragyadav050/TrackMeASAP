import type { Profile } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * Fixtures for the integration suite.
 *
 * Two profiles are created for every test file. That is not incidental: most
 * of what these tests prove is that profile A cannot see or touch profile B's
 * data, and that needs a real second owner in a real database.
 */

export const TEST_TIME_ZONE = "Asia/Kolkata";

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return `${process.pid}-${counter}`;
}

export async function createTestProfile(
  overrides: Partial<Profile> = {},
): Promise<Profile> {
  const suffix = uniqueSuffix();

  return db.profile.create({
    data: {
      clerkUserId: `user_test_${suffix}`,
      displayName: `Test User ${suffix}`,
      email: `test-${suffix}@example.invalid`,
      timeZone: TEST_TIME_ZONE,
      locale: "en-GB",
      onboardingCompletedAt: new Date(),
      ...overrides,
    },
  });
}

/**
 * Removes every profile created by tests, and — via `onDelete: Cascade` —
 * their tasks, subtasks and activity events.
 *
 * Scoped to the `user_test_` prefix rather than truncating the tables, so a
 * stray run against a database holding anything else cannot wipe it.
 */
export async function cleanupTestData(): Promise<void> {
  await db.profile.deleteMany({
    where: { clerkUserId: { startsWith: "user_test_" } },
  });
}

export async function disconnect(): Promise<void> {
  await db.$disconnect();
}

/** Counts a profile's activity events, optionally filtered by action. */
export async function countActivity(
  profileId: string,
  action?: string,
): Promise<number> {
  return db.activityEvent.count({
    where: {
      profileId,
      ...(action ? { action: action as never } : {}),
    },
  });
}
