import type {
  BillingCycle,
  GoalCategory,
  GoalStatus,
  GoalTimeframe,
  HabitCadence,
  HabitKind,
  ImportantDateKind,
  MoneyDirection,
  MoodLevel,
} from "@/generated/prisma/client";
import type { BudgetStatus, GoalPace } from "@/services/life/habit.derive";

export type {
  BillingCycle,
  GoalCategory,
  GoalStatus,
  GoalTimeframe,
  HabitCadence,
  HabitKind,
  ImportantDateKind,
  MoneyDirection,
  MoodLevel,
} from "@/generated/prisma/client";
export type { BudgetStatus, GoalPace } from "@/services/life/habit.derive";

/**
 * Life view models.
 *
 * Same contract as every other DTO in Life OS: date-derived labels and money
 * strings are produced on the SERVER in the profile's zone and locale. A
 * client component never formats a currency, never calls `getHours()`, and
 * can never disagree with the server about what day it is.
 */

export type GoalDto = {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly category: GoalCategory;
  readonly timeframe: GoalTimeframe;
  readonly status: GoalStatus;
  readonly targetDateInput: string | null;
  readonly targetLabel: string | null;
  readonly daysRemaining: number | null;
  /** `null` for a goal with neither a target value nor milestones. */
  readonly progressPercent: number | null;
  readonly pace: GoalPace;
  readonly targetValue: number | null;
  readonly currentValue: number;
  readonly unit: string | null;
  readonly isMeasured: boolean;
  readonly milestonesTotal: number;
  readonly milestonesCompleted: number;
  readonly habitCount: number;
  readonly taskCount: number;
  readonly isArchived: boolean;
};

export type GoalMilestoneDto = {
  readonly id: string;
  readonly title: string;
  readonly isCompleted: boolean;
  readonly dueLabel: string | null;
  readonly isOverdue: boolean;
};

export type GoalDetailDto = {
  readonly goal: GoalDto;
  readonly milestones: readonly GoalMilestoneDto[];
  readonly habits: readonly HabitDto[];
};

export type HabitDto = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: HabitKind;
  readonly cadence: HabitCadence;
  readonly targetPerPeriod: number;
  readonly weekdays: readonly number[];
  readonly targetAmount: number | null;
  readonly unit: string | null;
  readonly reminderLabel: string | null;
  readonly goalId: string | null;
  readonly goalTitle: string | null;
  /** True when the habit is scheduled for today in the profile's zone. */
  readonly isDueToday: boolean;
  /** `null` when today has not been answered; the UI shows all three states. */
  readonly todayStatus: "DONE" | "MISSED" | null;
  readonly currentStreak: number;
  readonly longestStreak: number;
  /** `null` when nothing was scheduled in the window — not 0%. */
  readonly completionRate30: number | null;
  readonly weekCompleted: number;
  readonly weekTarget: number;
  /** QUIT habits only. */
  readonly daysClean: number | null;
  readonly startDateInput: string;
  readonly isArchived: boolean;
  /** Last 7 local days, oldest first, for the inline strip. */
  readonly recentDays: readonly HabitDayDto[];
};

export type HabitDayDto = {
  readonly dateKey: string;
  readonly shortLabel: string;
  readonly isScheduled: boolean;
  readonly isToday: boolean;
  readonly status: "DONE" | "MISSED" | null;
};

export type CheckInDto = {
  readonly checkInDateInput: string;
  readonly mood: MoodLevel | null;
  readonly energy: number | null;
  readonly stress: number | null;
  readonly sleepMinutes: number | null;
  readonly sleepLabel: string | null;
  readonly waterGlasses: number | null;
  readonly exerciseMinutes: number | null;
  readonly steps: number | null;
  readonly gratitude: string | null;
  readonly highlight: string | null;
  readonly notes: string | null;
  readonly hasAnyAnswer: boolean;
};

export type MoneyCategoryDto = {
  readonly id: string;
  readonly name: string;
  readonly direction: MoneyDirection;
  readonly colorKey: string | null;
  readonly monthlyBudgetMinor: number | null;
  readonly budgetLabel: string | null;
  readonly spentMinor: number;
  readonly spentLabel: string;
  readonly budgetStatus: BudgetStatus;
  readonly usedPercent: number | null;
  readonly isArchived: boolean;
};

export type MoneyEntryDto = {
  readonly id: string;
  readonly direction: MoneyDirection;
  readonly amountMinor: number;
  readonly amountLabel: string;
  readonly currency: string;
  readonly description: string;
  readonly entryDateInput: string;
  readonly dateLabel: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly isFromSubscription: boolean;
  readonly notes: string | null;
};

export type SubscriptionDto = {
  readonly id: string;
  readonly name: string;
  readonly amountMinor: number;
  readonly amountLabel: string;
  readonly currency: string;
  readonly cycle: BillingCycle;
  readonly monthlyEquivalentLabel: string;
  readonly nextChargeInput: string;
  readonly nextChargeLabel: string;
  readonly daysUntilCharge: number;
  readonly isDueSoon: boolean;
  readonly isCancelled: boolean;
  readonly notes: string | null;
};

export type ImportantDateDto = {
  readonly id: string;
  readonly title: string;
  readonly kind: ImportantDateKind;
  readonly eventDateInput: string;
  readonly isRecurring: boolean;
  readonly nextOccurrenceLabel: string;
  readonly daysUntil: number;
  readonly isWithinReminderWindow: boolean;
  /** For recurring dates with a known original year, e.g. a 21st birthday. */
  readonly yearsAtNextOccurrence: number | null;
  readonly remindDaysBefore: number;
  readonly notes: string | null;
};

export type MoneySummaryDto = {
  /** `YYYY-MM` of the month being summarised. */
  readonly month: string;
  readonly monthLabel: string;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
  readonly netMinor: number;
  readonly incomeLabel: string;
  readonly expenseLabel: string;
  readonly netLabel: string;
  readonly currency: string;
  readonly entryCount: number;
  readonly categories: readonly MoneyCategoryDto[];
  readonly subscriptionMonthlyLabel: string;
};

export type HabitSummaryDto = {
  readonly dueTodayCount: number;
  readonly doneTodayCount: number;
  readonly bestStreak: number;
  readonly habits: readonly HabitDto[];
};

export type LifeOverviewDto = {
  readonly goals: readonly GoalDto[];
  readonly activeGoalCount: number;
  readonly habits: HabitSummaryDto;
  readonly checkIn: CheckInDto | null;
  readonly money: MoneySummaryDto;
  readonly upcomingDates: readonly ImportantDateDto[];
  readonly upcomingSubscriptions: readonly SubscriptionDto[];
};

export type LifeSearchResult = {
  readonly id: string;
  readonly kind: "GOAL" | "HABIT";
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string;
};
