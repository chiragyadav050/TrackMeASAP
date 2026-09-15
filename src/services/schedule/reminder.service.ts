import "server-only";

import type { Prisma, Profile, Reminder } from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { addLocalDays } from "@/lib/time";
import { db } from "@/server/db";
import { toInstant } from "@/services/academics/academic.dates";
import { recordActivity } from "@/services/activity/activity.service";
import {
  buildDedupeKey,
  nextOccurrence,
} from "@/services/schedule/schedule.derive";
import {
  enqueueNotification,
  evaluateDelivery,
  markSent,
} from "@/services/schedule/notification.service";
import type { z } from "zod";
import type {
  CreateReminderInput,
  updateReminderSchema,
} from "@/services/schedule/schedule.schema";

/**
 * Reminder mutations and firing.
 *
 * `remindAt` is an ABSOLUTE instant. "Remind me at 7pm" means 7pm where the
 * user is, and the worker that fires it has no profile context — so the
 * conversion happens once, here, on write, using the profile's zone.
 */

const log = logger.child({ service: "reminder" });

export const ENTITY_REMINDER = "reminder";

export async function requireOwnedReminder(
  profileId: string,
  reminderId: string,
): Promise<Reminder> {
  const reminder = await db.reminder.findFirst({
    where: { id: reminderId, profileId },
  });

  if (!reminder) {
    throw notFound("Reminder");
  }

  return reminder;
}

/** Validates that every linked record belongs to the caller. */
async function assertOwnedLinks(
  profileId: string,
  links: { taskId?: string; eventId?: string; habitId?: string },
): Promise<void> {
  if (links.taskId) {
    const task = await db.task.findFirst({
      where: { id: links.taskId, profileId },
      select: { id: true },
    });

    if (!task) throw notFound("Task");
  }

  if (links.eventId) {
    const event = await db.calendarEvent.findFirst({
      where: { id: links.eventId, profileId },
      select: { id: true },
    });

    if (!event) throw notFound("Event");
  }

  if (links.habitId) {
    const habit = await db.habit.findFirst({
      where: { id: links.habitId, profileId },
      select: { id: true },
    });

    if (!habit) throw notFound("Habit");
  }
}

function normaliseWeekdays(
  recurrence: Reminder["recurrence"],
  weekdays: readonly number[] | undefined,
): number[] {
  if (recurrence !== "WEEKDAYS") {
    return [];
  }

  return [...new Set(weekdays ?? [])].sort((a, b) => a - b);
}

export async function createReminder(
  profileId: string,
  timeZone: string,
  input: CreateReminderInput,
): Promise<Reminder> {
  await assertOwnedLinks(profileId, input);

  const reminder = await db.reminder.create({
    data: {
      profileId,
      title: input.title,
      message: input.message ?? null,
      remindAt: toInstant(input.remindDate, input.remindTime, timeZone),
      recurrence: input.recurrence,
      weekdays: normaliseWeekdays(input.recurrence, input.weekdays),
      // End of the chosen day, so a reminder due that day still fires.
      recurUntil: input.recurUntilDate
        ? toInstant(input.recurUntilDate, "23:59", timeZone)
        : null,
      taskId: input.taskId || null,
      eventId: input.eventId || null,
      habitId: input.habitId || null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_REMINDER,
    entityId: reminder.id,
    action: "CREATED",
  });

  return reminder;
}

export async function updateReminder(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateReminderSchema>,
): Promise<Reminder> {
  const existing = await requireOwnedReminder(profileId, input.reminderId);

  await assertOwnedLinks(profileId, input);

  const data: Prisma.ReminderUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.message !== undefined) data.message = input.message ?? null;

  if (input.remindDate && input.remindTime) {
    data.remindAt = toInstant(input.remindDate, input.remindTime, timeZone);
    // Rescheduling revives a fired or dismissed reminder; otherwise the new
    // time would be stored on a row the worker no longer looks at.
    data.status = "SCHEDULED";
    data.snoozedUntil = null;
  }

  const recurrence = input.recurrence ?? existing.recurrence;

  if (input.recurrence !== undefined || input.weekdays !== undefined) {
    data.recurrence = recurrence;
    data.weekdays = normaliseWeekdays(
      recurrence,
      input.weekdays ?? existing.weekdays,
    );
  }

  if (input.recurUntilDate) {
    data.recurUntil = toInstant(input.recurUntilDate, "23:59", timeZone);
  }

  return db.reminder.update({ where: { id: existing.id }, data });
}

/**
 * Pushes a reminder forward by N minutes.
 *
 * The target instant is computed on the SERVER from the current time, not
 * accepted from the client — a browser with a wrong clock would otherwise be
 * able to schedule a reminder into the past or the far future.
 */
export async function snoozeReminder(
  profileId: string,
  reminderId: string,
  minutes: number,
  now: Date = new Date(),
): Promise<Reminder> {
  const existing = await requireOwnedReminder(profileId, reminderId);

  const snoozedUntil = new Date(now.getTime() + minutes * 60_000);

  return db.reminder.update({
    where: { id: existing.id },
    data: {
      status: "SNOOZED",
      snoozedUntil,
      // `remindAt` is deliberately untouched: the original intent is still
      // the thing that recurrence advances from.
    },
  });
}

