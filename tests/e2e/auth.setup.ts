import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

import { CLERK_TEST_OTP, E2E_USER } from "./clerk-env";
import { resetE2EAccount } from "./reset-account";

/**
 * Signs in once and saves the session for every authenticated project.
 *
 * WHY THIS IS NOT A MOCK. This drives the REAL Clerk sign-in form against the
 * REAL development instance and ends with a genuine session cookie — the same
 * one a human gets. The only thing `@clerk/testing` contributes is a Testing
 * Token that lets an automated browser past bot protection; authentication
 * itself is untouched.
 *
 * Driving the form rather than Clerk's `signIn()` helper is deliberate: the
 * helper drives the client API directly and proved unable to establish a
 * session here, and the form is what a user actually uses — so this doubles as
 * a test that the sign-in page works.
 *
 * Running once and reusing the storage state keeps the suite fast and avoids
 * dozens of parallel workers hammering Clerk's sign-in endpoint.
 */

export const STORAGE_STATE = "tests/e2e/.auth/user.json";

/**
 * Enters the verification code and waits for Clerk to accept it.
 *
 * Returns whether the session landed, rather than throwing: the caller has a
 * recovery path (resend) and a final `waitForURL` that produces a far better
 * failure message than a timeout in here would.
 */
async function submitCode(
  page: import("@playwright/test").Page,
  code: import("@playwright/test").Locator,
): Promise<boolean> {
  await code.fill(CLERK_TEST_OTP);

  return page
    .waitForURL(/\/(today|overview|onboarding)/, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
}

setup("authenticate", async ({ page }) => {
  // A real sign-in round-trip to Clerk, including its client-trust step, does
  // not fit the default 30s test budget.
  setup.setTimeout(180_000);

  // Start every run from a clean account. The specs are written against an
  // empty slate, and one shared user otherwise accumulates data across runs
  // until those assertions become impossible. Scoped to this one test
  // account — see reset-account.ts.
  await resetE2EAccount(E2E_USER.clerkUserId);

  // Lets an automated browser past bot protection. Not an auth bypass.
  await setupClerkTestingToken({ page });

  await page.goto("/sign-in");

  // Clerk's form mounts asynchronously; wait for the field rather than sleep.
  const email = page.getByLabel(/email/i).first();
  await expect(email).toBeVisible({ timeout: 30_000 });
  await email.fill(E2E_USER.email);

  // EXACT match, deliberately. Clerk's social button is named "Sign in with
  // Google Continue with Google", so a loose /continue/i matches IT first and
  // navigates away to Google's OAuth page.
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Clerk splits identifier and password across two steps.
  const password = page.getByLabel(/password/i).first();
  await expect(password).toBeVisible({ timeout: 30_000 });
  await password.fill(E2E_USER.password);

  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Clerk asks a new device to verify by emailed code. This is EXACTLY what
  // the `+clerk_test` address exists for: development instances accept the
  // fixed code below without sending mail, so the suite never needs an inbox.
  // Any other address would make this step impossible to automate.
  // Clerk asks a NEW DEVICE to verify by emailed code — but only the first
  // time, so this step must be genuinely optional. Sampling visibility
  // instantly races the screen transition; waiting for it unconditionally
  // hangs on every later run. Racing the two possible outcomes handles both.
  const code = page.getByRole("textbox", { name: /verification code/i });
  const signedIn = /\/(today|overview|onboarding)/;

  const outcome = await Promise.race([
    code
      .waitFor({ state: "visible", timeout: 45_000 })
      .then(() => "needs-code" as const)
      .catch(() => "unknown" as const),
    page
      .waitForURL(signedIn, { timeout: 45_000 })
      .then(() => "signed-in" as const)
      .catch(() => "unknown" as const),
  ]);

  if (outcome === "needs-code") {
    // EXACTLY what the `+clerk_test` address exists for: development
    // instances accept this fixed code without sending mail, so the suite
    // never needs an inbox.
    //
    // Submitting is DELIBERATELY left to Clerk, which auto-submits as soon as
    // the last digit lands. Clicking Continue on top of that in-flight
    // request sends the verification twice and leaves the button spinning
    // forever, with the code showing "Success" on screen — a hang that only
    // ends at the timeout.
    await submitCode(page, code);

    // Occasionally the screen is reached without Clerk having issued a send,
    // and it answers "You need to send a verification code before attempting
    // to verify". Resend is the cure, but ONLY once that error is on screen:
    // resending speculatively invalidates a code that was already in flight,
    // which causes the very hang described above.
    const needsSend = page.getByText(/need to send a verification code/i);

    if (await needsSend.isVisible().catch(() => false)) {
      await page
        .getByRole("button", { name: /resend/i })
        .click()
        .catch(() => undefined);

      await submitCode(page, code);
    }
  }

  // Onboarding intercepts a brand-new profile; any of these proves the session
  // is real, because all three sit behind the auth guard.
  await page.waitForURL(/\/(today|overview|onboarding)/, { timeout: 60_000 });

  // Prove it rather than trusting the redirect.
  await expect(page).not.toHaveURL(/sign-in/);

  // A first-time profile must finish onboarding: the app layout redirects
  // every protected surface back here until it does, so without this each
  // authenticated test would land on this form instead of the page it asked
  // for. Navigating explicitly rather than testing the post-sign-in URL —
  // Clerk's redirect target varies, so that check fired at the wrong moment.
  await page.goto("/onboarding");

  const nameField = page.getByLabel(/what should we call you/i);

  if (await nameField.isVisible({ timeout: 15_000 }).catch(() => false)) {
    // Only the name is set. The form already defaults every other field —
    // the time zone falls back to UTC, which is what the specs assume — and
    // driving the zone picker proved brittle because the option list comes
    // from the browser's own Intl data.
    await nameField.fill("E2E Test User");
    await page.getByRole("button", { name: /start using life os/i }).click();

    // The action redirects on success; on failure it renders a field error.
    await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"), {
      timeout: 60_000,
    });
  }

  // The session is only useful if it actually opens a protected surface.
  await page.goto("/today");
  await expect(page).not.toHaveURL(/sign-in|onboarding/);

  // DISMISS THE FIRST-RUN TOUR, once, here.
  //
  // The account is reset at the start of every run, so without this the tour
  // is open on every one of the 124 specs — and its panel is deliberately
  // clickable, so it sits over real controls and swallows their clicks. That
  // is correct behaviour for a coach mark and completely wrong as a permanent
  // condition for a test suite that is not testing the tour.
  //
  // Skipping is a real user action that stamps `tourCompletedAt` on the
  // profile, so this is not a mock: it puts the account in the state every
  // other spec assumes — someone who has already seen the tour.
  const skipTour = page.getByRole("button", { name: "Skip", exact: true });

  if (await skipTour.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await skipTour.click();
    await expect(skipTour).toBeHidden();
  }

  await page.context().storageState({ path: STORAGE_STATE });
});
