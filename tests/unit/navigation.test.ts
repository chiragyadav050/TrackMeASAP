import { describe, expect, test } from "vitest";

import {
  NAV_GROUPS,
  NAV_ITEMS,
  findNavItem,
  isNavItemActive,
} from "@/config/navigation";
import { PHASES, getPhase, phaseLabel } from "@/config/phases";

describe("navigation config", () => {
  // Pinned deliberately: the sidebar, mobile nav, breadcrumbs and command
  // palette all derive from this list, so a surface appearing or disappearing
  // should be a decision, not a side effect. Phase 5 added Goals; Phase 9 added Plan; Phase 10 added Insights.
  test("covers exactly the surfaces shipped so far, in order", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "Overview",
      "Today",
      "Plan",
      "Calendar",
      "Tasks",
      "Academics",
      "Work",
      "Projects",
      "Goals",
      "Habits",
      "Health",
      "Finance",
      "Insights",
      "AI",
      "Settings",
    ]);
  });

  test("has no duplicate hrefs", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test("points every item at a known phase", () => {
    const knownPhases = new Set(PHASES.map((phase) => phase.id));

    for (const item of NAV_ITEMS) {
      expect(knownPhases.has(item.phase), item.label).toBe(true);
    }
  });

  test("gives every group at least one item", () => {
    for (const group of NAV_GROUPS) {
      expect(group.items.length, group.label).toBeGreaterThan(0);
    }
  });
});

describe("findNavItem", () => {
  test("matches an exact path", () => {
    expect(findNavItem("/overview")?.label).toBe("Overview");
    expect(findNavItem("/settings")?.label).toBe("Settings");
  });

  test("matches a nested path so future sub-routes still resolve", () => {
    expect(findNavItem("/academics/subjects/123")?.label).toBe("Academics");
  });

  test("returns undefined for a path outside the app", () => {
    expect(findNavItem("/")).toBeUndefined();
    expect(findNavItem("/sign-in")).toBeUndefined();
  });

  test("does not match on a shared prefix that is not a path boundary", () => {
    // `/tasks-archive` must not resolve to `/tasks`.
    expect(findNavItem("/tasks-archive")).toBeUndefined();
  });
});

describe("isNavItemActive", () => {
  const overview = NAV_ITEMS.find((item) => item.href === "/overview");
  const tasks = NAV_ITEMS.find((item) => item.href === "/tasks");

  test("marks exactly one item active for a given path", () => {
    expect(overview).toBeDefined();
    expect(tasks).toBeDefined();

    if (!overview || !tasks) {
      return;
    }

    expect(isNavItemActive("/overview", overview)).toBe(true);
    expect(isNavItemActive("/overview", tasks)).toBe(false);
  });
});

describe("phases", () => {
  test("defines all ten phases with unique ids", () => {
    expect(PHASES).toHaveLength(10);
    expect(new Set(PHASES.map((phase) => phase.id)).size).toBe(10);
  });

  test("resolves a phase by id", () => {
    expect(getPhase(1).name).toBe("Foundation");
    expect(getPhase(8).name).toBe("Gemini AI Agent");
  });

  test("formats a readable label", () => {
    expect(phaseLabel(8)).toBe("Phase 8 — Gemini AI Agent");
  });
});