export async function setReminderStatus(
  profileId: string,
  reminderId: string,
  status: Reminder["status"],
): Promise<Reminder> {
  const existing = await requireOwnedReminder(profileId, reminderId);

  return db.reminder.update({
    where: { id: existing.id },
    data: {
      status,
      ...(status === "SCHEDULED" ? { snoozedUntil: null } : {}),
    },
  });
}

export async function deleteReminder(
  profileId: string,
  reminderId: string,
): Promise<void> {
  const existing = await requireOwnedReminder(profileId, reminderId);

  await db.reminder.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_REMINDER,
    entityId: existing.id,
    action: "DELETED",
    metadata: { title: existing.title.slice(0, 60) },
  });
}

/**
 * Reminders that are due to fire at or before `now`.
 *
 * A SNOOZED reminder is due at `snoozedUntil`; a SCHEDULED one at `remindAt`.
 * Bounded by `limit` so one sweep cannot pull an unbounded backlog into
 * memory after an outage.
 */
export async function findDueReminders(
  now: Date = new Date(),
  limit = 100,
): Promise<readonly (Reminder & { profile: Profile })[]> {
  return db.reminder.findMany({
    where: {
      OR: [
        { status: "SCHEDULED", remindAt: { lte: now } },
        { status: "SNOOZED", snoozedUntil: { lte: now } },
      ],
    },
    include: { profile: true },
    orderBy: { remindAt: "asc" },
    take: limit,
  });
}

/**
 * Fires one reminder: creates its notification and advances or closes it.
 *
 * IDEMPOTENT. The dedupe key includes the exact instant the reminder fired
 * for, so a retry after a crash — or a second worker processing the same row —
 * produces the same key and therefore the same single notification.
 *
 * Returns what actually happened, so a caller's metrics can distinguish a
 * real send from a de-duplicated retry.
 */
export async function fireReminder(
  reminder: Reminder & { profile: Profile },
  now: Date = new Date(),
): Promise<{
  readonly notificationId: string;
  readonly created: boolean;
  readonly delivered: boolean;
  readonly nextAt: Date | null;
}> {
  const firedFor = reminder.snoozedUntil ?? reminder.remindAt;

  const { notification, created } = await enqueueNotification({
    profileId: reminder.profileId,
    kind: "REMINDER",
    title: reminder.title,
    body: reminder.message,
    href: "/calendar",
    // The instant is part of the identity: a DAILY reminder legitimately
    // fires again tomorrow and must produce a NEW notification, while a retry
    // for the same instant must not.
    dedupeKey: buildDedupeKey([
      "reminder",
      reminder.id,
      firedFor.toISOString(),
    ]),
    scheduledFor: firedFor,
    reminderId: reminder.id,
  });

  let delivered = false;

  if (created) {
    const decision = await evaluateDelivery(
      reminder.profile,
      notification,
      now,
    );

    if (decision.allow) {
      await markSent(notification.id);
      delivered = true;
    } else {
      // Held, not dropped. It stays PENDING for the next sweep.
      log.info("Reminder held", {
        reminderId: reminder.id,
        reason: decision.reason,
      });
    }
  }

  const nextAt = nextOccurrence(
    reminder.remindAt,
    {
      recurrence: reminder.recurrence,
      weekdays: reminder.weekdays,
      recurUntil: reminder.recurUntil,
    },
    {
      addDays: (date, days) =>
        addLocalDays(date, reminder.profile.timeZone, days),
      addMonths: (date, months) => {
        const next = new Date(date.getTime());
        next.setUTCMonth(next.getUTCMonth() + months);
        return next;
      },
      addYears: (date, years) => {
        const next = new Date(date.getTime());
        next.setUTCFullYear(next.getUTCFullYear() + years);
        return next;
      },
      weekdayOf: (date) => {
        const day = new Date(date.getTime()).getUTCDay();
        return day === 0 ? 7 : day;
      },
    },
  );

  await db.reminder.update({
    where: { id: reminder.id },
    data: {
      lastFiredAt: now,
      snoozedUntil: null,
      // A recurring reminder rearms at its next occurrence; a one-off is done.
      ...(nextAt
        ? { remindAt: nextAt, status: "SCHEDULED" as const }
        : { status: "SENT" as const }),
    },
  });

  return {
    notificationId: notification.id,
    created,
    delivered,
    nextAt,
  };
}

/**
 * Retries notifications that were held or failed.
 *
 * Quiet hours end, the daily limit resets at local midnight, and a transient
 * send failure clears — so PENDING rows are re-evaluated rather than
 * abandoned.
 */
export async function flushPendingNotifications(
  now: Date = new Date(),
  limit = 200,
): Promise<{ readonly sent: number; readonly held: number }> {
  const pending = await db.notification.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    include: { profile: true },
    orderBy: { scheduledFor: "asc" },
    take: limit,
  });

  let sent = 0;
  let held = 0;

  for (const notification of pending) {
    const decision = await evaluateDelivery(
      notification.profile,
      notification,
      now,
    );

    if (decision.allow) {
      await markSent(notification.id);
      sent += 1;
      continue;
    }

    held += 1;
  }

  return { sent, held };
}
