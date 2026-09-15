import { clerkSetup } from "@clerk/testing/playwright";

/**
 * Playwright `globalSetup`.
 *
 * `clerkSetup()` exchanges the secret key for a short-lived Testing Token and
 * publishes it to the worker processes. It has to run HERE rather than inside
 * a test: the token is read from the environment when each page is created,
 * so obtaining it after workers have started is too late.
 *
 * Skipped without a real instance, so the anonymous suite still runs with the
 * placeholder key.
 */
export default async function globalSetup(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

  if (!key.startsWith("pk_")) {
    return;
  }

  await clerkSetup();
}
