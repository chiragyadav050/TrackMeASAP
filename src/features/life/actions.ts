"use server";

import { revalidatePath } from "next/cache";

import { localDateKey } from "@/lib/time";
import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  archiveGoalSchema,
  archiveHabitSchema,
  cancelSubscriptionSchema,
  checkInDateSchema,
  clearHabitLogSchema,
  createGoalMilestoneSchema,
  createGoalSchema,
  createHabitSchema,
  createImportantDateSchema,
  createMoneyCategorySchema,
  createMoneyEntrySchema,
  createSubscriptionSchema,
  dailyCheckInSchema,
  goalIdSchema,
  goalMilestoneIdSchema,
  habitIdSchema,
  importantDateIdSchema,
  logHabitSchema,
  moneyCategoryIdSchema,
  moneyEntryIdSchema,
  recordSubscriptionChargeSchema,
  searchLifeSchema,
  setGoalMilestoneDoneSchema,
  setGoalProgressSchema,
  setGoalStatusSchema,
  subscriptionIdSchema,
  updateGoalSchema,
  updateHabitSchema,
  updateImportantDateSchema,
  updateMoneyCategorySchema,
  updateMoneyEntrySchema,
  updateSubscriptionSchema,
} from "@/services/life/life.schema";
import {
  createGoal,
  createGoalMilestone,
  deleteGoal,
  deleteGoalMilestone,
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
  setHabitArchived,
  toggleHabitToday,
  updateHabit,
} from "@/services/life/habit.service";
import {
  createImportantDate,
  createMoneyCategory,
  createMoneyEntry,
  createSubscription,
  deleteDailyCheckIn,
  deleteImportantDate,
  deleteMoneyCategory,
  deleteMoneyEntry,
  deleteSubscription,
  recordSubscriptionCharge,
  saveDailyCheckIn,
  setSubscriptionCancelled,
  updateImportantDate,
  updateMoneyCategory,
  updateMoneyEntry,
  updateSubscription,
} from "@/services/life/money.service";
import { searchLife } from "@/services/life/habit.query";
import type { LifeSearchResult } from "@/types/life";

/**
 * Life server actions.
 *
 * Same two factories as every earlier phase. Identity comes from the Clerk
 * session — no action accepts a profile id, and none reaches the database
 * except through a service that requires one.
 */

function revalidateLife(): void {
  revalidatePath("/habits", "layout");
  revalidatePath("/goals", "layout");
  revalidatePath("/health");
  revalidatePath("/today");
  revalidatePath("/overview");
}

function revalidateMoney(): void {
  revalidatePath("/finance", "layout");
  revalidatePath("/overview");
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const createGoalAction = createAuthenticatedAction({
  name: "goal.create",
  schema: createGoalSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    const goal = await createGoal(profile.id, input);
    revalidateLife();
    return { goalId: goal.id };
  },
});

export const updateGoalAction = createAuthenticatedAction({
  name: "goal.update",
  schema: updateGoalSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    await updateGoal(profile.id, input);
    revalidateLife();
    return { goalId: input.goalId };
  },
});

export const setGoalStatusCommand = createAuthenticatedCommand({
  name: "goal.setStatus",
  schema: setGoalStatusSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    await setGoalStatus(profile.id, input.goalId, input.status);
    revalidateLife();
    return { goalId: input.goalId };
  },
});

export const setGoalProgressCommand = createAuthenticatedCommand({
  name: "goal.setProgress",
  schema: setGoalProgressSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    await setGoalProgress(profile.id, input.goalId, input.currentValue);
    revalidateLife();
    return { goalId: input.goalId };
  },
});

export const setGoalArchivedCommand = createAuthenticatedCommand({
  name: "goal.setArchived",
  schema: archiveGoalSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    await setGoalArchived(profile.id, input.goalId, input.isArchived);
    revalidateLife();
    return { goalId: input.goalId };
  },
});

export const deleteGoalCommand = createAuthenticatedCommand({
  name: "goal.delete",
  schema: goalIdSchema,
  handler: async (input, { profile }): Promise<{ goalId: string }> => {
    await deleteGoal(profile.id, input.goalId);
    revalidateLife();
    return { goalId: input.goalId };
  },
});

export const createGoalMilestoneCommand = createAuthenticatedCommand({
  name: "goalMilestone.create",
  schema: createGoalMilestoneSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    const milestone = await createGoalMilestone(profile.id, input);
    revalidateLife();
    return { milestoneId: milestone.id };
  },
});

export const setGoalMilestoneDoneCommand = createAuthenticatedCommand({
  name: "goalMilestone.setDone",
  schema: setGoalMilestoneDoneSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    await setGoalMilestoneDone(
      profile.id,
      input.milestoneId,
      input.isCompleted,
    );
    revalidateLife();
    return { milestoneId: input.milestoneId };
  },
});

