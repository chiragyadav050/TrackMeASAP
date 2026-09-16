import "server-only";

import type {
  DailyCheckIn,
  ImportantDate,
  MoneyCategory,
  MoneyEntry,
  Prisma,
  Subscription,
} from "@/generated/prisma/client";
import { notFound, validationFailed } from "@/lib/errors";
import { db } from "@/server/db";
import { toDateOnly } from "@/services/academics/academic.dates";
import { recordActivity } from "@/services/activity/activity.service";
import { parseMoneyToMinor } from "@/services/life/habit.derive";
import type { z } from "zod";
import type {
  createImportantDateSchema,
  createMoneyCategorySchema,
  createMoneyEntrySchema,
  createSubscriptionSchema,
  dailyCheckInSchema,
  recordSubscriptionChargeSchema,
  updateImportantDateSchema,
  updateMoneyCategorySchema,
  updateMoneyEntrySchema,
  updateSubscriptionSchema,
} from "@/services/life/life.schema";

/**
 * Money, check-ins and important dates.
 *
 * MONEY IS INTEGER MINOR UNITS EVERYWHERE. Amounts arrive as validated
 * strings and are converted exactly once, here, by `parseMoneyToMinor`. No
 * float ever reaches the database: binary floating point cannot represent 0.1
 * exactly, and a personal finance tool whose monthly totals drift is worse
 * than none at all.
 */

export const ENTITY_MONEY_ENTRY = "money_entry";
export const ENTITY_SUBSCRIPTION = "subscription";
export const ENTITY_CHECK_IN = "daily_check_in";
export const ENTITY_IMPORTANT_DATE = "important_date";

/** Converts a validated amount string, or refuses. */
function toMinor(amount: string, field: string): number {
  const minor = parseMoneyToMinor(amount);

  if (minor === null) {
    throw validationFailed({
      [field]: ["Enter an amount like 249 or 249.50."],
    });
  }

  return minor;
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export async function requireOwnedCategory(
  profileId: string,
  categoryId: string,
): Promise<MoneyCategory> {
  const category = await db.moneyCategory.findFirst({
    where: { id: categoryId, profileId },
  });

  if (!category) {
    throw notFound("Category");
  }

  return category;
}

export async function requireOwnedEntry(
  profileId: string,
  entryId: string,
): Promise<MoneyEntry> {
  const entry = await db.moneyEntry.findFirst({
    where: { id: entryId, profileId },
  });

  if (!entry) {
    throw notFound("Entry");
  }

  return entry;
}

export async function requireOwnedSubscription(
  profileId: string,
  subscriptionId: string,
): Promise<Subscription> {
  const subscription = await db.subscription.findFirst({
    where: { id: subscriptionId, profileId },
  });

  if (!subscription) {
    throw notFound("Subscription");
  }

  return subscription;
}

export async function requireOwnedImportantDate(
  profileId: string,
  importantDateId: string,
): Promise<ImportantDate> {
  const record = await db.importantDate.findFirst({
    where: { id: importantDateId, profileId },
  });

  if (!record) {
    throw notFound("Date");
  }

  return record;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createMoneyCategory(
  profileId: string,
  input: z.infer<typeof createMoneyCategorySchema>,
): Promise<MoneyCategory> {
  return db.moneyCategory.create({
    data: {
      profileId,
      name: input.name,
      direction: input.direction,
      colorKey: input.colorKey ?? null,
      monthlyBudgetMinor: input.monthlyBudget
        ? toMinor(input.monthlyBudget, "monthlyBudget")
        : null,
    },
  });
}

export async function updateMoneyCategory(
  profileId: string,
  input: z.infer<typeof updateMoneyCategorySchema>,
): Promise<MoneyCategory> {
  const existing = await requireOwnedCategory(profileId, input.categoryId);

  const data: Prisma.MoneyCategoryUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.direction !== undefined) data.direction = input.direction;
  if (input.colorKey !== undefined) data.colorKey = input.colorKey ?? null;

  if (input.clearBudget) {
    data.monthlyBudgetMinor = null;
  } else if (input.monthlyBudget) {
    data.monthlyBudgetMinor = toMinor(input.monthlyBudget, "monthlyBudget");
  }

  return db.moneyCategory.update({ where: { id: existing.id }, data });
}

/**
 * Deletes a category.
 *
 * Entries survive with `categoryId` null (SetNull) — deleting a bucket must
 * never delete the record of money that actually moved.
 */
export async function deleteMoneyCategory(
  profileId: string,
  categoryId: string,
): Promise<void> {
  const existing = await requireOwnedCategory(profileId, categoryId);

  await db.moneyCategory.delete({ where: { id: existing.id } });
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export async function createMoneyEntry(
  profileId: string,
  input: z.infer<typeof createMoneyEntrySchema>,
): Promise<MoneyEntry> {
  if (input.categoryId) {
    await requireOwnedCategory(profileId, input.categoryId);
  }

  const entry = await db.moneyEntry.create({
    data: {
      profileId,
      categoryId: input.categoryId || null,
      direction: input.direction,
      amountMinor: toMinor(input.amount, "amount"),
      currency: input.currency,
      description: input.description,
      entryDate: toDateOnly(input.entryDate),
      notes: input.notes ?? null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_MONEY_ENTRY,
    entityId: entry.id,
    action: "CREATED",
    // Deliberately no amount in the metadata — the activity log is not the
    // place to duplicate financial detail.
    metadata: { direction: input.direction },
  });

  return entry;
}

export async function updateMoneyEntry(
  profileId: string,
  input: z.infer<typeof updateMoneyEntrySchema>,
): Promise<MoneyEntry> {
  const existing = await requireOwnedEntry(profileId, input.entryId);

  if (input.categoryId) {
    await requireOwnedCategory(profileId, input.categoryId);
  }

  const data: Prisma.MoneyEntryUpdateInput = {};

  if (input.direction !== undefined) data.direction = input.direction;
  if (input.amount !== undefined) {
    data.amountMinor = toMinor(input.amount, "amount");
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.description !== undefined) data.description = input.description;
  if (input.entryDate) data.entryDate = toDateOnly(input.entryDate);
  if (input.notes !== undefined) data.notes = input.notes ?? null;

  if (input.clearCategory) {
    data.category = { disconnect: true };
  } else if (input.categoryId) {
    data.category = { connect: { id: input.categoryId } };
  }

  return db.moneyEntry.update({ where: { id: existing.id }, data });
}

export async function deleteMoneyEntry(
  profileId: string,
  entryId: string,
): Promise<void> {
  const existing = await requireOwnedEntry(profileId, entryId);

  await db.moneyEntry.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_MONEY_ENTRY,
    entityId: existing.id,
    action: "DELETED",
  });
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function createSubscription(
  profileId: string,
  input: z.infer<typeof createSubscriptionSchema>,
): Promise<Subscription> {
  return db.subscription.create({
    data: {
      profileId,
      name: input.name,
      amountMinor: toMinor(input.amount, "amount"),
      currency: input.currency,
      cycle: input.cycle,
      nextChargeDate: toDateOnly(input.nextChargeDate),
      startedOn: input.startedOn ? toDateOnly(input.startedOn) : null,
      notes: input.notes ?? null,
    },
  });
}

export async function updateSubscription(
  profileId: string,
  input: z.infer<typeof updateSubscriptionSchema>,
): Promise<Subscription> {
  const existing = await requireOwnedSubscription(
    profileId,
    input.subscriptionId,
  );

  const data: Prisma.SubscriptionUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.amount !== undefined) {
    data.amountMinor = toMinor(input.amount, "amount");
  }
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.cycle !== undefined) data.cycle = input.cycle;
  if (input.nextChargeDate) {
    data.nextChargeDate = toDateOnly(input.nextChargeDate);
  }
  if (input.startedOn) data.startedOn = toDateOnly(input.startedOn);
  if (input.notes !== undefined) data.notes = input.notes ?? null;

  return db.subscription.update({ where: { id: existing.id }, data });
}

