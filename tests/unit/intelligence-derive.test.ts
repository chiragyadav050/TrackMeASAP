import { describe, expect, test } from "vitest";

import {
  assessDeadlineRisk,
  buildTimeAudit,
  calculateLifeScore,
  detectBehaviourPatterns,
  detectForgotten,
  FORGOTTEN_DAYS,
  MAX_PROACTIVE_PER_DAY,
  MIN_PATTERN_SAMPLE,
  selectProactiveInsights,
  type Insight,
} from "@/services/intelligence/intelligence.derive";

/**
 * Proactive intelligence.
 *
 * These tests exist mostly to prove the system STAYS QUIET when it does not
 * know something. That is the property most likely to be quietly lost in a
 * later change, and the one whose loss would do the most damage.
 */

describe("detectForgotten", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Task",
    kind: "TASK" as const,
    daysUntouched: 40,
    hasDueDate: false,
    ...overrides,
  });

  test("flags something untouched for a long time", () => {
    const found = detectForgotten([entry()]);

    expect(found).toHaveLength(1);
    expect(found[0]?.evidence).toContain("40 days");
  });

  test("a week of quiet is normal life, not a problem", () => {
    // A low threshold would make this a nagging machine, which users disable.
    expect(detectForgotten([entry({ daysUntouched: 7 })])).toHaveLength(0);
    expect(
      detectForgotten([entry({ daysUntouched: FORGOTTEN_DAYS - 1 })]),
    ).toHaveLength(0);
  });

  test("something with a due date is not forgotten — it is scheduled", () => {
    expect(
      detectForgotten([entry({ hasDueDate: true, daysUntouched: 90 })]),
    ).toHaveLength(0);
  });

  test("every finding carries its evidence", () => {
    for (const found of detectForgotten([entry(), entry({ id: "t2" })])) {
      expect(found.evidence).toMatch(/\d+ days/);
    }
  });

  test("the most neglected comes first", () => {
    const found = detectForgotten([
      entry({ id: "a", daysUntouched: 35 }),
      entry({ id: "b", daysUntouched: 90 }),
    ]);

    expect(found[0]?.id).toBe("b");
  });
});

describe("assessDeadlineRisk", () => {
  const base = {
    id: "p1",
    title: "Project",
    daysRemaining: 10,
    remainingMinutes: 600,
    availableMinutesPerDay: 240,
  };

  test("plenty of time reads COMFORTABLE", () => {
    // 600 min over 10 days is 60 min/day against 240 available.
    expect(assessDeadlineRisk(base).level).toBe("COMFORTABLE");
  });

  test("needing most of the day is TIGHT", () => {
    expect(assessDeadlineRisk({ ...base, remainingMinutes: 2000 }).level).toBe(
      "TIGHT",
    );
  });

  test("needing more than the day has is AT_RISK", () => {
    expect(assessDeadlineRisk({ ...base, remainingMinutes: 2600 }).level).toBe(
      "AT_RISK",
    );
  });

  test("IMPOSSIBLE is said, not softened", () => {
    const risk = assessDeadlineRisk({
      ...base,
      remainingMinutes: 6000,
      daysRemaining: 2,
    });

    // 50 hours in 2 days. Calling this "challenging" wastes the one chance to
    // say something useful.
    expect(risk.level).toBe("IMPOSSIBLE");
  });

  test("a passed deadline is IMPOSSIBLE with an honest explanation", () => {
    const risk = assessDeadlineRisk({ ...base, daysRemaining: -3 });

    expect(risk.level).toBe("IMPOSSIBLE");
    expect(risk.evidence).toContain("passed 3 days ago");
  });

  test("a deadline today still counts today as a working day", () => {
    // Dividing by zero days would be Infinity.
    const risk = assessDeadlineRisk({ ...base, daysRemaining: 0 });

    expect(Number.isFinite(risk.requiredMinutesPerDay)).toBe(true);
    expect(risk.requiredMinutesPerDay).toBe(600);
  });

  test("no available time at all is IMPOSSIBLE, not a crash", () => {
    const risk = assessDeadlineRisk({ ...base, availableMinutesPerDay: 0 });

    expect(risk.level).toBe("IMPOSSIBLE");
  });

  test("the evidence contains the arithmetic", () => {
    const risk = assessDeadlineRisk(base);

    expect(risk.evidence).toContain("10h");
    expect(risk.evidence).toContain("10 days");
  });
});