export const deleteGoalMilestoneCommand = createAuthenticatedCommand({
  name: "goalMilestone.delete",
  schema: goalMilestoneIdSchema,
  handler: async (input, { profile }): Promise<{ milestoneId: string }> => {
    await deleteGoalMilestone(profile.id, input.milestoneId);
    revalidateLife();
    return { milestoneId: input.milestoneId };
  },
});

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

export const createHabitAction = createAuthenticatedAction({
  name: "habit.create",
  schema: createHabitSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    const habit = await createHabit(profile.id, profile.timeZone, input);
    revalidateLife();
    return { habitId: habit.id };
  },
});

export const updateHabitAction = createAuthenticatedAction({
  name: "habit.update",
  schema: updateHabitSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    await updateHabit(profile.id, input);
    revalidateLife();
    return { habitId: input.habitId };
  },
});

/**
 * One-tap check for today.
 *
 * `todayKey` is resolved on the SERVER from the profile's zone rather than
 * accepted from the client — otherwise a user whose laptop is on the wrong
 * zone could silently log yesterday.
 */
export const toggleHabitTodayCommand = createAuthenticatedCommand({
  name: "habit.toggleToday",
  schema: habitIdSchema,
  handler: async (
    input,
    { profile },
  ): Promise<{ habitId: string; isCompleted: boolean }> => {
    const result = await toggleHabitToday(
      profile.id,
      input.habitId,
      localDateKey(new Date(), profile.timeZone),
    );

    revalidateLife();
    return { habitId: input.habitId, ...result };
  },
});

export const logHabitCommand = createAuthenticatedCommand({
  name: "habit.log",
  schema: logHabitSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    await logHabit(profile.id, input);
    revalidateLife();
    return { habitId: input.habitId };
  },
});

export const clearHabitLogCommand = createAuthenticatedCommand({
  name: "habit.clearLog",
  schema: clearHabitLogSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    await clearHabitLog(profile.id, input.habitId, input.logDate);
    revalidateLife();
    return { habitId: input.habitId };
  },
});

export const setHabitArchivedCommand = createAuthenticatedCommand({
  name: "habit.setArchived",
  schema: archiveHabitSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    await setHabitArchived(profile.id, input.habitId, input.isArchived);
    revalidateLife();
    return { habitId: input.habitId };
  },
});

export const deleteHabitCommand = createAuthenticatedCommand({
  name: "habit.delete",
  schema: habitIdSchema,
  handler: async (input, { profile }): Promise<{ habitId: string }> => {
    await deleteHabit(profile.id, input.habitId);
    revalidateLife();
    return { habitId: input.habitId };
  },
});

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

export const saveCheckInAction = createAuthenticatedAction({
  name: "checkIn.save",
  schema: dailyCheckInSchema,
  handler: async (input, { profile }): Promise<{ checkInDate: string }> => {
    await saveDailyCheckIn(profile.id, input);
    revalidateLife();
    return { checkInDate: input.checkInDate };
  },
});

export const saveCheckInCommand = createAuthenticatedCommand({
  name: "checkIn.save",
  schema: dailyCheckInSchema,
  handler: async (input, { profile }): Promise<{ checkInDate: string }> => {
    await saveDailyCheckIn(profile.id, input);
    revalidateLife();
    return { checkInDate: input.checkInDate };
  },
});

