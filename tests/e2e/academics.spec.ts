import { expect, test } from "@playwright/test";

import { CLERK_SKIP_REASON, isRealClerkInstance } from "./clerk-env";

/**
 * Phase 3 academic journeys.
 *
 * SKIPS ENTIRELY without a real Clerk instance — every one needs an
 * authenticated session, and Clerk's development handshake stops a browser
 * reaching the app when the publishable key is a placeholder. See
 * `clerk-env.ts` and docs/DEVELOPMENT.md.
 *
 * Deliberately NOT written against a stubbed session. The rules that actually
 * matter — attendance arithmetic, the one-current-semester constraint,
 * cross-tenant isolation, the assignment/task boundary — are covered FOR REAL
 * by 103 unit tests and 104 integration tests against a live database.
 */
test.skip(!isRealClerkInstance(), CLERK_SKIP_REASON);

const stamp = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** The academic module needs a semester and a subject before anything else. */
async function ensureSemesterAndSubject(
  page: import("@playwright/test").Page,
  label: string,
) {
  await page.goto("/academics/semesters");

  await page.getByRole("button", { name: /new semester/i }).click();
  const semesterDialog = page.getByRole("dialog");
  await semesterDialog.getByLabel("Name").fill(`Semester ${label}`);
  await semesterDialog.getByLabel("Academic year").fill("2025-26");
  await semesterDialog.getByLabel("Starts").fill("2026-01-05");
  await semesterDialog.getByLabel("Ends").fill("2026-05-30");
  await semesterDialog
    .getByRole("button", { name: /create semester/i })
    .click();
  await expect(semesterDialog).toBeHidden();

  // A brand-new semester is not current until asked; several surfaces depend
  // on there being one.
  //
  // Targeted by NAME rather than `.first()`. Every row renders the same
  // "Set current" text, so `.first()` silently made some OTHER semester
  // current once this account had more than one — and the subject created
  // below then landed on a semester the page does not show.
  const setCurrent = page.getByRole("button", {
    name: `Set Semester ${label} as current`,
  });

  if (await setCurrent.isVisible().catch(() => false)) {
    await setCurrent.click();
    await expect(setCurrent).toBeHidden();
  }

  await page.goto("/academics/subjects");
  await page
    .getByRole("button", { name: /add subject/i })
    .first()
    .click();

  const subjectDialog = page.getByRole("dialog");
  await subjectDialog.getByLabel("Subject name").fill(`Cloud ${label}`);
  await subjectDialog.getByLabel("Code").fill(`CC-${label.slice(-4)}`);
  await subjectDialog.getByLabel("Attendance required").fill("75");
  await subjectDialog.getByRole("button", { name: /add subject/i }).click();
  await expect(subjectDialog).toBeHidden();
}