describe("detectBehaviourPatterns", () => {
  const base = {
    completionsByWeekday: { 1: 10, 2: 2, 3: 5, 4: 4, 5: 3 },
    totalObservations: 24,
    recentRate: null as number | null,
    previousRate: null as number | null,
  };

  test("finds a best day when the sample is large enough", () => {
    const patterns = detectBehaviourPatterns(base);

    expect(patterns[0]?.kind).toBe("BEST_DAY");
    expect(patterns[0]?.statement).toContain("Monday");
  });

  test("SAYS NOTHING with too small a sample", () => {
    // "You're most productive on Tuesdays" from three data points is
    // astrology, not analysis.
    expect(
      detectBehaviourPatterns({
        ...base,
        totalObservations: MIN_PATTERN_SAMPLE - 1,
      }),
    ).toHaveLength(0);
  });

  test("says nothing when days barely differ", () => {
    // A one-completion gap is noise; reporting it trains the user to ignore
    // everything this module says.
    expect(
      detectBehaviourPatterns({
        ...base,
        completionsByWeekday: { 1: 5, 2: 5, 3: 4, 4: 5, 5: 5 },
      }),
    ).toHaveLength(0);
  });

  test("every pattern carries the numbers behind it", () => {
    const patterns = detectBehaviourPatterns(base);

    expect(patterns[0]?.evidence).toContain("10");
    expect(patterns[0]?.evidence).toContain("24 completions");
  });

  test("reports a real trend change in either direction", () => {
    const up = detectBehaviourPatterns({
      ...base,
      recentRate: 80,
      previousRate: 50,
    });
    const down = detectBehaviourPatterns({
      ...base,
      recentRate: 40,
      previousRate: 75,
    });

    expect(up.some((p) => p.statement.includes("more"))).toBe(true);
    expect(down.some((p) => p.statement.includes("less"))).toBe(true);
  });

  test("ignores a trivial change in rate", () => {
    const patterns = detectBehaviourPatterns({
      ...base,
      totalObservations: 5,
      recentRate: 62,
      previousRate: 58,
    });

    expect(patterns).toHaveLength(0);
  });

  test("says nothing about a trend with only one period of data", () => {
    expect(
      detectBehaviourPatterns({
        ...base,
        totalObservations: 5,
        recentRate: 80,
        previousRate: null,
      }),
    ).toHaveLength(0);
  });
});

describe("calculateLifeScore", () => {
  const base = {
    taskCompletionRate: 80,
    attendancePercent: 90,
    habitConsistency: 70,
    checkInCount: 5,
    checkInDaysPossible: 7,
  };

  test("averages the components that have data", () => {
    const score = calculateLifeScore(base);

    // (80 + 90 + 70 + 71.43) / 4
    expect(score.overall).toBeCloseTo(77.86, 1);
    expect(score.note).toContain("all four");
  });

  test("an untracked area scores NULL, not zero", () => {
    const score = calculateLifeScore({ ...base, habitConsistency: null });

    // A student who does not track habits is not failing at habits.
    const habits = score.components.find((c) => c.key === "HABITS");
    expect(habits?.score).toBeNull();
    expect(habits?.evidence).toContain("No habits are scheduled");
  });

  test("…and is excluded from the average, which says so", () => {
    const score = calculateLifeScore({
      ...base,
      habitConsistency: null,
      attendancePercent: null,
    });

    // (80 + 71.43) / 2 — the nulls do not drag it down.
    expect(score.overall).toBeCloseTo(75.71, 1);
    expect(score.note).toContain("2 of 4");
  });

  test("with nothing tracked the score is NULL and explains itself", () => {
    const score = calculateLifeScore({
      taskCompletionRate: null,
      attendancePercent: null,
      habitConsistency: null,
      checkInCount: 0,
      checkInDaysPossible: 0,
    });

    // No default 50 "to have something to show".
    expect(score.overall).toBeNull();
    expect(score.note).toContain("Not enough is tracked");
  });

  test("every component carries readable evidence", () => {
    for (const component of calculateLifeScore(base).components) {
      expect(component.evidence.length).toBeGreaterThan(5);
    }
  });

  test("wellbeing cannot exceed 100 through over-logging", () => {
    const score = calculateLifeScore({
      ...base,
      checkInCount: 20,
      checkInDaysPossible: 7,
    });

    const wellbeing = score.components.find((c) => c.key === "WELLBEING");
    expect(wellbeing?.score).toBe(100);
  });
});

