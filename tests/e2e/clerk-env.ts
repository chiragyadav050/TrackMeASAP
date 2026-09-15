/**
 * Detects whether the environment points at a REAL Clerk instance.
 *
 * Why this exists
 * ---------------
 * A Clerk development key (`pk_test_…`) makes `clerkMiddleware` perform a
 * "handshake": when the `__clerk_db_jwt` dev-browser cookie is absent, the
 * browser is redirected to the instance's Frontend API host to obtain it.
 *
 * With the placeholder key shipped in `.env`, that host does not exist, so
 * Clerk answers:
 *
 *   {"errors":[{"message":"Invalid host", … "code":"host_invalid"}]}
 *
 * and the browser ends up on `*.clerk.accounts.dev` instead of the app. No
 * browser-driven test can pass in that state — not because the application
 * is wrong, but because there is no Clerk instance behind the key.
 *
 * Rather than mock Clerk (which would only prove the mock works) the browser
 * suite skips with an explicit reason until real keys are present. API-level
 * tests are unaffected and always run.
 */

/** The host encoded in the placeholder key committed to `.env`. */
const PLACEHOLDER_HOST = "placeholder-not-a-real-instance.clerk.accounts.dev";

/** A Clerk publishable key is `pk_(test|live)_` + base64(`<fapi-host>$`). */
function decodeFrontendApiHost(publishableKey: string): string | null {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "");

  if (encoded === publishableKey) {
    return null;
  }

  try {
    return Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  } catch {
    return null;
  }
}

export function isRealClerkInstance(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const host = decodeFrontendApiHost(key);

  return host !== null && host.length > 0 && host !== PLACEHOLDER_HOST;
}

export const CLERK_SKIP_REASON =
  "No real Clerk instance configured. Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and " +
  "CLERK_SECRET_KEY to keys from a real Clerk application (dashboard.clerk.com) " +
  "and re-run. See docs/DEVELOPMENT.md § End-to-end tests.";

/**
 * The dedicated end-to-end user.
 *
 * Deliberately a `+clerk_test` address: Clerk development instances accept
 * that form without a real mailbox and without sending email, so the suite
 * never depends on an inbox. Credentials are overridable by environment so a
 * CI instance can use its own.
 *
 * This account exists ONLY for tests. Never point it at a real person's
 * account — the suite creates and deletes data freely.
 */
export const E2E_USER = {
  email: process.env.E2E_CLERK_EMAIL ?? "lifeos+clerk_test@example.com",
  password: process.env.E2E_CLERK_PASSWORD ?? "E2e-LifeOS-Test-2026!xQ7",
  /**
   * Set explicitly during onboarding. The specs assert against dates and
   * times, so the account's zone has to be known rather than whatever a
   * headless browser happens to report.
   */
  timeZone: "Asia/Kolkata",
  /**
   * The Clerk user id for this account, used to reset its data between runs.
   * Overridable so another instance can point at its own test user.
   */
  clerkUserId:
    process.env.E2E_CLERK_USER_ID ?? "user_3JNgBjUw42HdPbV5cwtTt771fBh",
} as const;

/**
 * Clerk's fixed verification code for `+clerk_test` addresses.
 *
 * Development instances accept it for any email/SMS verification step, which
 * is what makes new-device verification automatable without a real mailbox.
 * It works ONLY on development instances and ONLY for test addresses.
 */
export const CLERK_TEST_OTP = "424242";
