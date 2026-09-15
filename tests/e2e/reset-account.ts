import { Client } from "pg";

/**
 * Wipes the dedicated E2E account's data before a run.
 *
 * WHY. Every spec shares one Clerk user, and the specs are written against a
 * clean slate — "the work page starts empty", "this semester is the current
 * one". Without a reset, data piles up across runs until selectors match
 * several rows and assertions that were correct become impossible.
 *
 * SAFETY. This deletes exactly ONE profile, matched on the dedicated test
 * account's `clerk_user_id`, and only when that id is passed in. Everything
 * else goes with it through `onDelete: Cascade`, which is the same path a
 * real account deletion takes — so this also exercises that the cascade is
 * wired correctly. It can never touch another user: there is no wildcard, no
 * truncate, and no "delete where id != ...".
 *
 * Uses `pg` directly rather than the application's Prisma client because that
 * client imports `server-only`, which throws outside the Next.js runtime.
 */
export async function resetE2EAccount(clerkUserId: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString || !clerkUserId.startsWith("user_")) {
    return;
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query("DELETE FROM profiles WHERE clerk_user_id = $1", [
      clerkUserId,
    ]);
  } finally {
    await client.end();
  }
}
