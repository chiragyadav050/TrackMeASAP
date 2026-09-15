import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import { toDateOnly } from "@/services/academics/academic.dates";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  setGoalMilestoneDone,
  setGoalProgress,
  setGoalStatus,
} from "@/services/life/goal.service";
import {
  clearHabitLog,
  createHabit,
  logHabit,
  toggleHabitToday,
} from "@/services/life/habit.service";
import {
  getGoalDetail,
  listGoals,
  listHabits,
} from "@/services/life/habit.query";
import { getLifeOverview } from "@/services/life/life.query";
import {
  createImportantDate,
  createMoneyCategory,
  createMoneyEntry,
  createSubscription,
  deleteMoneyCategory,
  recordSubscriptionCharge,
  saveDailyCheckIn,
} from "@/services/life/money.service";
import {
  getCheckIn,
  getMoneySummary,
  listImportantDates,
  listSubscriptions,
} from "@/services/life/money.query";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Goals, habits and money against a real database.
 *
 * The arithmetic itself is unit-tested in `habit-derive.test.ts`; what these
 * prove is that the query layer feeds those functions the right calendar and
 * the right rows — which is where a streak silently goes wrong.
 */

let profile: Profile;

/** 2026-09-15, 10:00 in Kolkata (a Tuesday). */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);
const TODAY = "2026-09-15";

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const makeHabit = (overrides: Record<string, unknown> = {}) =>
  createHabit(profile.id, profile.timeZone, {
    name: "[TEST] Meditate",
    kind: "BUILD",
    cadence: "DAILY",
    targetPerPeriod: 1,
    weekdays: [],
    startDate: "2026-09-01",
    ...overrides,
  } as never);

const makeGoal = (overrides: Record<string, unknown> = {}) =>
  createGoal(profile.id, {
    title: "[TEST] Read 12 books",
    category: "PERSONAL",
    timeframe: "YEAR",
    ...overrides,
  } as never);

