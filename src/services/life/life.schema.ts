import { z } from "zod";

import { formBoolean } from "@/lib/form-schema";
import { localDateSchema } from "@/services/task/task.schema";

/**
 * Goals, habits, check-in and money input schemas.
 *
 * Isomorphic — no `server-only` import — so the same rules validate a form in
 * the browser and the payload on the server. Dates are plain `YYYY-MM-DD`;
 * the server converts them using the PROFILE's zone.
 */

export const GOAL_CATEGORIES = [
  "ACADEMIC",
  "CAREER",
  "HEALTH",
  "FINANCE",
  "SKILL",
  "PERSONAL",
  "RELATIONSHIP",
  "OTHER",
] as const;

export const GOAL_TIMEFRAMES = [
  "WEEK",
  "MONTH",
  "QUARTER",
  "SEMESTER",
  "YEAR",
  "LONG_TERM",
] as const;

export const GOAL_STATUSES = [
  "ACTIVE",
  "ACHIEVED",
  "PAUSED",
  "ABANDONED",
] as const;

export const HABIT_KINDS = ["BUILD", "QUIT"] as const;
export const HABIT_CADENCES = ["DAILY", "WEEKLY", "SPECIFIC_DAYS"] as const;
export const MOOD_LEVELS = [
  "VERY_LOW",
  "LOW",
  "NEUTRAL",
  "GOOD",
  "GREAT",
] as const;
export const MONEY_DIRECTIONS = ["EXPENSE", "INCOME"] as const;
export const BILLING_CYCLES = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
] as const;
export const IMPORTANT_DATE_KINDS = [
  "BIRTHDAY",
  "ANNIVERSARY",
  "DEADLINE",
  "RENEWAL",
  "OTHER",
] as const;

const idSchema = z.string().min(1, "Missing reference.");

