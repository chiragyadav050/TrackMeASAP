import { describe, expect, test } from "vitest";

import {
  budgetStatus,
  calculateStreak,
  completionRate,
  daysClean,
  formatMoney,
  goalPace,
  goalProgress,
  isDueOn,
  monthlyEquivalentMinor,
  parseMoneyToMinor,
  scheduledPerWeek,
  weeklyProgress,
  type HabitCadenceSpec,
  type HabitLogEntry,
  type Weekday,
} from "@/services/life/habit.derive";

const DAILY: HabitCadenceSpec = {
  cadence: "DAILY",
  targetPerPeriod: 1,
  weekdays: [],
};

/** Monday–Friday. */
const WEEKDAYS_ONLY: HabitCadenceSpec = {
  cadence: "SPECIFIC_DAYS",
  targetPerPeriod: 1,
  weekdays: [1, 2, 3, 4, 5],
};

const THRICE_WEEKLY: HabitCadenceSpec = {
  cadence: "WEEKLY",
  targetPerPeriod: 3,
  weekdays: [],
};

/**
 * 2026-09-07 is a Monday, so this fortnight runs Mon → Sun twice. Written out
 * rather than generated: a calendar bug in the test helper would hide exactly
 * the bug the tests exist to catch.
 */
const FORTNIGHT: readonly { dateKey: string; weekday: Weekday }[] = [
  { dateKey: "2026-09-07", weekday: 1 },
  { dateKey: "2026-09-08", weekday: 2 },
  { dateKey: "2026-09-09", weekday: 3 },
  { dateKey: "2026-09-10", weekday: 4 },
  { dateKey: "2026-09-11", weekday: 5 },
  { dateKey: "2026-09-12", weekday: 6 },
  { dateKey: "2026-09-13", weekday: 7 },
  { dateKey: "2026-09-14", weekday: 1 },
  { dateKey: "2026-09-15", weekday: 2 },
];

const TODAY = "2026-09-15";

const done = (dateKey: string): HabitLogEntry => ({
  dateKey,
  isCompleted: true,
  amount: null,
});

const missed = (dateKey: string): HabitLogEntry => ({
  dateKey,
  isCompleted: false,
  amount: null,
});

describe("isDueOn / scheduledPerWeek", () => {
  test("daily habits are due every day", () => {
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      expect(isDueOn(DAILY, weekday as Weekday)).toBe(true);
    }

    expect(scheduledPerWeek(DAILY)).toBe(7);
  });

  test("specific-day habits are due only on their days", () => {
    expect(isDueOn(WEEKDAYS_ONLY, 1)).toBe(true);
    expect(isDueOn(WEEKDAYS_ONLY, 6)).toBe(false);
    expect(isDueOn(WEEKDAYS_ONLY, 7)).toBe(false);

    expect(scheduledPerWeek(WEEKDAYS_ONLY)).toBe(5);
  });

  test("weekly habits are due every day — the target decides success", () => {
    // "Three times a week" does not name which days, so any day is a chance.
    expect(isDueOn(THRICE_WEEKLY, 3)).toBe(true);
    expect(isDueOn(THRICE_WEEKLY, 7)).toBe(true);

    expect(scheduledPerWeek(THRICE_WEEKLY)).toBe(3);
  });
});

describe("calculateStreak", () => {
  test("counts consecutive completed days", () => {
    const logs = ["2026-09-13", "2026-09-14", "2026-09-15"].map(done);

    expect(calculateStreak(FORTNIGHT, logs, DAILY, TODAY)).toEqual({
      current: 3,
      longest: 3,
    });
  });

  test("a gap resets the current streak but not the longest", () => {
    const logs = [
      done("2026-09-07"),
      done("2026-09-08"),
      done("2026-09-09"),
      done("2026-09-10"),
      // 11th and 12th missed entirely
      done("2026-09-14"),
      done("2026-09-15"),
    ];

    expect(calculateStreak(FORTNIGHT, logs, DAILY, TODAY)).toEqual({
      current: 2,
      longest: 4,
    });
  });

  test("today being unanswered does NOT break the streak", () => {
    // The day is still running — treating silence at 9am as failure would be
    // both wrong and demoralising.
    const logs = ["2026-09-13", "2026-09-14"].map(done);

    expect(calculateStreak(FORTNIGHT, logs, DAILY, TODAY).current).toBe(2);
  });

  test("…but an explicit miss today does break it", () => {
    const logs = [done("2026-09-13"), done("2026-09-14"), missed(TODAY)];

    expect(calculateStreak(FORTNIGHT, logs, DAILY, TODAY).current).toBe(0);
  });

  test("an unanswered day in the PAST is a miss", () => {
    // Otherwise a user who simply stopped logging would keep a growing streak.
    const logs = [done("2026-09-13"), done("2026-09-15")];

    expect(calculateStreak(FORTNIGHT, logs, DAILY, TODAY).current).toBe(1);
  });

  test("unscheduled days cannot break a streak", () => {
    // Sat 12th and Sun 13th are not due for a weekdays-only habit, so the
    // streak must carry across the weekend untouched.
    const logs = [
      done("2026-09-10"),
      done("2026-09-11"),
      done("2026-09-14"),
      done("2026-09-15"),
    ];

    expect(calculateStreak(FORTNIGHT, logs, WEEKDAYS_ONLY, TODAY)).toEqual({
      current: 4,
      longest: 4,
    });
  });

  test("is zero with no logs at all", () => {
    expect(calculateStreak(FORTNIGHT, [], DAILY, TODAY)).toEqual({
      current: 0,
      longest: 0,
    });
  });

  test("days after today are ignored", () => {
    const days = [
      ...FORTNIGHT,
      { dateKey: "2026-09-16", weekday: 3 as Weekday },
    ];

    // A log cannot exist for the future, and the absent day must not be
    // counted as a miss that zeroes a real streak.
    expect(
      calculateStreak(days, [done("2026-09-14"), done(TODAY)], DAILY, TODAY)
        .current,
    ).toBe(2);
  });
});

