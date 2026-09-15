import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 1 browser smoke suite.
 *
 * Everything asserted here is real behaviour of the built application: no
 * mocking, no stubbed session, no fabricated data.
 *
 * The whole file SKIPS unless a real Clerk instance is configured. Clerk's
 * development handshake redirects the browser to the instance's Frontend API
 * host before any page renders, so with the placeholder key in `.env` the
 * browser never reaches the app at all. See `clerk-env.ts` for the detail.
 * Skipping loudly is the honest outcome — the alternative would be mocking
 * Clerk and asserting that the mock works.
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

const PROTECTED_ROUTES = [
  "/overview",
  "/today",
  "/calendar",
  "/tasks",
  "/academics",
  "/work",
  "/projects",
  "/habits",
  "/health",
  "/finance",
  "/ai",
  "/settings",
  "/onboarding",
] as const;

test.describe("public surfaces", () => {
  // The signed-out experience. A session would change what these render.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the landing page loads and explains the product", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: /your entire life/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /get started/i }),
    ).toBeVisible();

    // The roadmap position is stated honestly on the public page.
    await expect(page.getByText(/phase 1/i).first()).toBeVisible();
  });

  test("the landing page links into the auth surfaces", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/sign-up/);

    await expect(
      page.getByRole("heading", { level: 1, name: /create your account/i }),
    ).toBeVisible();
  });

  test("the sign-in page renders", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByRole("heading", { level: 1, name: /welcome back/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /create an account/i }),
    ).toBeVisible();
  });
});

test.describe("route protection", () => {
  // These assert the ANONYMOUS journey, so they must discard the shared
  // signed-in session the other projects reuse. Without this they would prove
  // the opposite of what they claim — that a logged-in user reaches the app.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects an anonymous visitor to sign-in`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/sign-in/);
      await expect(
        page.getByRole("heading", { level: 1, name: /welcome back/i }),
      ).toBeVisible();
    });
  }
});

test.describe("error surfaces", () => {
  test("an unknown URL renders the 404 page with real navigation", async ({
    page,
  }) => {
    const response = await page.goto("/this-page-does-not-exist");

    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole("heading", { level: 1, name: /does not exist/i }),
    ).toBeVisible();

    // The 404 is useful: it lists the surfaces that do exist.
    await expect(
      page.getByRole("navigation", { name: /all surfaces/i }),
    ).toBeVisible();
  });
});

test.describe("theming", () => {
  test("the theme toggle switches between light and dark", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");

    await page.getByRole("button", { name: /change theme/i }).click();
    await page.getByRole("menuitem", { name: /^dark$/i }).click();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: /change theme/i }).click();
    await page.getByRole("menuitem", { name: /^light$/i }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("the chosen theme survives a reload with no flash of the wrong one", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: /change theme/i }).click();
    await page.getByRole("menuitem", { name: /^dark$/i }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();

    // next-themes applies the class in a blocking pre-paint script, so it is
    // already present on the very first evaluation after load.
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});

test.describe("responsive layout", () => {
  const VIEWPORTS = [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "laptop", width: 1280, height: 800 },
    { name: "desktop", width: 1440, height: 900 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    test(`the landing page does not overflow horizontally at ${viewport.name} (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await page.goto("/");
      await expect(
        page.getByRole("heading", { level: 1, name: /your entire life/i }),
      ).toBeVisible();

      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );

      expect(overflows, "page scrolls sideways").toBe(false);
    });
  }
});

test.describe("accessibility basics", () => {
  test("the landing page exposes one h1 and landmark regions", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("interactive controls are reachable and visibly focusable", async ({
    page,
  }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");

    const focused = page.locator(":focus-visible");
    await expect(focused).toBeVisible();
  });
});