/**
 * Cancels or reinstates a subscription.
 *
 * Cancelling never deletes: the history of what was paid stays, and a
 * reinstated service keeps its record.
 */
export async function setSubscriptionCancelled(
  profileId: string,
  subscriptionId: string,
  isCancelled: boolean,
): Promise<Subscription> {
  const existing = await requireOwnedSubscription(profileId, subscriptionId);

  const subscription = await db.subscription.update({
    where: { id: existing.id },
    data: { cancelledAt: isCancelled ? new Date() : null },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_SUBSCRIPTION,
    entityId: subscription.id,
    action: "UPDATED",
    metadata: { cancelled: isCancelled },
  });

  return subscription;
}

export async function deleteSubscription(
  profileId: string,
  subscriptionId: string,
): Promise<void> {
  const existing = await requireOwnedSubscription(profileId, subscriptionId);

  // Entries generated from it survive with `subscriptionId` null — the money
  // really did leave the account.
  await db.subscription.delete({ where: { id: existing.id } });
}

/** Advances a date by one billing cycle, on the calendar rather than by
 * adding days — "monthly" means the same date next month, not +30. */
function advanceByCycle(from: Date, cycle: Subscription["cycle"]): Date {
  const next = new Date(from.getTime());

  switch (cycle) {
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "QUARTERLY":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case "MONTHLY":
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }

  return next;
}

/**
 * Records that a subscription charged, and advances its next date.
 *
 * Explicit rather than automatic on read, for two reasons: a user can skip or
 * shift a renewal and that decision must survive, and an expense written as a
 * side effect of loading a page would double-count on every refresh.
 *
 * The generated entry carries `subscriptionId`, so a repeat call for the same
 * date is refused rather than silently duplicating the charge.
 */