describe("completionRate", () => {
  test("is completed / scheduled as a percentage", () => {
    const logs = ["2026-09-07", "2026-09-08", "2026-09-09"].map(done);

    // 3 of 9 days.
    expect(completionRate(FORTNIGHT, logs, DAILY)).toBeCloseTo(33.33, 1);
  });

  test("counts only scheduled days in the denominator", () => {
    const logs = ["2026-09-07", "2026-09-08", "2026-09-09"].map(done);

    // 7 weekdays in the window, not 9.
    expect(completionRate(FORTNIGHT, logs, WEEKDAYS_ONLY)).toBeCloseTo(
      42.86,
      1,
    );
  });

  test("unanswered days count against the rate", () => {
    // Unlike a streak, a historical rate must not quietly drop the days a
    // user ignored — that would report a flattering number that is not true.
    expect(completionRate(FORTNIGHT, [done(TODAY)], DAILY)).toBeCloseTo(
      11.11,
      1,
    );
  });

  test("is null — not zero — when nothing was scheduled", () => {
    const weekend = [
      { dateKey: "2026-09-12", weekday: 6 as Weekday },
      { dateKey: "2026-09-13", weekday: 7 as Weekday },
    ];

    expect(completionRate(weekend, [], WEEKDAYS_ONLY)).toBeNull();
    expect(completionRate([], [], DAILY)).toBeNull();
  });
});

describe("weeklyProgress", () => {
  test("counts completions inside the week against the target", () => {
    const week = FORTNIGHT.slice(0, 7).map((day) => day.dateKey);
    const logs = ["2026-09-07", "2026-09-09", "2026-09-12"].map(done);

    expect(weeklyProgress(week, logs, THRICE_WEEKLY)).toEqual({
      completed: 3,
      target: 3,
    });
  });

  test("ignores completions outside the week", () => {
    const week = FORTNIGHT.slice(0, 7).map((day) => day.dateKey);
    const logs = [done("2026-09-07"), done("2026-09-14")];

    expect(weeklyProgress(week, logs, THRICE_WEEKLY).completed).toBe(1);
  });

  test("misses do not count toward the target", () => {
    const week = FORTNIGHT.slice(0, 7).map((day) => day.dateKey);

    expect(
      weeklyProgress(week, [missed("2026-09-07")], THRICE_WEEKLY).completed,
    ).toBe(0);
  });
});

describe("daysClean", () => {
  const difference = (fromKey: string, toKey: string): number =>
    Math.round(
      (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) /
        86_400_000,
    );

  test("counts from the last relapse", () => {
    // Relapsed on the 10th; the 11th through the 15th are clean.
    expect(daysClean(["2026-09-10"], "2026-09-01", TODAY, difference)).toBe(5);
  });

  test("uses the most recent relapse, not the first", () => {
    expect(
      daysClean(["2026-09-02", "2026-09-14"], "2026-09-01", TODAY, difference),
    ).toBe(1);
  });

  test("counts from the start date when there has been no relapse", () => {
    expect(daysClean([], "2026-09-01", TODAY, difference)).toBe(14);
  });

  test("silence is clean — not smoking requires no action", () => {
    // This is the key difference from `calculateStreak`: for a QUIT habit, a
    // day with no log is a day nothing happened, which is success.
    expect(daysClean([], "2026-09-14", TODAY, difference)).toBe(1);
  });

  test("a relapse today gives zero days clean", () => {
    expect(daysClean([TODAY], "2026-09-01", TODAY, difference)).toBe(0);
  });
});