describe("habits", () => {
  test("a new habit has no streak and no rate data yet", async () => {
    await makeHabit({ startDate: TODAY });

    const [habit] = await listHabits(profile, {}, NOW);

    expect(habit?.currentStreak).toBe(0);
    expect(habit?.todayStatus).toBeNull();
    expect(habit?.isDueToday).toBe(true);
    // Today is scheduled but unanswered, so the rate is 0% of 1 — not null.
    expect(habit?.completionRate30).toBe(0);
  });

  test("logging consecutive days builds a streak", async () => {
    const habit = await makeHabit();

    for (const day of ["2026-09-13", "2026-09-14", "2026-09-15"]) {
      await logHabit(profile.id, {
        habitId: habit.id,
        logDate: day,
        isCompleted: true,
      } as never);
    }

    const [loaded] = await listHabits(profile, {}, NOW);

    expect(loaded?.currentStreak).toBe(3);
    expect(loaded?.longestStreak).toBe(3);
    expect(loaded?.todayStatus).toBe("DONE");
  });

  test("re-logging the same day corrects it rather than duplicating", async () => {
    const habit = await makeHabit();

    await logHabit(profile.id, {
      habitId: habit.id,
      logDate: TODAY,
      isCompleted: true,
    } as never);

    await logHabit(profile.id, {
      habitId: habit.id,
      logDate: TODAY,
      isCompleted: false,
    } as never);

    expect(await db.habitLog.count({ where: { habitId: habit.id } })).toBe(1);

    const [loaded] = await listHabits(profile, {}, NOW);
    expect(loaded?.todayStatus).toBe("MISSED");
  });

  test("clearing a log returns the day to unanswered", async () => {
    const habit = await makeHabit();

    await logHabit(profile.id, {
      habitId: habit.id,
      logDate: TODAY,
      isCompleted: false,
    } as never);

    await clearHabitLog(profile.id, habit.id, TODAY);

    const [loaded] = await listHabits(profile, {}, NOW);

    // Not the same as a miss — the user simply has not answered.
    expect(loaded?.todayStatus).toBeNull();
  });

  test("the toggle marks done, then clears — never writes a miss", async () => {
    const habit = await makeHabit();

    // A double-tap must not record a failure the user did not mean.
    expect(
      (await toggleHabitToday(profile.id, habit.id, TODAY)).isCompleted,
    ).toBe(true);
    expect(
      (await toggleHabitToday(profile.id, habit.id, TODAY)).isCompleted,
    ).toBe(false);

    expect(await db.habitLog.count({ where: { habitId: habit.id } })).toBe(0);
  });

  test("a weekday-only habit is not due at the weekend", async () => {
    const habit = await makeHabit({
      cadence: "SPECIFIC_DAYS",
      weekdays: [1, 2, 3, 4, 5],
    });

    const saturday = instantFromLocalTime(2026, 9, 12, 10 * 60, TEST_TIME_ZONE);

    const [weekday] = await listHabits(profile, {}, NOW);
    const [weekend] = await listHabits(profile, {}, saturday);

    expect(weekday?.isDueToday).toBe(true);
    expect(weekend?.isDueToday).toBe(false);
    expect(habit.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  test("weekday lists are de-duplicated and sorted", async () => {
    const habit = await makeHabit({
      cadence: "SPECIFIC_DAYS",
      weekdays: [5, 1, 5, 3],
    });

    expect(habit.weekdays).toEqual([1, 3, 5]);
  });

  test("a DAILY habit never keeps stray weekdays", async () => {
    const habit = await makeHabit({ cadence: "DAILY", weekdays: [1, 2] });

    expect(habit.weekdays).toEqual([]);
  });

  test("a QUIT habit counts days clean from the last relapse", async () => {
    const habit = await makeHabit({
      name: "[TEST] No smoking",
      kind: "QUIT",
      startDate: "2026-09-01",
    });

    let [loaded] = await listHabits(profile, {}, NOW);
    // Silence is clean — not smoking requires no action.
    expect(loaded?.daysClean).toBe(14);

    await logHabit(profile.id, {
      habitId: habit.id,
      logDate: "2026-09-10",
      isCompleted: false,
    } as never);

    [loaded] = await listHabits(profile, {}, NOW);
    expect(loaded?.daysClean).toBe(5);
  });

  test("the recent strip covers seven days and marks today", async () => {
    await makeHabit();

    const [loaded] = await listHabits(profile, {}, NOW);

    expect(loaded?.recentDays).toHaveLength(7);
    expect(loaded?.recentDays.at(-1)?.dateKey).toBe(TODAY);
    expect(loaded?.recentDays.at(-1)?.isToday).toBe(true);
  });

  test("days before the habit started are not scheduled", async () => {
    await makeHabit({ startDate: "2026-09-14" });

    const [loaded] = await listHabits(profile, {}, NOW);
    const before = loaded?.recentDays.find((d) => d.dateKey === "2026-09-12");

    expect(before?.isScheduled).toBe(false);
  });

  test("archived habits drop out of the default listing", async () => {
    const habit = await makeHabit();

    await db.habit.update({
      where: { id: habit.id },
      data: { archivedAt: new Date() },
    });

    expect(await listHabits(profile, {}, NOW)).toHaveLength(0);
    expect(
      await listHabits(profile, { includeArchived: true }, NOW),
    ).toHaveLength(1);
  });
});

describe("goals", () => {
  test("a measured goal tracks its numbers", async () => {
    const goal = await makeGoal({ targetValue: 12, unit: "books" });

    let [loaded] = await listGoals(profile, {}, NOW);
    expect(loaded?.progressPercent).toBe(0);
    expect(loaded?.isMeasured).toBe(true);

    await setGoalProgress(profile.id, goal.id, 3);

    [loaded] = await listGoals(profile, {}, NOW);
    expect(loaded?.progressPercent).toBe(25);
  });

  test("hitting the target marks the goal achieved", async () => {
    const goal = await makeGoal({ targetValue: 5 });

    await setGoalProgress(profile.id, goal.id, 5);

    const reloaded = await db.goal.findUnique({ where: { id: goal.id } });
    expect(reloaded?.status).toBe("ACHIEVED");
    expect(reloaded?.achievedAt).not.toBeNull();
  });

  test("dropping below the target does not un-achieve a goal", async () => {
    const goal = await makeGoal({ targetValue: 5 });

    await setGoalProgress(profile.id, goal.id, 5);
    await setGoalProgress(profile.id, goal.id, 2);

    // The user declared it met; a later correction to the count does not
    // overrule that.
    const reloaded = await db.goal.findUnique({ where: { id: goal.id } });
    expect(reloaded?.status).toBe("ACHIEVED");
  });

  test("an unmeasured goal falls back to milestones", async () => {
    const goal = await makeGoal();

    const first = await createGoalMilestone(profile.id, {
      goalId: goal.id,
      title: "[TEST] First",
    } as never);
    await createGoalMilestone(profile.id, {
      goalId: goal.id,
      title: "[TEST] Second",
    } as never);

    let [loaded] = await listGoals(profile, {}, NOW);
    expect(loaded?.progressPercent).toBe(0);
    expect(loaded?.isMeasured).toBe(false);

    await setGoalMilestoneDone(profile.id, first.id, true);

    [loaded] = await listGoals(profile, {}, NOW);
    expect(loaded?.progressPercent).toBe(50);
    expect(loaded?.milestonesCompleted).toBe(1);
  });

  test("a goal with neither measure nor milestones reports null, not zero", async () => {
    await makeGoal();

    const [loaded] = await listGoals(profile, {}, NOW);

    // An intention with no way to tell whether it is being met.
    expect(loaded?.progressPercent).toBeNull();
  });

  test("achieving a goal reads 100 regardless of the numbers", async () => {
    const goal = await makeGoal({ targetValue: 100 });

    await setGoalStatus(profile.id, goal.id, "ACHIEVED");

    const [loaded] = await listGoals(profile, {}, NOW);
    expect(loaded?.progressPercent).toBe(100);
  });

  test("deleting a goal keeps its habits and tasks, merely unlinked", async () => {
    const goal = await makeGoal();
    const habit = await makeHabit({ goalId: goal.id });

    const task = await db.task.create({
      data: {
        profileId: profile.id,
        title: "[TEST] Goal task",
        position: 0,
        goalId: goal.id,
      },
    });

    await deleteGoal(profile.id, goal.id);

    const reloadedHabit = await db.habit.findUnique({
      where: { id: habit.id },
    });
    const reloadedTask = await db.task.findUnique({ where: { id: task.id } });

    expect(reloadedHabit).not.toBeNull();
    expect(reloadedHabit?.goalId).toBeNull();
    expect(reloadedTask).not.toBeNull();
    expect(reloadedTask?.goalId).toBeNull();
  });

  test("the detail view carries milestones and linked habits", async () => {
    const goal = await makeGoal();
    await makeHabit({ goalId: goal.id });
    await createGoalMilestone(profile.id, {
      goalId: goal.id,
      title: "[TEST] Checkpoint",
      dueDate: "2026-09-01",
    } as never);

    const detail = await getGoalDetail(profile, goal.id, NOW);

    expect(detail?.milestones[0]?.isOverdue).toBe(true);
    expect(detail?.habits).toHaveLength(1);
  });
});

describe("daily check-in", () => {
  test("a check-in with only a mood is a real check-in", async () => {
    await saveDailyCheckIn(profile.id, {
      checkInDate: TODAY,
      mood: "GOOD",
    } as never);

    const loaded = await getCheckIn(profile, TODAY);

    expect(loaded?.mood).toBe("GOOD");
    expect(loaded?.hasAnyAnswer).toBe(true);
    expect(loaded?.energy).toBeNull();
  });

  test("saving twice updates the day rather than adding a row", async () => {
    await saveDailyCheckIn(profile.id, {
      checkInDate: TODAY,
      mood: "LOW",
    } as never);

    await saveDailyCheckIn(profile.id, {
      checkInDate: TODAY,
      mood: "GREAT",
      sleepMinutes: 450,
    } as never);

    expect(
      await db.dailyCheckIn.count({ where: { profileId: profile.id } }),
    ).toBe(1);

    const loaded = await getCheckIn(profile, TODAY);
    expect(loaded?.mood).toBe("GREAT");
    expect(loaded?.sleepLabel).toBe("7h 30m");
  });

  test("a day with no check-in returns null, not an empty shell", async () => {
    expect(await getCheckIn(profile, TODAY)).toBeNull();
  });
});

describe("money", () => {
  const addEntry = (overrides: Record<string, unknown> = {}) =>
    createMoneyEntry(profile.id, {
      direction: "EXPENSE",
      amount: "249.50",
      currency: "INR",
      description: "[TEST] Lunch",
      entryDate: TODAY,
      ...overrides,
    } as never);

  test("amounts are stored as exact integer minor units", async () => {
    const entry = await addEntry({ amount: "19.99" });

    expect(entry.amountMinor).toBe(1999);
  });

  test("a month of repeated amounts sums without drift", async () => {
    for (let index = 0; index < 10; index += 1) {
      await addEntry({ amount: "0.10", description: `[TEST] Item ${index}` });
    }

    const summary = await getMoneySummary(profile, "2026-09", NOW);

    // The whole reason amounts are integers: ten float 0.1s sum to
    // 0.9999999999999999.
    expect(summary.expenseMinor).toBe(100);
  });

  test("the summary separates income from expense and nets them", async () => {
    await addEntry({ amount: "1000", direction: "EXPENSE" });
    await addEntry({
      amount: "2500",
      direction: "INCOME",
      description: "[TEST] Stipend",
    });

    const summary = await getMoneySummary(profile, "2026-09", NOW);

    expect(summary.expenseMinor).toBe(100000);
    expect(summary.incomeMinor).toBe(250000);
    expect(summary.netMinor).toBe(150000);
    expect(summary.entryCount).toBe(2);
  });

  test("entries from another month are excluded", async () => {
    await addEntry({ entryDate: "2026-08-31", amount: "500" });
    await addEntry({ entryDate: "2026-09-01", amount: "300" });

    const summary = await getMoneySummary(profile, "2026-09", NOW);

    expect(summary.expenseMinor).toBe(30000);
  });

  test("budget status bands a category and survives having no budget", async () => {
    const budgeted = await createMoneyCategory(profile.id, {
      name: "[TEST] Food",
      direction: "EXPENSE",
      monthlyBudget: "1000",
    } as never);

    await createMoneyCategory(profile.id, {
      name: "[TEST] Misc",
      direction: "EXPENSE",
    } as never);

    await addEntry({ amount: "900", categoryId: budgeted.id });

    const summary = await getMoneySummary(profile, "2026-09", NOW);
    const food = summary.categories.find((c) => c.name === "[TEST] Food");
    const misc = summary.categories.find((c) => c.name === "[TEST] Misc");

    expect(food?.budgetStatus).toBe("NEAR");
    expect(food?.spentMinor).toBe(90000);
    // No budget is UNTRACKED, not "0% used" — which would mean a limit of 0.
    expect(misc?.budgetStatus).toBe("UNTRACKED");
    expect(misc?.usedPercent).toBeNull();
  });

  test("deleting a category keeps the entries that used it", async () => {
    const category = await createMoneyCategory(profile.id, {
      name: "[TEST] Food",
      direction: "EXPENSE",
    } as never);

    const entry = await addEntry({ categoryId: category.id });

    await deleteMoneyCategory(profile.id, category.id);

    const reloaded = await db.moneyEntry.findUnique({
      where: { id: entry.id },
    });

    // The money really did leave the account; only the bucket is gone.
    expect(reloaded).not.toBeNull();
    expect(reloaded?.categoryId).toBeNull();
  });
});

describe("subscriptions", () => {
  const makeSubscription = (overrides: Record<string, unknown> = {}) =>
    createSubscription(profile.id, {
      name: "[TEST] Music",
      amount: "119",
      currency: "INR",
      cycle: "MONTHLY",
      nextChargeDate: "2026-09-18",
      ...overrides,
    } as never);

  test("recording a charge writes an expense and advances the date", async () => {
    const subscription = await makeSubscription();

    const result = await recordSubscriptionCharge(profile.id, {
      subscriptionId: subscription.id,
    } as never);

    const entry = await db.moneyEntry.findUnique({
      where: { id: result.entryId },
    });

    expect(entry?.amountMinor).toBe(11900);
    expect(entry?.direction).toBe("EXPENSE");
    expect(entry?.subscriptionId).toBe(subscription.id);

    // Monthly means the same date next month, not +30 days.
    expect(result.nextChargeDate).toEqual(toDateOnly("2026-10-18"));
  });

  test("the same charge cannot be recorded twice", async () => {
    const subscription = await makeSubscription();

    await recordSubscriptionCharge(profile.id, {
      subscriptionId: subscription.id,
      chargedOn: "2026-09-18",
    } as never);

    await expect(
      recordSubscriptionCharge(profile.id, {
        subscriptionId: subscription.id,
        chargedOn: "2026-09-18",
      } as never),
    ).rejects.toThrow();

    expect(
      await db.moneyEntry.count({
        where: { subscriptionId: subscription.id },
      }),
    ).toBe(1);
  });

  test("monthly-equivalent cost normalises every cycle", async () => {
    await makeSubscription({ cycle: "YEARLY", amount: "1200" });

    const [loaded] = await listSubscriptions(profile, false, NOW);

    expect(loaded?.monthlyEquivalentLabel).toContain("100");
  });

  test("a charge inside the week is flagged due soon", async () => {
    await makeSubscription({ nextChargeDate: "2026-09-18" });
    await makeSubscription({
      name: "[TEST] Far",
      nextChargeDate: "2026-11-01",
    });

    const subscriptions = await listSubscriptions(profile, false, NOW);
    const soon = subscriptions.filter((s) => s.isDueSoon);

    expect(soon).toHaveLength(1);
    expect(soon[0]?.daysUntilCharge).toBe(3);
  });
});

describe("important dates", () => {
  test("a recurring date rolls to this year and carries the age", async () => {
    await createImportantDate(profile.id, {
      title: "[TEST] Birthday",
      kind: "BIRTHDAY",
      eventDate: "2005-11-20",
      isRecurring: true,
      remindDaysBefore: 7,
    } as never);

    const [loaded] = await listImportantDates(profile, NOW);

    expect(loaded?.nextOccurrenceLabel).toContain("2026");
    expect(loaded?.yearsAtNextOccurrence).toBe(21);
  });

  test("a date already past this year rolls to next year", async () => {
    await createImportantDate(profile.id, {
      title: "[TEST] Anniversary",
      kind: "ANNIVERSARY",
      eventDate: "2020-03-01",
      isRecurring: true,
      remindDaysBefore: 7,
    } as never);

    const [loaded] = await listImportantDates(profile, NOW);

    expect(loaded?.nextOccurrenceLabel).toContain("2027");
    expect(loaded?.daysUntil).toBeGreaterThan(0);
  });

  test("the reminder window is honoured", async () => {
    await createImportantDate(profile.id, {
      title: "[TEST] Soon",
      eventDate: "2020-09-18",
      isRecurring: true,
      remindDaysBefore: 7,
    } as never);

    await createImportantDate(profile.id, {
      title: "[TEST] Later",
      eventDate: "2020-09-18",
      isRecurring: true,
      remindDaysBefore: 1,
    } as never);

    const dates = await listImportantDates(profile, NOW);

    expect(
      dates.find((d) => d.title === "[TEST] Soon")?.isWithinReminderWindow,
    ).toBe(true);
    expect(
      dates.find((d) => d.title === "[TEST] Later")?.isWithinReminderWindow,
    ).toBe(false);
  });

  test("a non-recurring date keeps its original date", async () => {
    await createImportantDate(profile.id, {
      title: "[TEST] One off",
      eventDate: "2026-12-01",
      isRecurring: false,
      remindDaysBefore: 7,
    } as never);

    const [loaded] = await listImportantDates(profile, NOW);

    expect(loaded?.yearsAtNextOccurrence).toBeNull();
    expect(loaded?.nextOccurrenceLabel).toContain("2026");
  });
});

describe("life overview", () => {
  test("is empty but not broken for a new profile", async () => {
    const view = await getLifeOverview(profile, NOW);

    expect(view.goals).toHaveLength(0);
    expect(view.habits.dueTodayCount).toBe(0);
    expect(view.checkIn).toBeNull();
    expect(view.money.expenseMinor).toBe(0);
    expect(view.upcomingDates).toHaveLength(0);
  });

  test("assembles every slice for a profile that uses them", async () => {
    const habit = await makeHabit();
    await toggleHabitToday(profile.id, habit.id, TODAY);
    await makeGoal({ targetValue: 10 });
    await saveDailyCheckIn(profile.id, {
      checkInDate: TODAY,
      mood: "GOOD",
    } as never);
    await createMoneyEntry(profile.id, {
      direction: "EXPENSE",
      amount: "100",
      currency: "INR",
      description: "[TEST] Coffee",
      entryDate: TODAY,
    } as never);

    const view = await getLifeOverview(profile, NOW);

    expect(view.habits.dueTodayCount).toBe(1);
    expect(view.habits.doneTodayCount).toBe(1);
    expect(view.activeGoalCount).toBe(1);
    expect(view.checkIn?.mood).toBe("GOOD");
    expect(view.money.expenseMinor).toBe(10000);
  });
});
