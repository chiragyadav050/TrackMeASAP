import "server-only";

import type { Prisma, Profile } from "@/generated/prisma/client";
import { formatInTimeZone, localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import { fromDateOnly, toDateOnly } from "@/services/academics/academic.dates";
import {
  budgetStatus,
  formatMoney,
  monthlyEquivalentMinor,
} from "@/services/life/habit.derive";
import type { MoneyFilters } from "@/services/life/life.schema";
import type {
  CheckInDto,
  ImportantDateDto,
  MoneyCategoryDto,
  MoneyEntryDto,
  MoneySummaryDto,
  SubscriptionDto,
} from "@/types/life";

/**
 * Money, check-in and important-date reads.
 *
 * Every amount is formatted HERE, from integer minor units, using the
 * profile's locale. A client component never divides by 100 and never picks a
 * currency symbol.
 */

/** Charges inside this many days are surfaced as "due soon". */
const SUBSCRIPTION_HORIZON_DAYS = 7;
const IMPORTANT_DATE_HORIZON_DAYS = 60;

/** The profile's default currency: whatever they use most, else INR. */
async function resolveCurrency(profileId: string): Promise<string> {
  const common = await db.moneyEntry.groupBy({
    by: ["currency"],
    where: { profileId },
    _count: { _all: true },
    orderBy: { _count: { currency: "desc" } },
    take: 1,
  });

  return common[0]?.currency ?? "INR";
}

/** `YYYY-MM` → the date-only bounds of that month, end exclusive. */
function monthBounds(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split("-").map(Number);

  return {
    start: new Date(Date.UTC(year!, monthNumber! - 1, 1)),
    end: new Date(Date.UTC(year!, monthNumber!, 1)),
  };
}

/** The local month containing `now`, as `YYYY-MM`. */
export function currentMonthKey(now: Date, timeZone: string): string {
  return localDateKey(now, timeZone).slice(0, 7);
}

function dayGap(fromKey: string, toKey: string): number {
  return Math.round(
    (toDateOnly(toKey).getTime() - toDateOnly(fromKey).getTime()) / 86_400_000,
  );
}

export async function listMoneyEntries(
  profile: Profile,
  filters: MoneyFilters,
  now: Date = new Date(),
): Promise<readonly MoneyEntryDto[]> {
  const month = filters.month ?? currentMonthKey(now, profile.timeZone);
  const { start, end } = monthBounds(month);

  const where: Prisma.MoneyEntryWhereInput = {
    profileId: profile.id,
    entryDate: { gte: start, lt: end },
  };

  if (filters.direction) where.direction = filters.direction;
  if (filters.categoryId) where.categoryId = filters.categoryId;

  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: "insensitive" } },
      { notes: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const entries = await db.moneyEntry.findMany({
    where,
    include: { category: { select: { name: true } } },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });

  return entries.map((entry) => ({
    id: entry.id,
    direction: entry.direction,
    amountMinor: entry.amountMinor,
    amountLabel: formatMoney(entry.amountMinor, entry.currency, profile.locale),
    currency: entry.currency,
    description: entry.description,
    entryDateInput: fromDateOnly(entry.entryDate),
    dateLabel: formatInTimeZone(
      entry.entryDate,
      "UTC",
      { day: "numeric", month: "short" },
      profile.locale,
    ),
    categoryId: entry.categoryId,
    categoryName: entry.category?.name ?? null,
    isFromSubscription: entry.subscriptionId !== null,
    notes: entry.notes,
  }));
}

/**
 * The month's money, assembled in a constant number of queries.
 *
 * Totals come from database aggregates over INTEGER columns, not from summing
 * rows in JavaScript — the arithmetic is exact and the whole month need not be
 * loaded to add it up.
 */
