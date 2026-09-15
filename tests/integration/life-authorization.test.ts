import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type {
  Goal,
  GoalMilestone,
  Habit,
  ImportantDate,
  MoneyCategory,
  MoneyEntry,
  Profile,
  Subscription,
} from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { db } from "@/server/db";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  deleteGoalMilestone,
  requireOwnedGoal,
  requireOwnedGoalMilestone,
  setGoalArchived,
  setGoalMilestoneDone,
  setGoalProgress,
  setGoalStatus,
  updateGoal,
} from "@/services/life/goal.service";
import {
  clearHabitLog,
  createHabit,
  deleteHabit,
  logHabit,
  requireOwnedHabit,
  setHabitArchived,
  toggleHabitToday,
  updateHabit,
} from "@/services/life/habit.service";
import {
  getGoalDetail,
  listGoals,
  listHabits,
  searchLife,
} from "@/services/life/habit.query";
import {
  createImportantDate,
  createMoneyCategory,
  createMoneyEntry,
  createSubscription,
  deleteImportantDate,
  deleteMoneyCategory,
  deleteMoneyEntry,
  deleteSubscription,
  recordSubscriptionCharge,
  requireOwnedCategory,
  requireOwnedEntry,
  requireOwnedImportantDate,
  requireOwnedSubscription,
  setSubscriptionCancelled,
  updateImportantDate,
  updateMoneyCategory,
  updateMoneyEntry,
  updateSubscription,
} from "@/services/life/money.service";
import {
  getCheckIn,
  getMoneySummary,
  listImportantDates,
  listSubscriptions,
} from "@/services/life/money.query";
import { saveDailyCheckIn } from "@/services/life/money.service";
import { cleanupTestData, createTestProfile, disconnect } from "./helpers";

/**
 * Cross-user isolation for Phase 5.
 *
 * Owner creates everything; intruder — a real second profile in the same
 * database — attacks with VALID ids. Every refusal must be NOT_FOUND, never
 * FORBIDDEN: "forbidden" confirms the id exists and turns a guessed id into
 * an existence oracle.
 */

let owner: Profile;
let intruder: Profile;
let goal: Goal;
let milestone: GoalMilestone;
let habit: Habit;
let category: MoneyCategory;
let entry: MoneyEntry;
let subscription: Subscription;
let importantDate: ImportantDate;

const TODAY = "2026-09-15";

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
  );
}

