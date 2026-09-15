import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 6 calendar, reminder and notification journeys.
 *
 * SKIPS ENTIRELY without a real Clerk instance — see `clerk-env.ts`.
 *
 * The rules that matter here — quiet-hours wrap-around, recurrence
 * arithmetic, conflict detection, free-time gaps, and above all the
 * IDEMPOTENCY of reminder firing — are covered by 43 unit tests and 47
 * integration tests, and the firing path was additionally verified END TO END
 * against live Redis and Postgres with the real BullMQ worker. See
 * test_phase6.txt §4.
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

const stamp = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

test.describe("calendar", () => {
  test("opens on the current week with view controls", async ({ page }) => {
    await page.goto("/calendar");

    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Week" })).toBeVisible();
  });

  test("the view lives in the URL", async ({ page }) => {
    await page.goto("/calendar");
    await page.getByRole("button", { name: "Month" }).click();

    await expect(page).toHaveURL(/view=MONTH/);
  });

  test("an event can be added and appears on its day", async ({ page }) => {
    const title = `Study group ${stamp()}`;

    await page.goto("/calendar");
    await page
      .getByRole("button", { name: /new event/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("From").fill("14:00");
    await dialog.getByLabel("To").fill("16:00");
    await dialog.getByRole("button", { name: /add event/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("14:00–16:00").first()).toBeVisible();
  });

  test("overlapping events surface a conflict warning", async ({ page }) => {
    const first = `Block A ${stamp()}`;
    const second = `Block B ${stamp()}`;

    await page.goto("/calendar");

    for (const [title, from, to] of [
      [first, "10:00", "12:00"],
      [second, "11:00", "13:00"],
    ] as const) {
      await page
        .getByRole("button", { name: /new event/i })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("From").fill(from);
      await dialog.getByLabel("To").fill(to);
      await dialog.getByRole("button", { name: /add event/i }).click();
      await expect(dialog).toBeHidden();
    }

    await expect(page.getByText(/overlapping commitments/i)).toBeVisible();
    await expect(page.getByText(/60 min overlap/i)).toBeVisible();
  });

  test("an event that ends before it starts is rejected", async ({ page }) => {
    await page.goto("/calendar");
    await page
      .getByRole("button", { name: /new event/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Backwards");
    await dialog.getByLabel("From").fill("16:00");
    await dialog.getByLabel("To").fill("14:00");
    await dialog.getByRole("button", { name: /add event/i }).click();

    await expect(dialog.getByText(/must end after it starts/i)).toBeVisible();
  });
});

test.describe("reminders", () => {
  test("a reminder can be set and snoozed", async ({ page }) => {
    const title = `Lab report ${stamp()}`;

    await page.goto("/calendar");
    await page
      .getByRole("button", { name: /new reminder/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Remind me to").fill(title);
    await dialog.getByLabel("Time").fill("09:00");
    await dialog.getByRole("button", { name: /set reminder/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(title)).toBeVisible();

    await page.getByRole("button", { name: "1 hour" }).first().click();
    await expect(page.getByText(/snoozed/i).first()).toBeVisible();
  });

  test("a repeating reminder asks which days when needed", async ({ page }) => {
    await page.goto("/calendar");
    await page
      .getByRole("button", { name: /new reminder/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Repeat").selectOption("WEEKDAYS");

    // The day picker only appears for the cadence that uses it.
    await expect(dialog.getByText("Mon")).toBeVisible();
  });
});

test.describe("notifications", () => {
  test("the bell is present and reports honestly when empty", async ({
    page,
  }) => {
    await page.goto("/today");
    await page.getByRole("button", { name: /notifications/i }).click();

    await expect(page.getByText(/nothing yet/i)).toBeVisible();
  });
});

test.describe("responsive", () => {
  for (const width of [320, 768, 1440]) {
    test(`the calendar does not overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/calendar");

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );

      expect(overflows).toBe(false);
    });
  }
});