export async function getMoneySummary(
  profile: Profile,
  month?: string,
  now: Date = new Date(),
): Promise<MoneySummaryDto> {
  const monthKey = month ?? currentMonthKey(now, profile.timeZone);
  const { start, end } = monthBounds(monthKey);
  const range = { gte: start, lt: end };

  const [totals, categories, categorySpend, subscriptions, currency] =
    await Promise.all([
      db.moneyEntry.groupBy({
        by: ["direction"],
        where: { profileId: profile.id, entryDate: range },
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.moneyCategory.findMany({
        where: { profileId: profile.id, archivedAt: null },
        orderBy: { name: "asc" },
      }),
      db.moneyEntry.groupBy({
        by: ["categoryId"],
        where: {
          profileId: profile.id,
          entryDate: range,
          direction: "EXPENSE",
        },
        _sum: { amountMinor: true },
      }),
      db.subscription.findMany({
        where: { profileId: profile.id, cancelledAt: null },
        select: { amountMinor: true, cycle: true },
      }),
      resolveCurrency(profile.id),
    ]);

  const incomeMinor =
    totals.find((row) => row.direction === "INCOME")?._sum.amountMinor ?? 0;
  const expenseMinor =
    totals.find((row) => row.direction === "EXPENSE")?._sum.amountMinor ?? 0;
  const netMinor = incomeMinor - expenseMinor;

  const spendByCategory = new Map(
    categorySpend
      .filter((row) => row.categoryId)
      .map((row) => [row.categoryId!, row._sum.amountMinor ?? 0]),
  );

  const subscriptionMonthlyMinor = subscriptions.reduce(
    (total, subscription) =>
      total +
      monthlyEquivalentMinor(subscription.amountMinor, subscription.cycle),
    0,
  );

  return {
    month: monthKey,
    monthLabel: formatInTimeZone(
      monthBounds(monthKey).start,
      "UTC",
      { month: "long", year: "numeric" },
      profile.locale,
    ),
    incomeMinor,
    expenseMinor,
    netMinor,
    incomeLabel: formatMoney(incomeMinor, currency, profile.locale),
    expenseLabel: formatMoney(expenseMinor, currency, profile.locale),
    netLabel: formatMoney(netMinor, currency, profile.locale),
    currency,
    entryCount: totals.reduce((count, row) => count + row._count._all, 0),
    categories: categories.map((category): MoneyCategoryDto => {
      const spentMinor = spendByCategory.get(category.id) ?? 0;

      return {
        id: category.id,
        name: category.name,
        direction: category.direction,
        colorKey: category.colorKey,
        monthlyBudgetMinor: category.monthlyBudgetMinor,
        budgetLabel:
          category.monthlyBudgetMinor === null
            ? null
            : formatMoney(
                category.monthlyBudgetMinor,
                currency,
                profile.locale,
              ),
        spentMinor,
        spentLabel: formatMoney(spentMinor, currency, profile.locale),
        budgetStatus: budgetStatus(spentMinor, category.monthlyBudgetMinor),
        usedPercent:
          category.monthlyBudgetMinor && category.monthlyBudgetMinor > 0
            ? (spentMinor / category.monthlyBudgetMinor) * 100
            : null,
        isArchived: category.archivedAt !== null,
      };
    }),
    subscriptionMonthlyLabel: formatMoney(
      subscriptionMonthlyMinor,
      currency,
      profile.locale,
    ),
  };
}

export async function listSubscriptions(
  profile: Profile,
  includeCancelled = false,
  now: Date = new Date(),
): Promise<readonly SubscriptionDto[]> {
  const subscriptions = await db.subscription.findMany({
    where: {
      profileId: profile.id,
      ...(includeCancelled ? {} : { cancelledAt: null }),
    },
    orderBy: [{ cancelledAt: "asc" }, { nextChargeDate: "asc" }],
  });

  const todayKey = localDateKey(now, profile.timeZone);

  return subscriptions.map((subscription) => {
    const nextKey = fromDateOnly(subscription.nextChargeDate);
    const daysUntilCharge = dayGap(todayKey, nextKey);

    return {
      id: subscription.id,
      name: subscription.name,
      amountMinor: subscription.amountMinor,
      amountLabel: formatMoney(
        subscription.amountMinor,
        subscription.currency,
        profile.locale,
      ),
      currency: subscription.currency,
      cycle: subscription.cycle,
      monthlyEquivalentLabel: formatMoney(
        monthlyEquivalentMinor(subscription.amountMinor, subscription.cycle),
        subscription.currency,
        profile.locale,
      ),
      nextChargeInput: nextKey,
      nextChargeLabel: formatInTimeZone(
        subscription.nextChargeDate,
        "UTC",
        { day: "numeric", month: "short" },
        profile.locale,
      ),
      daysUntilCharge,
      isDueSoon:
        subscription.cancelledAt === null &&
        daysUntilCharge <= SUBSCRIPTION_HORIZON_DAYS,
      isCancelled: subscription.cancelledAt !== null,
      notes: subscription.notes,
    };
  });
}

/**
 * The next occurrence of a recurring date.
 *
 * The stored year is the ORIGINAL (the year of birth), and is never
 * overwritten — so the age at the next occurrence stays computable. If this
 * year's date has already passed, the next one is next year.
 *
 * 29 February is handled by the Date constructor rolling to 1 March in a
 * non-leap year, which is the behaviour most calendars use and is better than
 * the date silently vanishing for three years out of four.
 */
function nextOccurrence(
  eventKey: string,
  todayKey: string,
  isRecurring: boolean,
): { key: string; years: number | null } {
  if (!isRecurring) {
    return { key: eventKey, years: null };
  }

  const [originalYear, month, day] = eventKey.split("-").map(Number);
  const todayYear = Number(todayKey.slice(0, 4));

  const candidate = new Date(Date.UTC(todayYear, month! - 1, day!));
  const candidateKey = fromDateOnly(candidate);

  if (candidateKey >= todayKey) {
    return { key: candidateKey, years: todayYear - originalYear! };
  }

  const nextYear = new Date(Date.UTC(todayYear + 1, month! - 1, day!));

  return {
    key: fromDateOnly(nextYear),
    years: todayYear + 1 - originalYear!,
  };
}

export async function listImportantDates(
  profile: Profile,
  now: Date = new Date(),
): Promise<readonly ImportantDateDto[]> {
  const records = await db.importantDate.findMany({
    where: { profileId: profile.id },
  });

  const todayKey = localDateKey(now, profile.timeZone);

  return records
    .map((record): ImportantDateDto => {
      const eventKey = fromDateOnly(record.eventDate);
      const next = nextOccurrence(eventKey, todayKey, record.isRecurring);
      const daysUntil = dayGap(todayKey, next.key);

      return {
        id: record.id,
        title: record.title,
        kind: record.kind,
        eventDateInput: eventKey,
        isRecurring: record.isRecurring,
        nextOccurrenceLabel: formatInTimeZone(
          toDateOnly(next.key),
          "UTC",
          { day: "numeric", month: "short", year: "numeric" },
          profile.locale,
        ),
        daysUntil,
        isWithinReminderWindow:
          daysUntil >= 0 && daysUntil <= record.remindDaysBefore,
        yearsAtNextOccurrence: next.years,
        remindDaysBefore: record.remindDaysBefore,
        notes: record.notes,
      };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

export async function getCheckIn(
  profile: Profile,
  dateKey: string,
): Promise<CheckInDto | null> {
  const checkIn = await db.dailyCheckIn.findUnique({
    where: {
      profileId_checkInDate: {
        profileId: profile.id,
        checkInDate: toDateOnly(dateKey),
      },
    },
  });

  if (!checkIn) {
    return null;
  }

  const hasAnyAnswer = [
    checkIn.mood,
    checkIn.energy,
    checkIn.stress,
    checkIn.sleepMinutes,
    checkIn.waterGlasses,
    checkIn.exerciseMinutes,
    checkIn.steps,
    checkIn.gratitude,
    checkIn.highlight,
    checkIn.notes,
  ].some((value) => value !== null && value !== "");

  return {
    checkInDateInput: fromDateOnly(checkIn.checkInDate),
    mood: checkIn.mood,
    energy: checkIn.energy,
    stress: checkIn.stress,
    sleepMinutes: checkIn.sleepMinutes,
    sleepLabel:
      checkIn.sleepMinutes === null
        ? null
        : `${Math.floor(checkIn.sleepMinutes / 60)}h ${checkIn.sleepMinutes % 60}m`,
    waterGlasses: checkIn.waterGlasses,
    exerciseMinutes: checkIn.exerciseMinutes,
    steps: checkIn.steps,
    gratitude: checkIn.gratitude,
    highlight: checkIn.highlight,
    notes: checkIn.notes,
    hasAnyAnswer,
  };
}

/** Recent check-ins, for the trend strip. Oldest first. */
export async function listRecentCheckIns(
  profile: Profile,
  days = 14,
  now: Date = new Date(),
): Promise<readonly CheckInDto[]> {
  const todayKey = localDateKey(now, profile.timeZone);
  const from = toDateOnly(todayKey);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const checkIns = await db.dailyCheckIn.findMany({
    where: { profileId: profile.id, checkInDate: { gte: from } },
    orderBy: { checkInDate: "asc" },
  });

  return checkIns.map((checkIn) => ({
    checkInDateInput: fromDateOnly(checkIn.checkInDate),
    mood: checkIn.mood,
    energy: checkIn.energy,
    stress: checkIn.stress,
    sleepMinutes: checkIn.sleepMinutes,
    sleepLabel:
      checkIn.sleepMinutes === null
        ? null
        : `${Math.floor(checkIn.sleepMinutes / 60)}h ${checkIn.sleepMinutes % 60}m`,
    waterGlasses: checkIn.waterGlasses,
    exerciseMinutes: checkIn.exerciseMinutes,
    steps: checkIn.steps,
    gratitude: checkIn.gratitude,
    highlight: checkIn.highlight,
    notes: checkIn.notes,
    hasAnyAnswer: true,
  }));
}

/** Dates worth surfacing on a dashboard — inside their reminder window, or
 * simply close enough to matter. */
export async function getUpcomingDates(
  profile: Profile,
  now: Date = new Date(),
): Promise<readonly ImportantDateDto[]> {
  const all = await listImportantDates(profile, now);

  return all
    .filter(
      (date) =>
        date.daysUntil >= 0 && date.daysUntil <= IMPORTANT_DATE_HORIZON_DAYS,
    )
    .slice(0, 6);
}