beforeEach(async () => {
  await cleanupTestData();

  owner = await createTestProfile();
  intruder = await createTestProfile();

  goal = await createGoal(owner.id, {
    title: "[TEST] Owner goal",
    category: "PERSONAL",
    timeframe: "MONTH",
    targetValue: 10,
  } as never);

  milestone = await createGoalMilestone(owner.id, {
    goalId: goal.id,
    title: "[TEST] Owner milestone",
  } as never);

  habit = await createHabit(owner.id, owner.timeZone, {
    name: "[TEST] Owner habit",
    kind: "BUILD",
    cadence: "DAILY",
    targetPerPeriod: 1,
    weekdays: [],
    startDate: "2026-09-01",
  } as never);

  category = await createMoneyCategory(owner.id, {
    name: "[TEST] Owner category",
    direction: "EXPENSE",
    monthlyBudget: "5000",
  } as never);

  entry = await createMoneyEntry(owner.id, {
    direction: "EXPENSE",
    amount: "250",
    currency: "INR",
    description: "[TEST] Owner spend",
    entryDate: TODAY,
    categoryId: category.id,
  } as never);

  subscription = await createSubscription(owner.id, {
    name: "[TEST] Owner subscription",
    amount: "199",
    currency: "INR",
    cycle: "MONTHLY",
    nextChargeDate: "2026-09-20",
  } as never);

  importantDate = await createImportantDate(owner.id, {
    title: "[TEST] Owner date",
    kind: "BIRTHDAY",
    eventDate: "2005-11-20",
    isRecurring: true,
    remindDaysBefore: 7,
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("ownership guards", () => {
  test("every guard reports NOT_FOUND for another user's record", async () => {
    await expectNotFound(requireOwnedGoal(intruder.id, goal.id));
    await expectNotFound(requireOwnedGoalMilestone(intruder.id, milestone.id));
    await expectNotFound(requireOwnedHabit(intruder.id, habit.id));
    await expectNotFound(requireOwnedCategory(intruder.id, category.id));
    await expectNotFound(requireOwnedEntry(intruder.id, entry.id));
    await expectNotFound(
      requireOwnedSubscription(intruder.id, subscription.id),
    );
    await expectNotFound(
      requireOwnedImportantDate(intruder.id, importantDate.id),
    );
  });
});

describe("reads are scoped to the caller", () => {
  test("another user's goals and habits are invisible", async () => {
    expect(await listGoals(intruder)).toHaveLength(0);
    expect(await listHabits(intruder)).toHaveLength(0);
    expect(await getGoalDetail(intruder, goal.id)).toBeNull();
  });

  test("another user's money is invisible and does not pollute totals", async () => {
    const summary = await getMoneySummary(intruder, "2026-09");

    expect(summary.expenseMinor).toBe(0);
    expect(summary.categories).toHaveLength(0);
    expect(await listSubscriptions(intruder)).toHaveLength(0);
    expect(await listImportantDates(intruder)).toHaveLength(0);
  });

  test("another user's check-in is invisible", async () => {
    await saveDailyCheckIn(owner.id, {
      checkInDate: TODAY,
      mood: "GREAT",
    } as never);

    expect(await getCheckIn(intruder, TODAY)).toBeNull();
    expect((await getCheckIn(owner, TODAY))?.mood).toBe("GREAT");
  });

  test("search never leaks another user's goals or habits", async () => {
    expect(await searchLife(intruder, "Owner")).toHaveLength(0);
    expect((await searchLife(owner, "Owner")).length).toBeGreaterThan(0);
  });
});

describe("writes are rejected", () => {
  test("goal mutations", async () => {
    await expectNotFound(
      updateGoal(intruder.id, {
        goalId: goal.id,
        title: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(setGoalStatus(intruder.id, goal.id, "ABANDONED"));
    await expectNotFound(setGoalProgress(intruder.id, goal.id, 99));
    await expectNotFound(setGoalArchived(intruder.id, goal.id, true));
    await expectNotFound(deleteGoal(intruder.id, goal.id));

    const untouched = await db.goal.findUnique({ where: { id: goal.id } });
    expect(untouched?.title).toBe("[TEST] Owner goal");
    expect(untouched?.currentValue).toBe(0);
    expect(untouched?.status).toBe("ACTIVE");
  });

  test("goal milestone mutations", async () => {
    await expectNotFound(setGoalMilestoneDone(intruder.id, milestone.id, true));
    await expectNotFound(deleteGoalMilestone(intruder.id, milestone.id));

    const untouched = await db.goalMilestone.findUnique({
      where: { id: milestone.id },
    });
    expect(untouched?.completedAt).toBeNull();
  });

  test("habit mutations", async () => {
    await expectNotFound(
      updateHabit(intruder.id, {
        habitId: habit.id,
        name: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(setHabitArchived(intruder.id, habit.id, true));
    await expectNotFound(deleteHabit(intruder.id, habit.id));

    const untouched = await db.habit.findUnique({ where: { id: habit.id } });
    expect(untouched?.name).toBe("[TEST] Owner habit");
    expect(untouched?.archivedAt).toBeNull();
  });

  test("habit LOGGING is rejected — a streak cannot be forged", async () => {
    await expectNotFound(
      logHabit(intruder.id, {
        habitId: habit.id,
        logDate: TODAY,
        isCompleted: true,
      } as never),
    );
    await expectNotFound(toggleHabitToday(intruder.id, habit.id, TODAY));
    await expectNotFound(clearHabitLog(intruder.id, habit.id, TODAY));

    expect(await db.habitLog.count({ where: { habitId: habit.id } })).toBe(0);
  });

  test("money mutations", async () => {
    await expectNotFound(
      updateMoneyCategory(intruder.id, {
        categoryId: category.id,
        name: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(deleteMoneyCategory(intruder.id, category.id));
    await expectNotFound(
      updateMoneyEntry(intruder.id, {
        entryId: entry.id,
        amount: "1",
      } as never),
    );
    await expectNotFound(deleteMoneyEntry(intruder.id, entry.id));

    const untouchedEntry = await db.moneyEntry.findUnique({
      where: { id: entry.id },
    });
    expect(untouchedEntry?.amountMinor).toBe(25000);
  });

  test("subscription mutations", async () => {
    await expectNotFound(
      updateSubscription(intruder.id, {
        subscriptionId: subscription.id,
        amount: "1",
      } as never),
    );
    await expectNotFound(
      setSubscriptionCancelled(intruder.id, subscription.id, true),
    );
    await expectNotFound(
      recordSubscriptionCharge(intruder.id, {
        subscriptionId: subscription.id,
      } as never),
    );
    await expectNotFound(deleteSubscription(intruder.id, subscription.id));

    const untouched = await db.subscription.findUnique({
      where: { id: subscription.id },
    });
    expect(untouched?.amountMinor).toBe(19900);
    expect(untouched?.cancelledAt).toBeNull();
    // No expense may have been written into the owner's books.
    expect(
      await db.moneyEntry.count({ where: { subscriptionId: subscription.id } }),
    ).toBe(0);
  });

  test("important date mutations", async () => {
    await expectNotFound(
      updateImportantDate(intruder.id, {
        importantDateId: importantDate.id,
        title: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(deleteImportantDate(intruder.id, importantDate.id));

    const untouched = await db.importantDate.findUnique({
      where: { id: importantDate.id },
    });
    expect(untouched?.title).toBe("[TEST] Owner date");
  });
});

describe("cross-owner grafting", () => {
  test("a habit cannot be attached to another user's goal", async () => {
    await expectNotFound(
      createHabit(intruder.id, intruder.timeZone, {
        name: "[TEST] Smuggled",
        kind: "BUILD",
        cadence: "DAILY",
        targetPerPeriod: 1,
        weekdays: [],
        goalId: goal.id,
      } as never),
    );

    expect(await db.habit.count({ where: { goalId: goal.id } })).toBe(0);
  });

  test("their OWN habit cannot be moved onto another user's goal", async () => {
    const theirHabit = await createHabit(intruder.id, intruder.timeZone, {
      name: "[TEST] Intruder habit",
      kind: "BUILD",
      cadence: "DAILY",
      targetPerPeriod: 1,
      weekdays: [],
    } as never);

    await expectNotFound(
      updateHabit(intruder.id, {
        habitId: theirHabit.id,
        goalId: goal.id,
      } as never),
    );
  });

  test("a milestone cannot be added to another user's goal", async () => {
    await expectNotFound(
      createGoalMilestone(intruder.id, {
        goalId: goal.id,
        title: "[TEST] Smuggled",
      } as never),
    );

    expect(await db.goalMilestone.count({ where: { goalId: goal.id } })).toBe(
      1,
    );
  });

  test("an entry cannot be filed under another user's category", async () => {
    await expectNotFound(
      createMoneyEntry(intruder.id, {
        direction: "EXPENSE",
        amount: "10",
        currency: "INR",
        description: "[TEST] Smuggled",
        entryDate: TODAY,
        categoryId: category.id,
      } as never),
    );

    expect(
      await db.moneyEntry.count({ where: { categoryId: category.id } }),
    ).toBe(1);
  });

  test("a subscription charge cannot be filed under another user's category", async () => {
    const theirSubscription = await createSubscription(intruder.id, {
      name: "[TEST] Intruder subscription",
      amount: "99",
      currency: "INR",
      cycle: "MONTHLY",
      nextChargeDate: "2026-09-20",
    } as never);

    await expectNotFound(
      recordSubscriptionCharge(intruder.id, {
        subscriptionId: theirSubscription.id,
        categoryId: category.id,
      } as never),
    );
  });
});

describe("denormalised ownership stays consistent", () => {
  test("nested records carry the owner's profileId", async () => {
    // The guards read `profileId` off the row itself rather than walking the
    // relation, so the column has to be right or the guard checks nothing.
    expect(milestone.profileId).toBe(owner.id);
    expect(entry.profileId).toBe(owner.id);

    const log = await logHabit(owner.id, {
      habitId: habit.id,
      logDate: TODAY,
      isCompleted: true,
    } as never);

    expect(log.profileId).toBe(owner.id);
  });
});