describe("goalProgress", () => {
  const base = {
    targetValue: null,
    currentValue: 0,
    milestonesTotal: 0,
    milestonesCompleted: 0,
    status: "ACTIVE",
  };

  test("measured goals use the numbers", () => {
    expect(goalProgress({ ...base, targetValue: 12, currentValue: 3 })).toBe(
      25,
    );
  });

  test("measured goals never exceed 100 or go negative", () => {
    expect(goalProgress({ ...base, targetValue: 10, currentValue: 25 })).toBe(
      100,
    );
    expect(goalProgress({ ...base, targetValue: 10, currentValue: -5 })).toBe(
      0,
    );
  });

  test("falls back to milestones when there is no target value", () => {
    expect(
      goalProgress({ ...base, milestonesTotal: 4, milestonesCompleted: 1 }),
    ).toBe(25);
  });

  test("a measured goal prefers its numbers over its milestones", () => {
    expect(
      goalProgress({
        ...base,
        targetValue: 10,
        currentValue: 9,
        milestonesTotal: 2,
        milestonesCompleted: 0,
      }),
    ).toBe(90);
  });

  test("is null when the goal is unmeasurable", () => {
    // An intention with no way to tell whether it is being met. Inventing a
    // percentage here would be exactly the dishonesty this project forbids.
    expect(goalProgress(base)).toBeNull();
  });

  test("an achieved goal reads 100 regardless of the numbers", () => {
    expect(
      goalProgress({
        ...base,
        status: "ACHIEVED",
        targetValue: 100,
        currentValue: 2,
      }),
    ).toBe(100);
  });
});

describe("goalPace", () => {
  test("AHEAD when progress outruns elapsed time", () => {
    expect(goalPace(80, 5, 10)).toBe("AHEAD");
  });

  test("ON_TRACK inside the tolerance band", () => {
    expect(goalPace(50, 5, 10)).toBe("ON_TRACK");
    expect(goalPace(45, 5, 10)).toBe("ON_TRACK");
  });

  test("BEHIND when progress lags well behind time", () => {
    expect(goalPace(20, 5, 10)).toBe("BEHIND");
  });

  test("OVERDUE once the deadline passes unfinished", () => {
    expect(goalPace(60, 12, 10)).toBe("OVERDUE");
  });

  test("a finished goal past its date is not overdue", () => {
    expect(goalPace(100, 12, 10)).toBe("ON_TRACK");
  });

  test("UNKNOWN without measurable progress or a deadline", () => {
    expect(goalPace(null, 5, 10)).toBe("UNKNOWN");
    expect(goalPace(50, 5, 0)).toBe("UNKNOWN");
  });
});

describe("money", () => {
  test("parses major units into integer minor units", () => {
    expect(parseMoneyToMinor("19.99")).toBe(1999);
    expect(parseMoneyToMinor("500")).toBe(50000);
    expect(parseMoneyToMinor("1,250.50")).toBe(125050);
    expect(parseMoneyToMinor(" 0.05 ")).toBe(5);
  });

  test("rounds rather than truncating the float product", () => {
    // 19.99 * 100 is 1998.9999… in binary floating point; truncation would
    // silently lose a paisa on a very common price.
    expect(parseMoneyToMinor("19.99")).toBe(1999);
    expect(parseMoneyToMinor("0.29")).toBe(29);
  });

  test("rejects anything that is not a plain amount", () => {
    for (const bad of ["", "abc", "1.234", "1.2.3", "₹50", "1e3"]) {
      expect(parseMoneyToMinor(bad), bad).toBeNull();
    }
  });

  test("integer totals do not drift", () => {
    // The whole reason amounts are integers: summing 0.1 ten times as a float
    // gives 0.9999999999999999.
    const amounts = Array.from({ length: 10 }, () =>
      parseMoneyToMinor("0.10")!,
    );
    const total = amounts.reduce((sum, amount) => sum + amount, 0);

    expect(total).toBe(100);
    expect(formatMoney(total, "INR", "en-IN")).toContain("1.00");
  });

  test("formats minor units back to a currency string", () => {
    expect(formatMoney(125050, "INR", "en-IN")).toContain("1,250.50");
  });
});

describe("budgetStatus", () => {
  test("bands spending against the budget", () => {
    expect(budgetStatus(5000, 10000)).toBe("UNDER");
    expect(budgetStatus(8500, 10000)).toBe("NEAR");
    expect(budgetStatus(10000, 10000)).toBe("NEAR");
    expect(budgetStatus(10001, 10000)).toBe("OVER");
  });

  test("no budget is UNTRACKED, not 0% used", () => {
    // "0% of nothing" would imply a limit of zero, i.e. permanently over.
    expect(budgetStatus(5000, null)).toBe("UNTRACKED");
    expect(budgetStatus(5000, 0)).toBe("UNTRACKED");
  });
});

describe("monthlyEquivalentMinor", () => {
  test("normalises every cycle to a month", () => {
    expect(monthlyEquivalentMinor(30000, "MONTHLY")).toBe(30000);
    expect(monthlyEquivalentMinor(120000, "YEARLY")).toBe(10000);
    expect(monthlyEquivalentMinor(30000, "QUARTERLY")).toBe(10000);
  });

  test("weekly uses 52/12, not 4 — four weeks understates the year", () => {
    expect(monthlyEquivalentMinor(10000, "WEEKLY")).toBe(43333);
  });
});
