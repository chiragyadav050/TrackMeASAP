import { describe, expect, test } from "vitest";

import {
  assessWorkload,
  buildDailyPlan,
  buildExamMode,
  buildRecoveryPlan,
  buildWeeklyReview,
  detectProcrastination,
  MAX_BLOCK_MINUTES,
  MINIMUM_BLOCK_MINUTES,
  type PlannableItem,
  type PlanSlot,
} from "@/services/planning/planning.derive";

const item = (overrides: Partial<PlannableItem> = {}): PlannableItem => ({
  id: "t1",
  title: "Task",
  score: 50,
  estimatedMinutes: 60,
  energy: "MEDIUM",
  dueDayKey: null,
  isOverdue: false,
  kind: "TASK",
  ...overrides,
});

/** 09:00–12:00 peak, 14:00–17:00 ordinary. Minutes since local midnight. */
const SLOTS: PlanSlot[] = [
  { startMinute: 9 * 60, endMinute: 12 * 60, isPeak: true },
  { startMinute: 14 * 60, endMinute: 17 * 60, isPeak: false },
];

describe("buildDailyPlan", () => {
  test("places work in score order", () => {
    const plan = buildDailyPlan(
      [
        item({ id: "low", score: 10, estimatedMinutes: 60 }),
        item({ id: "high", score: 90, estimatedMinutes: 60 }),
      ],
      SLOTS,
    );

    // The priority engine decides what matters; the planner just obeys.
    expect(plan.blocks[0]?.item.id).toBe("high");
  });

  test("is deterministic for identical inputs", () => {
    const items = [
      item({ id: "a", score: 50 }),
      item({ id: "b", score: 50 }),
      item({ id: "c", score: 50 }),
    ];

    // A planner that shuffles between refreshes cannot be trusted.
    const first = buildDailyPlan(items, SLOTS).blocks.map((b) => b.item.id);
    const second = buildDailyPlan(items, SLOTS).blocks.map((b) => b.item.id);

    expect(first).toEqual(second);
  });

  test("does not mutate the caller's array", () => {
    const items = [item({ id: "a", score: 10 }), item({ id: "b", score: 90 })];

    buildDailyPlan(items, SLOTS);

    expect(items.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  test("HIGH-energy work prefers a peak slot", () => {
    const plan = buildDailyPlan(
      [item({ id: "hard", energy: "HIGH", estimatedMinutes: 60 })],
      SLOTS,
    );

    expect(plan.blocks[0]?.startMinute).toBe(9 * 60);
    expect(plan.blocks[0]?.reasons.join(" ")).toContain("peak hours");
  });

  test("…but is still scheduled when no peak time is free", () => {
    const afternoonOnly: PlanSlot[] = [
      { startMinute: 14 * 60, endMinute: 17 * 60, isPeak: false },
    ];

    const plan = buildDailyPlan(
      [item({ id: "hard", energy: "HIGH" })],
      afternoonOnly,
    );

    // An unscheduled important task helps nobody — but the reason is honest.
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]?.reasons.join(" ")).toContain(
      "no peak time was free",
    );
  });

  test("caps a single block so nobody works 3 hours straight", () => {
    const plan = buildDailyPlan(
      [item({ id: "long", estimatedMinutes: 180 })],
      SLOTS,
    );

    for (const block of plan.blocks) {
      expect(block.minutes).toBeLessThanOrEqual(MAX_BLOCK_MINUTES);
    }
  });

  test("splits a long item across slots rather than dropping it", () => {
    const plan = buildDailyPlan(
      [item({ id: "long", estimatedMinutes: 150 })],
      SLOTS,
    );

    expect(plan.blocks.length).toBeGreaterThan(1);
    expect(plan.blocks.some((block) => block.isPartial)).toBe(true);
    expect(plan.blocks[0]?.reasons.join(" ")).toContain("Split");
  });

  test("never creates a fragment too small to be useful", () => {
    const tinyGap: PlanSlot[] = [
      { startMinute: 9 * 60, endMinute: 9 * 60 + 7, isPeak: true },
    ];

    const plan = buildDailyPlan([item({ estimatedMinutes: 60 })], tinyGap);

    // A seven-minute fragment is interruption, not work.
    expect(plan.blocks).toHaveLength(0);
    expect(plan.unplanned).toHaveLength(1);
  });

  test("leaves a break between blocks", () => {
    const plan = buildDailyPlan(
      [
        item({ id: "a", score: 90, estimatedMinutes: 30 }),
        item({ id: "b", score: 80, estimatedMinutes: 30 }),
      ],
      SLOTS,
    );

    const [first, second] = plan.blocks;
    expect(second!.startMinute).toBeGreaterThan(first!.endMinute);
  });

  test("unplanned items carry an honest reason", () => {
    const plan = buildDailyPlan([item({ estimatedMinutes: 60 })], []);

    // Silently dropping work would make the plan a lie.
    expect(plan.blocks).toHaveLength(0);
    expect(plan.unplanned[0]?.reason).toContain("no free time");
  });

  test("reports the arithmetic it used", () => {
    const plan = buildDailyPlan([item({ estimatedMinutes: 60 })], SLOTS);

    expect(plan.availableMinutes).toBe(360);
    expect(plan.plannedMinutes).toBe(60);
  });

  test("an overdue item says so in its reasons", () => {
    const plan = buildDailyPlan([item({ isOverdue: true })], SLOTS);

    expect(plan.blocks[0]?.reasons).toContain("Already overdue");
  });

  test("a zero-estimate item still gets a usable minimum block", () => {
    const plan = buildDailyPlan([item({ estimatedMinutes: 0 })], SLOTS);

    expect(plan.blocks[0]?.minutes).toBe(MINIMUM_BLOCK_MINUTES);
  });

  test("blocks come back in chronological order", () => {
    const plan = buildDailyPlan(
      [
        item({ id: "a", score: 10, estimatedMinutes: 60 }),
        item({ id: "b", score: 90, estimatedMinutes: 60 }),
        item({ id: "c", score: 50, estimatedMinutes: 60 }),
      ],
      SLOTS,
    );

    const starts = plan.blocks.map((block) => block.startMinute);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("assessWorkload", () => {
  test("bands required against available time", () => {
    expect(assessWorkload(60, 480).verdict).toBe("LIGHT");
    expect(assessWorkload(240, 480).verdict).toBe("COMFORTABLE");
    expect(assessWorkload(400, 480).verdict).toBe("FULL");
    expect(assessWorkload(600, 480).verdict).toBe("OVERCOMMITTED");
  });

  test("says OVERCOMMITTED plainly rather than softening it", () => {
    const result = assessWorkload(840, 480);

    expect(result.verdict).toBe("OVERCOMMITTED");
    expect(result.ratio).toBeCloseTo(1.75, 2);
  });

  test("a day with no time is overcommitted if anything is due", () => {
    expect(assessWorkload(60, 0).verdict).toBe("OVERCOMMITTED");
    expect(assessWorkload(0, 0).verdict).toBe("LIGHT");
  });
});

describe("detectProcrastination", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Task",
    rescheduleCount: 0,
    daysSinceCreated: 1,
    isCompleted: false,
    ...overrides,
  });

  test("one reschedule is a person with a changing day, not a problem", () => {
    expect(detectProcrastination([entry({ rescheduleCount: 1 })])).toHaveLength(
      0,
    );
  });

  test("three reschedules is STUCK", () => {
    const signals = detectProcrastination([entry({ rescheduleCount: 3 })]);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.severity).toBe("STUCK");
  });

  test("two reschedules on something old is WATCH", () => {
    const signals = detectProcrastination([
      entry({ rescheduleCount: 2, daysSinceCreated: 20 }),
    ]);

    expect(signals[0]?.severity).toBe("WATCH");
  });

  test("…but two reschedules on something recent is not flagged", () => {
    expect(
      detectProcrastination([
        entry({ rescheduleCount: 2, daysSinceCreated: 3 }),
      ]),
    ).toHaveLength(0);
  });

  test("completed items are never flagged", () => {
    expect(
      detectProcrastination([entry({ rescheduleCount: 9, isCompleted: true })]),
    ).toHaveLength(0);
  });

  test("the worst offenders come first", () => {
    const signals = detectProcrastination([
      entry({ id: "a", rescheduleCount: 3 }),
      entry({ id: "b", rescheduleCount: 7 }),
    ]);

    expect(signals[0]?.itemId).toBe("b");
  });
});

describe("buildRecoveryPlan", () => {
  const base = {
    overdueCount: 0,
    dueTodayCount: 0,
    availableMinutes: 480,
    requiredMinutes: 120,
    rankedTitles: ["A", "B", "C", "D", "E"],
  };

  test("is not needed on an ordinary day", () => {
    expect(buildRecoveryPlan(base).isNeeded).toBe(false);
  });

  test("triggers on a real backlog", () => {
    const plan = buildRecoveryPlan({ ...base, overdueCount: 6 });

    expect(plan.isNeeded).toBe(true);
    expect(plan.reason).toContain("6");
  });

  test("triggers when the day cannot hold the work", () => {
    const plan = buildRecoveryPlan({
      ...base,
      requiredMinutes: 900,
      availableMinutes: 300,
    });

    expect(plan.isNeeded).toBe(true);
    expect(plan.reason).toContain("more hours");
  });

  test("NAMES what to drop rather than saying 'prioritise'", () => {
    const plan = buildRecoveryPlan({ ...base, overdueCount: 9 });

    // The hardest decision must not be left with the overwhelmed person.
    expect(plan.focus.length).toBeGreaterThan(0);
    expect(plan.defer.length).toBeGreaterThan(0);
    expect([...plan.focus, ...plan.defer]).toEqual(base.rankedTitles);
  });

  test("promises only what the day can hold", () => {
    const plan = buildRecoveryPlan({
      ...base,
      overdueCount: 9,
      availableMinutes: 45,
    });

    // 45 minutes is one block, so one focus item.
    expect(plan.focus).toHaveLength(1);
  });
});

describe("buildExamMode", () => {
  const base = {
    examTitle: "Networks",
    daysUntil: 7,
    topicsTotal: 14,
    topicsCompleted: 0,
    minutesPerTopic: 30,
    dailyStudyCapacityMinutes: 180,
  };

  test("is inactive when no exam is close", () => {
    expect(buildExamMode({ ...base, daysUntil: 40 }).isActive).toBe(false);
    expect(buildExamMode({ ...base, examTitle: null }).isActive).toBe(false);
  });

  test("computes a daily figure from real arithmetic", () => {
    const plan = buildExamMode(base);

    // 14 topics × 30 min ÷ 7 days = 60 min/day.
    expect(plan.isActive).toBe(true);
    expect(plan.dailyStudyMinutes).toBe(60);
    expect(plan.topicsRemaining).toBe(14);
    expect(plan.warning).toBeNull();
  });

  test("warns instead of recommending an impossible day", () => {
    const plan = buildExamMode({
      ...base,
      topicsTotal: 40,
      daysUntil: 2,
      dailyStudyCapacityMinutes: 180,
    });

    // 40 × 30 ÷ 2 = 600 min/day, which nobody has.
    expect(plan.dailyStudyMinutes).toBe(600);
    expect(plan.warning).toContain("more than you have");
  });

  test("an exam tomorrow still counts today as study time", () => {
    const plan = buildExamMode({ ...base, daysUntil: 0, topicsTotal: 4 });

    // Dividing by zero days would be Infinity; today is a day.
    expect(plan.dailyStudyMinutes).toBe(120);
  });

  test("everything covered means nothing left to do", () => {
    const plan = buildExamMode({ ...base, topicsCompleted: 14 });

    expect(plan.topicsRemaining).toBe(0);
    expect(plan.dailyStudyMinutes).toBe(0);
    expect(plan.warning).toBeNull();
  });
});

describe("buildWeeklyReview", () => {
  const base = {
    completedCount: 10,
    createdCount: 8,
    dueCount: 12,
    habitScheduled: 14,
    habitCompleted: 12,
    minutesPerDay: { "2026-09-14": 120, "2026-09-15": 300 },
  };

  test("computes rates from real counts", () => {
    const review = buildWeeklyReview(base);

    expect(review.completionRate).toBeCloseTo(83.33, 1);
    expect(review.habitConsistency).toBeCloseTo(85.71, 1);
    expect(review.busiestDayKey).toBe("2026-09-15");
  });

  test("a week with nothing due reports null, not 0%", () => {
    const review = buildWeeklyReview({ ...base, dueCount: 0 });

    expect(review.completionRate).toBeNull();
  });

  test("notices a list growing faster than it shrinks", () => {
    const review = buildWeeklyReview({
      ...base,
      createdCount: 20,
      completedCount: 3,
    });

    expect(review.observations.join(" ")).toContain("The list is growing");
  });

  test("observations are facts the reader could verify", () => {
    const review = buildWeeklyReview({
      ...base,
      completedCount: 3,
      dueCount: 12,
    });

    // 25% — the number appears in the sentence.
    expect(review.observations.join(" ")).toContain("25%");
  });

  test("a quiet week says so rather than inventing insight", () => {
    const review = buildWeeklyReview({
      ...base,
      completedCount: 7,
      createdCount: 7,
      dueCount: 10,
      habitScheduled: 7,
      habitCompleted: 5,
    });

    expect(review.observations).toHaveLength(1);
    expect(review.observations[0]).toContain("steady week");
  });

  test("a week with no activity has no busiest day", () => {
    const review = buildWeeklyReview({ ...base, minutesPerDay: {} });

    expect(review.busiestDayKey).toBeNull();
  });
});