export const deleteCheckInCommand = createAuthenticatedCommand({
  name: "checkIn.delete",
  schema: checkInDateSchema,
  handler: async (input, { profile }): Promise<{ checkInDate: string }> => {
    await deleteDailyCheckIn(profile.id, input.checkInDate);
    revalidateLife();
    return { checkInDate: input.checkInDate };
  },
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const createMoneyCategoryAction = createAuthenticatedAction({
  name: "moneyCategory.create",
  schema: createMoneyCategorySchema,
  handler: async (input, { profile }): Promise<{ categoryId: string }> => {
    const category = await createMoneyCategory(profile.id, input);
    revalidateMoney();
    return { categoryId: category.id };
  },
});

export const updateMoneyCategoryAction = createAuthenticatedAction({
  name: "moneyCategory.update",
  schema: updateMoneyCategorySchema,
  handler: async (input, { profile }): Promise<{ categoryId: string }> => {
    await updateMoneyCategory(profile.id, input);
    revalidateMoney();
    return { categoryId: input.categoryId };
  },
});

export const deleteMoneyCategoryCommand = createAuthenticatedCommand({
  name: "moneyCategory.delete",
  schema: moneyCategoryIdSchema,
  handler: async (input, { profile }): Promise<{ categoryId: string }> => {
    await deleteMoneyCategory(profile.id, input.categoryId);
    revalidateMoney();
    return { categoryId: input.categoryId };
  },
});

export const createMoneyEntryAction = createAuthenticatedAction({
  name: "moneyEntry.create",
  schema: createMoneyEntrySchema,
  handler: async (input, { profile }): Promise<{ entryId: string }> => {
    const entry = await createMoneyEntry(profile.id, input);
    revalidateMoney();
    return { entryId: entry.id };
  },
});

export const updateMoneyEntryAction = createAuthenticatedAction({
  name: "moneyEntry.update",
  schema: updateMoneyEntrySchema,
  handler: async (input, { profile }): Promise<{ entryId: string }> => {
    await updateMoneyEntry(profile.id, input);
    revalidateMoney();
    return { entryId: input.entryId };
  },
});

export const deleteMoneyEntryCommand = createAuthenticatedCommand({
  name: "moneyEntry.delete",
  schema: moneyEntryIdSchema,
  handler: async (input, { profile }): Promise<{ entryId: string }> => {
    await deleteMoneyEntry(profile.id, input.entryId);
    revalidateMoney();
    return { entryId: input.entryId };
  },
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const createSubscriptionAction = createAuthenticatedAction({
  name: "subscription.create",
  schema: createSubscriptionSchema,
  handler: async (input, { profile }): Promise<{ subscriptionId: string }> => {
    const subscription = await createSubscription(profile.id, input);
    revalidateMoney();
    return { subscriptionId: subscription.id };
  },
});

export const updateSubscriptionAction = createAuthenticatedAction({
  name: "subscription.update",
  schema: updateSubscriptionSchema,
  handler: async (input, { profile }): Promise<{ subscriptionId: string }> => {
    await updateSubscription(profile.id, input);
    revalidateMoney();
    return { subscriptionId: input.subscriptionId };
  },
});

export const setSubscriptionCancelledCommand = createAuthenticatedCommand({
  name: "subscription.setCancelled",
  schema: cancelSubscriptionSchema,
  handler: async (input, { profile }): Promise<{ subscriptionId: string }> => {
    await setSubscriptionCancelled(
      profile.id,
      input.subscriptionId,
      input.isCancelled,
    );
    revalidateMoney();
    return { subscriptionId: input.subscriptionId };
  },
});

export const deleteSubscriptionCommand = createAuthenticatedCommand({
  name: "subscription.delete",
  schema: subscriptionIdSchema,
  handler: async (input, { profile }): Promise<{ subscriptionId: string }> => {
    await deleteSubscription(profile.id, input.subscriptionId);
    revalidateMoney();
    return { subscriptionId: input.subscriptionId };
  },
});

/**
 * Records a charge and advances the next date.
 *
 * Never happens automatically on read: writing an expense as a side effect of
 * loading a page would double-count on every refresh.
 */
export const recordSubscriptionChargeCommand = createAuthenticatedCommand({
  name: "subscription.recordCharge",
  schema: recordSubscriptionChargeSchema,
  handler: async (input, { profile }): Promise<{ entryId: string }> => {
    const result = await recordSubscriptionCharge(profile.id, input);
    revalidateMoney();
    return { entryId: result.entryId };
  },
});

// ---------------------------------------------------------------------------
// Important dates
// ---------------------------------------------------------------------------

export const createImportantDateAction = createAuthenticatedAction({
  name: "importantDate.create",
  schema: createImportantDateSchema,
  handler: async (input, { profile }): Promise<{ importantDateId: string }> => {
    const record = await createImportantDate(profile.id, input);
    revalidateLife();
    return { importantDateId: record.id };
  },
});

export const updateImportantDateAction = createAuthenticatedAction({
  name: "importantDate.update",
  schema: updateImportantDateSchema,
  handler: async (input, { profile }): Promise<{ importantDateId: string }> => {
    await updateImportantDate(profile.id, input);
    revalidateLife();
    return { importantDateId: input.importantDateId };
  },
});

export const deleteImportantDateCommand = createAuthenticatedCommand({
  name: "importantDate.delete",
  schema: importantDateIdSchema,
  handler: async (input, { profile }): Promise<{ importantDateId: string }> => {
    await deleteImportantDate(profile.id, input.importantDateId);
    revalidateLife();
    return { importantDateId: input.importantDateId };
  },
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchLifeCommand = createAuthenticatedCommand({
  name: "life.search",
  schema: searchLifeSchema,
  handler: async (input, { profile }): Promise<readonly LifeSearchResult[]> =>
    searchLife(profile, input.query, input.limit),
});
