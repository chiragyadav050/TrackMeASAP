import type {
  CalendarEventKind,
  NotificationChannel,
  NotificationKind,
  ReminderRecurrence,
  ReminderStatus,
} from "@/generated/prisma/client";

export type {
  CalendarEventKind,
  NotificationChannel,
  NotificationKind,
  ReminderRecurrence,
  ReminderStatus,
} from "@/generated/prisma/client";

/**
 * Schedule view models.
 *
 * Time labels are produced on the SERVER in the profile's zone. A client
 * component never formats a time and can never disagree with the server about
 * which day a 23:30 event falls on.
 */

/** Where a calendar block came from. */
export type CalendarSource = "EVENT" | "CLASS" | "ASSIGNMENT" | "EXAM" | "TASK";

export type CalendarEntryDto = {
  readonly id: string;
  readonly source: CalendarSource;
  /** The underlying record's id, without the source prefix. */
  readonly sourceId: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly kind: CalendarEventKind | string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly isAllDay: boolean;
  /** Only busy blocks participate in conflict detection. */
  readonly isBusy: boolean;
  readonly dayKey: string;
  readonly timeLabel: string;
  readonly colorKey: string | null;
  readonly href: string;
  /** False for projected coursework — edit it where it lives. */
  readonly isEditable: boolean;
};

export type CalendarDayDto = {
  readonly dayKey: string;
  readonly label: string;
  readonly weekdayLabel: string;
  readonly isToday: boolean;
  readonly isPast: boolean;
  readonly entries: readonly CalendarEntryDto[];
  readonly busyMinutes: number;
};

export type ConflictDto = {
  readonly firstId: string;
  readonly firstTitle: string;
  readonly secondId: string;
  readonly secondTitle: string;
  readonly overlapMinutes: number;
  readonly dayKey: string;
};

export type CalendarViewDto = {
  readonly view: "DAY" | "WEEK" | "MONTH" | "AGENDA";
  readonly anchorKey: string;
  readonly rangeLabel: string;
  readonly days: readonly CalendarDayDto[];
  readonly conflicts: readonly ConflictDto[];
  readonly totalEntries: number;
};

export type FreeSlotDto = {
  readonly startAt: Date;
  readonly endAt: Date;
  readonly minutes: number;
  readonly label: string;
};

export type ReminderDto = {
  readonly id: string;
  readonly title: string;
  readonly message: string | null;
  readonly remindAt: Date;
  /** When it will actually fire — `snoozedUntil` when snoozed. */
  readonly firesAt: Date;
  readonly recurrence: ReminderRecurrence;
  readonly weekdays: readonly number[];
  readonly status: ReminderStatus;
  readonly isSnoozed: boolean;
  readonly isOverdue: boolean;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly remindDateInput: string;
  readonly remindTimeInput: string;
  readonly taskId: string | null;
  readonly eventId: string | null;
  readonly habitId: string | null;
};

export type NotificationDto = {
  readonly id: string;
  readonly kind: NotificationKind | string;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly isRead: boolean;
  readonly timeLabel: string;
};

export type NotificationPreferenceDto = {
  readonly kind: NotificationKind;
  readonly channel: NotificationChannel;
  readonly isEnabled: boolean;
};

export type NotificationSettingsDto = {
  readonly isQuietHoursEnabled: boolean;
  readonly quietHoursStart: number | null;
  readonly quietHoursEnd: number | null;
  readonly dailyLimit: number;
};