describe("selectProactiveInsights", () => {
  const insight = (overrides: Partial<Insight> = {}): Insight => ({
    key: "k1",
    title: "Title",
    body: "Body",
    evidence: "Numbers",
    severity: "INFO",
    href: "/today",
    ...overrides,
  });

  test("caps how much it will interrupt for", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      insight({ key: `k${index}` }),
    );

    // A system that surfaces everything it notices is noise, and noise gets
    // muted.
    expect(selectProactiveInsights(many, [])).toHaveLength(
      MAX_PROACTIVE_PER_DAY,
    );
  });

  test("the most severe survives the cap", () => {
    const selected = selectProactiveInsights(
      [
        insight({ key: "a", severity: "INFO" }),
        insight({ key: "b", severity: "INFO" }),
        insight({ key: "c", severity: "INFO" }),
        insight({ key: "d", severity: "URGENT" }),
      ],
      [],
    );

    expect(selected[0]?.key).toBe("d");
    expect(selected).toHaveLength(MAX_PROACTIVE_PER_DAY);
  });

  test("never repeats something already sent", () => {
    const selected = selectProactiveInsights(
      [insight({ key: "a" }), insight({ key: "b" })],
      ["a"],
    );

    expect(selected.map((entry) => entry.key)).toEqual(["b"]);
  });

  test("nothing to say means nothing is sent", () => {
    expect(selectProactiveInsights([], [])).toHaveLength(0);
    expect(
      selectProactiveInsights([insight({ key: "a" })], ["a"]),
    ).toHaveLength(0);
  });

  test("does not mutate the caller's array", () => {
    const candidates = [
      insight({ key: "a", severity: "INFO" }),
      insight({ key: "b", severity: "URGENT" }),
    ];

    selectProactiveInsights(candidates, []);

    expect(candidates[0]?.key).toBe("a");
  });
});

describe("buildTimeAudit", () => {
  test("totals and ranks logged time", () => {
    const audit = buildTimeAudit([
      { category: "Study", minutes: 120 },
      { category: "Work", minutes: 60 },
      { category: "Study", minutes: 60 },
    ]);

    expect(audit.totalMinutes).toBe(240);
    expect(audit.byCategory[0]).toEqual({
      category: "Study",
      minutes: 180,
      percent: 75,
    });
  });

  test("nothing logged is reported as empty, not as zeroes", () => {
    const audit = buildTimeAudit([]);

    // An empty chart implying "you did nothing" would be a lie; the user
    // simply did not log.
    expect(audit.isEmpty).toBe(true);
    expect(audit.byCategory).toHaveLength(0);
  });

  test("percentages sum to 100", () => {
    const audit = buildTimeAudit([
      { category: "A", minutes: 33 },
      { category: "B", minutes: 33 },
      { category: "C", minutes: 34 },
    ]);

    const total = audit.byCategory.reduce(
      (sum, entry) => sum + entry.percent,
      0,
    );

    expect(total).toBeCloseTo(100, 6);
  });
});
