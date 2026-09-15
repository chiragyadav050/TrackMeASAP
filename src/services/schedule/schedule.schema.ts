import { z } from "zod";

import { formBoolean } from "@/lib/form-schema";
import { localDateSchema, localTimeSchema } from "@/services/task/task.schema";

/**
 * Reminder, notification and calendar input schemas.
 *
 * Isomorphic. Dates and times are plain `YYYY-MM-DD` / `HH:mm` strings; the
 * server converts using the PROFILE's zone, never the browser's.
 */

export const REMINDER_RECURRENCES = [
  "NONE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "WEEKDAYS",
] as const;

export const NOTIFICATION_KINDS = [
  "REMINDER",
  "DEADLINE",
  "ATTENDANCE",
  "HABIT",
  "PROJECT",
  "FINANCE",
  "SYSTEM",
  "PROACTIVE",
] as const;

export const NOTIFICATION_CHANNELS = [
  "IN_APP",
  "TELEGRAM",
  "EMAIL",
  "PUSH",
] as const;

export const CALENDAR_EVENT_KINDS = [
  "PERSONAL",
  "CLASS",
  "EXAM",
  "DEADLINE",
  "WORK",
  "SOCIAL",
  "TRAVEL",
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

const weekdaySchema = z.coerce.number().int().min(1).max(7);

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

const reminderFields = z.object({
  title: shortText(200, "Reminder"),
  message: optionalText(2000),
  remindDate: localDateSchema,
  remindTime: localTimeSchema,
  recurrence: z.enum(REMINDER_RECURRENCES).default("NONE"),
  weekdays: z
    .union([z.array(weekdaySchema), weekdaySchema.transform((day) => [day])])
    .default([]),
  recurUntilDate: localDateSchema.optional(),
  taskId: z.string().optional(),
  eventId: z.string().optional(),
  habitId: z.string().optional(),
});

/** A WEEKDAYS reminder with no days selected would never fire again. */
const requireDaysForWeekdays = (
  value: { recurrence?: string; weekdays?: readonly number[] },
  ctx: z.RefinementCtx,
): void => {
  if (value.recurrence === "WEEKDAYS" && (value.weekdays?.length ?? 0) === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["weekdays"],
      message: "Pick at least one day.",
    });
  }
};

export const createReminderSchema = reminderFields.superRefine(
  requireDaysForWeekdays,
);

export const updateReminderSchema = reminderFields
  .partial()
  .extend({ reminderId: idSchema })
  .superRefine(requireDaysForWeekdays);

export const reminderIdSchema = z.object({ reminderId: idSchema });

/**
 * Snoozes a reminder.
 *
 * Minutes rather than a target instant: "remind me in 10 minutes" is what a
 * user means, and computing the instant on the server avoids trusting a
 * client clock that may be wrong.
 */
export const snoozeReminderSchema = z.object({
  reminderId: idSchema,
  minutes: z.coerce.number().int().min(1).max(10080).default(10),
});

export const setReminderStatusSchema = z.object({
  reminderId: idSchema,
  status: z.enum(["SCHEDULED", "DISMISSED", "COMPLETED", "CANCELLED"]),
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationIdSchema = z.object({
  notificationId: idSchema,
});

export const markNotificationsReadSchema = z.object({
  /** Empty marks every unread notification read. */
  notificationIds: z.array(idSchema).default([]),
});

export const notificationPreferenceSchema = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  channel: z.enum(NOTIFICATION_CHANNELS).default("IN_APP"),
  isEnabled: z.boolean(),
});

export const notificationSettingsSchema = z
  .object({
    isQuietHoursEnabled: formBoolean(),
    quietHoursStart: z
      .union([z.literal(""), z.coerce.number().int().min(0).max(1439)])
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    quietHoursEnd: z
      .union([z.literal(""), z.coerce.number().int().min(0).max(1439)])
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    dailyLimit: z.coerce.number().int().min(0).max(200).default(20),
  })
  .superRefine((value, ctx) => {
    // Enabling quiet hours without a window would silence nothing while
    // implying it silences something.
    if (
      value.isQuietHoursEnabled &&
      (value.quietHoursStart === undefined || value.quietHoursEnd === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["quietHoursStart"],
        message: "Set both a start and an end time for quiet hours.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const eventFields = z.object({
  title: shortText(200, "Title"),
  description: optionalText(4000),
  location: optionalText(200),
  kind: z.enum(CALENDAR_EVENT_KINDS).default("PERSONAL"),
  startDate: localDateSchema,
  startTime: localTimeSchema.optional(),
  endDate: localDateSchema.optional(),
  endTime: localTimeSchema.optional(),
  isAllDay: formBoolean(),
  /**
   * Checked by default in the UI, so the browser sends "true" unless the user
   * clears it — at which point the key is absent and must mean false. A Zod
   * `.default(true)` would instead resurrect the box they just unchecked.
   */
  isBusy: formBoolean(),
  colorKey: optionalText(30),
});

/** An event that ends before it starts is not a typo worth accepting. */
const orderedEventTimes = (
  value: {
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    isAllDay?: boolean;
  },
  ctx: z.RefinementCtx,
): void => {
  if (!value.startDate) return;

  const endDate = value.endDate ?? value.startDate;

  if (endDate < value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The event must end after it starts.",
    });
    return;
  }

  if (
    !value.isAllDay &&
    endDate === value.startDate &&
    value.startTime &&
    value.endTime &&
    value.endTime <= value.startTime
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "The event must end after it starts.",
    });
  }
};

export const createEventSchema = eventFields.superRefine(orderedEventTimes);

export const updateEventSchema = eventFields
  .partial()
  .extend({ eventId: idSchema })
  .superRefine(orderedEventTimes);

export const eventIdSchema = z.object({ eventId: idSchema });

export const calendarRangeSchema = z.object({
  /** `YYYY-MM-DD`; the query resolves the window in the profile's zone. */
  date: localDateSchema.optional(),
  view: z.enum(["DAY", "WEEK", "MONTH", "AGENDA"]).default("WEEK"),
});

export const freeTimeSchema = z.object({
  date: localDateSchema,
  minimumMinutes: z.coerce.number().int().min(5).max(480).default(30),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type CalendarRange = z.infer<typeof calendarRangeSchema>;