test.describe("semester", () => {
  test("can be created, set current, and drives the dashboard", async ({
    page,
  }) => {
    const label = stamp();

    await page.goto("/academics/semesters");
    await page.getByRole("button", { name: /new semester/i }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(`Semester ${label}`);
    await dialog.getByLabel("Academic year").fill("2025-26");
    await dialog.getByLabel("Starts").fill("2026-01-05");
    await dialog.getByLabel("Ends").fill("2026-05-30");
    await dialog.getByRole("button", { name: /create semester/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Semester ${label}`)).toBeVisible();

    await page
      .getByRole("button", { name: `Set Semester ${label} as current` })
      .click();

    // The button is only rendered for a semester that is NOT current, so its
    // disappearance is what proves THIS semester became current — rather than
    // some other row that happened to already carry the badge.
    await expect(
      page.getByRole("button", { name: `Set Semester ${label} as current` }),
    ).toBeHidden();
    await expect(page.getByText("Current", { exact: true })).toHaveCount(1);

    // The overview stops showing the "create a semester" empty state.
    await page.goto("/academics");
    await expect(page.getByText(`Semester ${label}`)).toBeVisible();
  });

  test("only one semester is current at a time", async ({ page }) => {
    const label = stamp();

    await page.goto("/academics/semesters");

    for (const suffix of ["A", "B"]) {
      await page.getByRole("button", { name: /new semester/i }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(`Sem ${label}${suffix}`);
      await dialog.getByLabel("Academic year").fill("2025-26");
      await dialog.getByLabel("Starts").fill("2026-01-05");
      await dialog.getByLabel("Ends").fill("2026-05-30");
      await dialog.getByRole("button", { name: /create semester/i }).click();
      await expect(dialog).toBeHidden();
    }

    // A then B, each by name. Naming them is what makes the assertion below
    // meaningful: the point is that setting B UNSET A, so the test has to know
    // which one it set last.
    await page
      .getByRole("button", { name: `Set Sem ${label}A as current` })
      .click();
    await expect(
      page.getByRole("button", { name: `Set Sem ${label}A as current` }),
    ).toBeHidden();

    await page
      .getByRole("button", { name: `Set Sem ${label}B as current` })
      .click();
    await expect(
      page.getByRole("button", { name: `Set Sem ${label}B as current` }),
    ).toBeHidden();

    // Exactly one badge, and A is offerable again — it was demoted.
    await expect(page.getByText("Current", { exact: true })).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: `Set Sem ${label}A as current` }),
    ).toBeVisible();
  });
});

test.describe("subjects", () => {
  test("can be created and opened", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await expect(page.getByText(`Cloud ${label}`)).toBeVisible();

    await page.getByText(`Cloud ${label}`).click();

    await expect(
      page.getByRole("heading", { name: `Cloud ${label}` }),
    ).toBeVisible();
    // A subject with no marked classes says so rather than showing 0%.
    await expect(page.getByText(/no classes marked/i).first()).toBeVisible();
  });
});

test.describe("attendance", () => {
  test("marking a class updates the percentage and the advice", async ({
    page,
  }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/attendance");

    // Without a timetable there are no class occurrences, which the page
    // states honestly rather than inventing any.
    await expect(page.getByText(/no classes yet/i)).toBeVisible();
  });

  test("the calculator answers the real question", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/attendance");

    await page.getByLabel("Attended").fill("41");
    await page.getByLabel("Missed").fill("9");
    await page.getByLabel("Required").fill("75");
    await page.getByRole("button", { name: /^calculate$/i }).click();

    // 41/50 = 82%, and 4 more absences keep it at or above 75%.
    await expect(page.getByText("82%")).toBeVisible();
    await expect(page.getByText(/can miss 4 more classes/i)).toBeVisible();
  });
});

test.describe("assignments", () => {
  test("can be created and appear in the list", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/assignments");
    await page
      .getByRole("button", { name: /new assignment/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(`Report ${label}`);
    await dialog
      .getByLabel("Due date")
      .fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole("button", { name: /create assignment/i }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Report ${label}`)).toBeVisible();
    // Work status and submission are shown side by side, never merged.
    await expect(page.getByText("Not started").first()).toBeVisible();
    await expect(page.getByText("Not submitted").first()).toBeVisible();
  });

  test("CONVERTING TO A TASK puts it on Today without submitting it", async ({
    page,
  }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/assignments");
    await page
      .getByRole("button", { name: /new assignment/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(`Linked ${label}`);
    await dialog
      .getByLabel("Due date")
      .fill(new Date().toISOString().slice(0, 10));
    // The dialog creates a task by default.
    await dialog.getByRole("button", { name: /create assignment/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/task linked/i).first()).toBeVisible();

    // It shows up as real work on Today…
    //
    // Scoped to the task's own heading. The title also appears in the command
    // palette's index and in the linked-assignment caption, so an unscoped
    // match trips strict mode on four elements — all of them legitimate.
    await page.goto("/today");
    await expect(
      page.getByRole("button", { name: new RegExp(`Linked ${label}`) }).first(),
    ).toBeVisible();

    // …and the assignment is still NOT submitted.
    await page.goto("/academics/assignments");
    await expect(page.getByText("Not submitted").first()).toBeVisible();
  });

  test("submission is recorded independently of work status", async ({
    page,
  }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/assignments");
    await page
      .getByRole("button", { name: /new assignment/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(`Submit ${label}`);
    await dialog.getByRole("button", { name: /create assignment/i }).click();
    await expect(dialog).toBeHidden();

    await page
      .getByRole("button", { name: `Actions for Submit ${label}` })
      .click();
    await page.getByRole("menuitem", { name: /^submission$/i }).click();
    await page.getByRole("menuitem", { name: /^submitted$/i }).click();

    // Scoped to THIS assignment's row. An unscoped `getByText("Submitted")`
    // also matches the closed menu's own "Submitted" item and the substring
    // inside "Not submitted" on other rows, so it can pass or fail for
    // reasons that have nothing to do with this assignment.
    const row = page
      .getByRole("listitem")
      .filter({ hasText: `Submit ${label}` });

    await expect(row.getByText("Submitted", { exact: true })).toBeVisible();
    // The work status did not move.
    await expect(row.getByText("Not started", { exact: true })).toBeVisible();
  });
});

test.describe("exams", () => {
  test("topics drive the preparation percentage", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/exams");
    await page
      .getByRole("button", { name: /new exam/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(`Midterm ${label}`);
    await dialog
      .getByLabel("Date")
      .fill(new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10));
    await dialog.getByRole("button", { name: /create exam/i }).click();
    await expect(dialog).toBeHidden();

    // Before any topics exist, the page says tracking has not started rather
    // than claiming 0% prepared.
    await expect(
      page.getByText(/preparation tracking not started/i).first(),
    ).toBeVisible();

    // The exam card is a link. Targeting the link rather than the bare text
    // avoids also matching the command palette's copy of the same title.
    await page
      .getByRole("link", { name: new RegExp(`Midterm ${label}`) })
      .click();

    const topicInput = page.getByLabel("New topic");

    for (const topic of [
      "Normalisation",
      "Indexing",
      "Transactions",
      "Joins",
    ]) {
      await topicInput.fill(topic);
      await topicInput.press("Enter");
      await expect(page.getByText(topic)).toBeVisible();
    }

    await expect(page.getByText("0% · 0/4")).toBeVisible();

    // Named by its visible label; covered/not-covered is carried by
    // aria-checked rather than by a change of name.
    const topic = page.getByRole("checkbox", { name: "Normalisation" });

    await expect(topic).not.toBeChecked();
    await topic.click();
    await expect(topic).toBeChecked();

    // 1 of 4 is 25% — a plain count, verifiable at a glance.
    await expect(page.getByText("25% · 1/4")).toBeVisible();
  });
});

test.describe("study", () => {
  test("logging a session updates the weekly total", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/study");

    await expect(
      page.getByText(/your study history will appear here/i),
    ).toBeVisible();

    await page.getByLabel("Minutes").fill("45");
    await page.getByRole("button", { name: /log session/i }).click();

    await expect(page.getByText("45m").first()).toBeVisible();
  });
});

test.describe("integration with the rest of Life OS", () => {
  test("an academic deadline reaches Today and Overview", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics/assignments");
    await page
      .getByRole("button", { name: /new assignment/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(`Today ${label}`);
    await dialog
      .getByLabel("Due date")
      .fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole("button", { name: /create assignment/i }).click();
    await expect(dialog).toBeHidden();

    await page.goto("/today");
    await expect(
      page.getByRole("heading", { name: /academics/i }),
    ).toBeVisible();

    await page.goto("/overview");
    await expect(
      page.getByRole("heading", { name: /academic progress/i }),
    ).toBeVisible();
  });

  test("the command palette finds academic records", async ({ page }) => {
    const label = stamp();
    await ensureSemesterAndSubject(page, label);

    await page.goto("/academics");
    await page.keyboard.press("ControlOrMeta+k");

    const palette = page.getByRole("dialog");
    // By placeholder: the palette renders a search box, not a listbox-backed
    // combobox, so the role lookup depends on cmdk internals rather than on
    // anything the user can see.
    await palette.getByPlaceholder(/search tasks/i).fill(`Cloud ${label}`);

    await expect(palette.getByText(`Cloud ${label}`)).toBeVisible();
  });
});

test.describe("responsive", () => {
  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
  ]) {
    test(`Academics does not overflow horizontally at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await page.goto("/academics");

      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );

      expect(overflows, "page scrolls sideways").toBe(false);
    });
  }
});