const shortText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `Keep ${label.toLowerCase()} under ${max} characters.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/** An optional number from a form: "" means "not answered", not zero. */
const optionalNumber = (min: number, max: number) =>
  z
    .union([z.literal(""), z.coerce.number()])
    .transform((value) => (value === "" ? undefined : value))
    .optional()
    .refine(
      (value) => value === undefined || (value >= min && value <= max),
      `Enter a value between ${min} and ${max}.`,
    );

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * A user-typed amount in MAJOR units, validated as text.
 *
 * Kept as a string here and converted to integer minor units in one place
 * (`parseMoneyToMinor`) so no float ever reaches the database.
 */
export const moneyAmountSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[,\s]/g, ""))
  .refine(
    (value) => /^\d+(\.\d{1,2})?$/.test(value),
    "Enter an amount like 249 or 249.50.",
  )
  .refine((value) => Number(value) > 0, "The amount must be more than zero.");

/** ISO 4217, upper-cased. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. INR.");

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

const goalFields = z.object({
  title: shortText(200, "Goal"),
  description: optionalText(4000),
  category: z.enum(GOAL_CATEGORIES).default("PERSONAL"),
  timeframe: z.enum(GOAL_TIMEFRAMES).default("MONTH"),
  targetDate: localDateSchema.optional(),
  /** Present makes this a MEASURED goal; absent makes it milestone-based. */
  targetValue: optionalNumber(0, 1_000_000_000),
  unit: optionalText(30),
});

export const createGoalSchema = goalFields;

export const updateGoalSchema = goalFields.partial().extend({
  goalId: idSchema,
  clearTargetDate: z.boolean().optional(),
});

export const goalIdSchema = z.object({ goalId: idSchema });

export const setGoalStatusSchema = z.object({
  goalId: idSchema,
  status: z.enum(GOAL_STATUSES),
});

export const setGoalProgressSchema = z.object({
  goalId: idSchema,
  currentValue: z.coerce.number().min(0).max(1_000_000_000),
});

export const archiveGoalSchema = z.object({
  goalId: idSchema,
  isArchived: z.boolean(),
});

export const createGoalMilestoneSchema = z.object({
  goalId: idSchema,
  title: shortText(200, "Milestone"),
  dueDate: localDateSchema.optional(),
});

export const goalMilestoneIdSchema = z.object({ milestoneId: idSchema });

export const setGoalMilestoneDoneSchema = z.object({
  milestoneId: idSchema,
  isCompleted: z.boolean(),
});

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

const weekdaySchema = z.coerce.number().int().min(1).max(7);

const habitFields = z.object({
  name: shortText(100, "Habit name"),
  description: optionalText(2000),
  kind: z.enum(HABIT_KINDS).default("BUILD"),
  cadence: z.enum(HABIT_CADENCES).default("DAILY"),
  targetPerPeriod: z.coerce.number().int().min(1).max(7).default(1),
  weekdays: z
    .union([z.array(weekdaySchema), weekdaySchema.transform((day) => [day])])
    .default([]),
  targetAmount: optionalNumber(0, 100_000),
  unit: optionalText(30),
  reminderMinute: optionalNumber(0, 1439),
  goalId: z.string().optional(),
  startDate: localDateSchema.optional(),
});

/** A SPECIFIC_DAYS habit with no days would never be due — reject it. */
const requireDaysForSpecificCadence = (
  value: { cadence?: string; weekdays?: readonly number[] },
  ctx: z.RefinementCtx,
): void => {
  if (
    value.cadence === "SPECIFIC_DAYS" &&
    (value.weekdays?.length ?? 0) === 0
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["weekdays"],
      message: "Pick at least one day.",
    });
  }
};

export const createHabitSchema = habitFields.superRefine(
  requireDaysForSpecificCadence,
);

export const updateHabitSchema = habitFields
  .partial()
  .extend({ habitId: idSchema })
  .superRefine(requireDaysForSpecificCadence);

export const habitIdSchema = z.object({ habitId: idSchema });

export const archiveHabitSchema = z.object({
  habitId: idSchema,
  isArchived: z.boolean(),
});

/**
 * Records one day for one habit.
 *
 * `isCompleted: false` is a DELIBERATE miss and is stored — it is not the
 * same as no row, which means "not answered yet".
 */
export const logHabitSchema = z.object({
  habitId: idSchema,
  logDate: localDateSchema,
  isCompleted: z.boolean().default(true),
  amount: optionalNumber(0, 100_000),
  note: optionalText(500),
});

export const clearHabitLogSchema = z.object({
  habitId: idSchema,
  logDate: localDateSchema,
});

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

/**
 * Every field optional on purpose.
 *
 * A check-in carrying only a mood is a real check-in. Demanding a complete
 * form is how daily tracking dies in week two.
 */
export const dailyCheckInSchema = z.object({
  checkInDate: localDateSchema,
  mood: z.enum(MOOD_LEVELS).optional(),
  energy: optionalNumber(1, 5),
  stress: optionalNumber(1, 5),
  sleepMinutes: optionalNumber(0, 1440),
  sleptAtMinute: optionalNumber(0, 1439),
  wokeAtMinute: optionalNumber(0, 1439),
  waterGlasses: optionalNumber(0, 50),
  exerciseMinutes: optionalNumber(0, 1440),
  steps: optionalNumber(0, 200_000),
  gratitude: optionalText(2000),
  highlight: optionalText(500),
  notes: optionalText(4000),
});

export const checkInDateSchema = z.object({ checkInDate: localDateSchema });

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const createMoneyCategorySchema = z.object({
  name: shortText(60, "Category name"),
  direction: z.enum(MONEY_DIRECTIONS).default("EXPENSE"),
  colorKey: optionalText(30),
  monthlyBudget: z
    .union([z.literal(""), moneyAmountSchema])
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

export const updateMoneyCategorySchema = createMoneyCategorySchema
  .partial()
  .extend({
    categoryId: idSchema,
    clearBudget: z.boolean().optional(),
  });

export const moneyCategoryIdSchema = z.object({ categoryId: idSchema });

export const createMoneyEntrySchema = z.object({
  direction: z.enum(MONEY_DIRECTIONS).default("EXPENSE"),
  amount: moneyAmountSchema,
  currency: currencySchema.default("INR"),
  description: shortText(200, "Description"),
  entryDate: localDateSchema,
  categoryId: z.string().optional(),
  notes: optionalText(2000),
});

export const updateMoneyEntrySchema = createMoneyEntrySchema
  .partial()
  .extend({ entryId: idSchema, clearCategory: z.boolean().optional() });

export const moneyEntryIdSchema = z.object({ entryId: idSchema });

export const moneyFiltersSchema = z.object({
  /** `YYYY-MM`; the query layer resolves it to a local month range. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-09.")
    .optional(),
  direction: z.enum(MONEY_DIRECTIONS).optional(),
  categoryId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

const subscriptionFields = z.object({
  name: shortText(120, "Subscription name"),
  amount: moneyAmountSchema,
  currency: currencySchema.default("INR"),
  cycle: z.enum(BILLING_CYCLES).default("MONTHLY"),
  nextChargeDate: localDateSchema,
  startedOn: localDateSchema.optional(),
  notes: optionalText(2000),
});

export const createSubscriptionSchema = subscriptionFields;

export const updateSubscriptionSchema = subscriptionFields
  .partial()
  .extend({ subscriptionId: idSchema });

export const subscriptionIdSchema = z.object({ subscriptionId: idSchema });

export const cancelSubscriptionSchema = z.object({
  subscriptionId: idSchema,
  isCancelled: z.boolean(),
});

/**
 * Records that a subscription charged, and advances its next date.
 *
 * Explicit rather than automatic on read: a user can skip or shift a renewal,
 * and that decision has to survive.
 */
export const recordSubscriptionChargeSchema = z.object({
  subscriptionId: idSchema,
  /** Defaults to the stored next charge date when omitted. */
  chargedOn: localDateSchema.optional(),
  categoryId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Important dates
// ---------------------------------------------------------------------------

const importantDateFields = z.object({
  title: shortText(200, "Title"),
  kind: z.enum(IMPORTANT_DATE_KINDS).default("OTHER"),
  eventDate: localDateSchema,
  isRecurring: formBoolean(true),
  remindDaysBefore: z.coerce.number().int().min(0).max(365).default(7),
  notes: optionalText(2000),
});

export const createImportantDateSchema = importantDateFields;

export const updateImportantDateSchema = importantDateFields
  .partial()
  .extend({ importantDateId: idSchema });

export const importantDateIdSchema = z.object({
  importantDateId: idSchema,
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchLifeSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type MoneyFilters = z.infer<typeof moneyFiltersSchema>;