export async function recordSubscriptionCharge(
  profileId: string,
  input: z.infer<typeof recordSubscriptionChargeSchema>,
): Promise<{ readonly entryId: string; readonly nextChargeDate: Date }> {
  const subscription = await requireOwnedSubscription(
    profileId,
    input.subscriptionId,
  );

  if (input.categoryId) {
    await requireOwnedCategory(profileId, input.categoryId);
  }

  const chargedOn = input.chargedOn
    ? toDateOnly(input.chargedOn)
    : subscription.nextChargeDate;

  return db.$transaction(async (tx) => {
    const duplicate = await tx.moneyEntry.findFirst({
      where: {
        profileId,
        subscriptionId: subscription.id,
        entryDate: chargedOn,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw validationFailed({
        _form: ["That charge is already recorded for this date."],
      });
    }

    const entry = await tx.moneyEntry.create({
      data: {
        profileId,
        subscriptionId: subscription.id,
        categoryId: input.categoryId || null,
        direction: "EXPENSE",
        amountMinor: subscription.amountMinor,
        currency: subscription.currency,
        description: subscription.name,
        entryDate: chargedOn,
      },
    });

    const updated = await tx.subscription.update({
      where: { id: subscription.id },
      data: { nextChargeDate: advanceByCycle(chargedOn, subscription.cycle) },
    });

    return { entryId: entry.id, nextChargeDate: updated.nextChargeDate };
  });
}

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

/**
 * Saves the check-in for one local day.
 *
 * Upsert on `(profileId, checkInDate)` — a day has one record, and returning
 * to add a note in the evening must update the morning's row rather than
 * create a second one.
 */
export async function saveDailyCheckIn(
  profileId: string,
  input: z.infer<typeof dailyCheckInSchema>,
): Promise<DailyCheckIn> {
  const checkInDate = toDateOnly(input.checkInDate);

  const EDITABLE = [
    "mood",
    "energy",
    "stress",
    "sleepMinutes",
    "sleptAtMinute",
    "wokeAtMinute",
    "waterGlasses",
    "exerciseMinutes",
    "steps",
    "gratitude",
    "highlight",
    "notes",
  ] as const;

  /**
   * AN UPDATE TOUCHES ONLY WHAT THE CALLER ACTUALLY SENT.
   *
   * This used to build a complete record where every absent field became
   * `null`, and pass that as the upsert's `update`. Any partial save therefore
   * WIPED the fields it did not mention — and the AI tool exposes only five of
   * these twelve, so "log that I slept seven hours" silently erased the
   * gratitude note and highlight written that morning. Destructive behaviour
   * from a call that reads as additive.
   *
   * `undefined` means "not provided" and is skipped; an explicit `null` still
   * clears, so the distinction the caller cares about survives.
   */
  const update: Record<string, unknown> = {};

  for (const key of EDITABLE) {
    if (input[key] !== undefined) {
      update[key] = input[key];
    }
  }

  // A new row is a different question: absent means "nothing recorded", and
  // the column is nullable precisely to say so.
  const create = Object.fromEntries(
    EDITABLE.map((key) => [key, input[key] ?? null]),
  );

  return db.dailyCheckIn.upsert({
    where: { profileId_checkInDate: { profileId, checkInDate } },
    create: { profileId, checkInDate, ...create },
    update,
  });
}

export async function deleteDailyCheckIn(
  profileId: string,
  checkInDateKey: string,
): Promise<void> {
  await db.dailyCheckIn.deleteMany({
    where: { profileId, checkInDate: toDateOnly(checkInDateKey) },
  });
}

// ---------------------------------------------------------------------------
// Important dates
// ---------------------------------------------------------------------------

export async function createImportantDate(
  profileId: string,
  input: z.infer<typeof createImportantDateSchema>,
): Promise<ImportantDate> {
  return db.importantDate.create({
    data: {
      profileId,
      title: input.title,
      kind: input.kind,
      // The ORIGINAL date, year included — so "turning 21" stays computable.
      eventDate: toDateOnly(input.eventDate),
      isRecurring: input.isRecurring,
      remindDaysBefore: input.remindDaysBefore,
      notes: input.notes ?? null,
    },
  });
}

export async function updateImportantDate(
  profileId: string,
  input: z.infer<typeof updateImportantDateSchema>,
): Promise<ImportantDate> {
  const existing = await requireOwnedImportantDate(
    profileId,
    input.importantDateId,
  );

  const data: Prisma.ImportantDateUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.eventDate) data.eventDate = toDateOnly(input.eventDate);
  if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
  if (input.remindDaysBefore !== undefined) {
    data.remindDaysBefore = input.remindDaysBefore;
  }
  if (input.notes !== undefined) data.notes = input.notes ?? null;

  return db.importantDate.update({ where: { id: existing.id }, data });
}

export async function deleteImportantDate(
  profileId: string,
  importantDateId: string,
): Promise<void> {
  const existing = await requireOwnedImportantDate(profileId, importantDateId);

  await db.importantDate.delete({ where: { id: existing.id } });
}
