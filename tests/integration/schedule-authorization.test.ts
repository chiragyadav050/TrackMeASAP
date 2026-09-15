import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type {
  CalendarEvent,
  Notification,
  Profile,
  Reminder,
} from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { db } from "@/server/db";
import { sweepReminders } from "@/server/jobs";
import {
  createEvent,
  deleteEvent,
  requireOwnedEvent,
  setEventCancelled,
  updateEvent,
} from "@/services/schedule/calendar.service";
import {
  getCalendarView,
  getFreeTime,
  listNotifications,
  listReminders,
} from "@/services/schedule/calendar.query";
import {
  countUnread,
  dismissNotification,
  enqueueNotification,
  getNotificationSettings,
  markAllRead,
  markRead,
  saveNotificationSettings,
} from "@/services/schedule/notification.service";
import {
  createReminder,
  deleteReminder,
  requireOwnedReminder,
  setReminderStatus,
  snoozeReminder,
  updateReminder,
} from "@/services/schedule/reminder.service";
import { cleanupTestData, createTestProfile, disconnect } from "./helpers";

/**
 * Cross-user isolation for Phase 6.
 *
 * Reminders and notifications are the highest-stakes surface in the app for
 * this: a leak here does not merely show someone else's data on a screen, it
 * PUSHES it to a device. Every refusal must be NOT_FOUND, never FORBIDDEN.
 */

let owner: Profile;
let intruder: Profile;
let reminder: Reminder;
let event: CalendarEvent;
let notification: Notification;

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

  reminder = await createReminder(owner.id, owner.timeZone, {
    title: "[TEST] Owner reminder",
    remindDate: TODAY,
    remindTime: "09:00",
    recurrence: "NONE",
    weekdays: [],
  } as never);

  event = await createEvent(owner.id, owner.timeZone, {
    title: "[TEST] Owner event",
    kind: "PERSONAL",
    startDate: TODAY,
    startTime: "14:00",
    endTime: "16:00",
    isAllDay: false,
    isBusy: true,
  } as never);

  notification = (
    await enqueueNotification({
      profileId: owner.id,
      kind: "SYSTEM",
      title: "[TEST] Owner notification",
      dedupeKey: "owner:alert",
    })
  ).notification;
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("ownership guards", () => {
  test("reminder and event guards report NOT_FOUND for another user", async () => {
    await expectNotFound(requireOwnedReminder(intruder.id, reminder.id));
    await expectNotFound(requireOwnedEvent(intruder.id, event.id));
  });
});

describe("reads are scoped to the caller", () => {
  test("another user's reminders, events and notifications are invisible", async () => {
    expect(await listReminders(intruder)).toHaveLength(0);
    expect(await listNotifications(intruder)).toHaveLength(0);
    expect(await countUnread(intruder.id)).toBe(0);

    const view = await getCalendarView(intruder, TODAY, "DAY");
    expect(view.totalEntries).toBe(0);
  });

  test("another user's events do not consume your free time", async () => {
    // The owner is booked 14:00–16:00; the intruder's day must read as free.
    const slots = await getFreeTime(intruder, TODAY, 30);

    expect(slots).toHaveLength(1);
    expect(slots[0]?.minutes).toBe(480);
  });

  test("another user's events cannot create conflicts on your calendar", async () => {
    await createEvent(intruder.id, intruder.timeZone, {
      title: "[TEST] Intruder event",
      kind: "PERSONAL",
      startDate: TODAY,
      startTime: "14:00",
      endTime: "16:00",
      isAllDay: false,
      isBusy: true,
    } as never);

    // Same time, different owner — not a conflict.
    expect(
      (await getCalendarView(intruder, TODAY, "DAY")).conflicts,
    ).toHaveLength(0);
    expect((await getCalendarView(owner, TODAY, "DAY")).conflicts).toHaveLength(
      0,
    );
  });

  test("notification settings are per profile", async () => {
    await saveNotificationSettings(owner.id, {
      isQuietHoursEnabled: true,
      quietHoursStart: 22 * 60,
      quietHoursEnd: 7 * 60,
      dailyLimit: 3,
    });

    const theirs = await getNotificationSettings(intruder.id);

    expect(theirs.isQuietHoursEnabled).toBe(false);
    expect(theirs.dailyLimit).toBe(20);
  });
});

describe("writes are rejected", () => {
  test("reminder mutations", async () => {
    await expectNotFound(
      updateReminder(intruder.id, intruder.timeZone, {
        reminderId: reminder.id,
        title: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(snoozeReminder(intruder.id, reminder.id, 60));
    await expectNotFound(
      setReminderStatus(intruder.id, reminder.id, "CANCELLED"),
    );
    await expectNotFound(deleteReminder(intruder.id, reminder.id));

    const untouched = await db.reminder.findUnique({
      where: { id: reminder.id },
    });
    expect(untouched?.title).toBe("[TEST] Owner reminder");
    expect(untouched?.status).toBe("SCHEDULED");
    expect(untouched?.snoozedUntil).toBeNull();
  });

  test("event mutations", async () => {
    await expectNotFound(
      updateEvent(intruder.id, intruder.timeZone, {
        eventId: event.id,
        title: "[TEST] Hijacked",
      } as never),
    );
    await expectNotFound(setEventCancelled(intruder.id, event.id, true));
    await expectNotFound(deleteEvent(intruder.id, event.id));

    const untouched = await db.calendarEvent.findUnique({
      where: { id: event.id },
    });
    expect(untouched?.title).toBe("[TEST] Owner event");
    expect(untouched?.cancelledAt).toBeNull();
  });

  test("notification mutations", async () => {
    await expectNotFound(markRead(intruder.id, notification.id));
    await expectNotFound(dismissNotification(intruder.id, notification.id));

    const untouched = await db.notification.findUnique({
      where: { id: notification.id },
    });
    expect(untouched?.readAt).toBeNull();
  });

  test("mark-all-read cannot reach across profiles", async () => {
    // A valid id belonging to someone else, passed explicitly.
    const count = await markAllRead(intruder.id, [notification.id]);

    expect(count).toBe(0);
    expect(
      (
        await db.notification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).readAt,
    ).toBeNull();
  });
});

describe("cross-owner grafting", () => {
  test("a reminder cannot be attached to another user's task", async () => {
    const ownerTask = await db.task.create({
      data: { profileId: owner.id, title: "[TEST] Owner task", position: 0 },
    });

    await expectNotFound(
      createReminder(intruder.id, intruder.timeZone, {
        title: "[TEST] Smuggled",
        remindDate: TODAY,
        remindTime: "09:00",
        recurrence: "NONE",
        weekdays: [],
        taskId: ownerTask.id,
      } as never),
    );

    expect(await db.reminder.count({ where: { taskId: ownerTask.id } })).toBe(
      0,
    );
  });

  test("a reminder cannot be attached to another user's event or habit", async () => {
    await expectNotFound(
      createReminder(intruder.id, intruder.timeZone, {
        title: "[TEST] Smuggled",
        remindDate: TODAY,
        remindTime: "09:00",
        recurrence: "NONE",
        weekdays: [],
        eventId: event.id,
      } as never),
    );

    const ownerHabit = await db.habit.create({
      data: {
        profileId: owner.id,
        name: "[TEST] Owner habit",
        startDate: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    await expectNotFound(
      createReminder(intruder.id, intruder.timeZone, {
        title: "[TEST] Smuggled",
        remindDate: TODAY,
        remindTime: "09:00",
        recurrence: "NONE",
        weekdays: [],
        habitId: ownerHabit.id,
      } as never),
    );
  });

  test("their OWN reminder cannot be re-pointed at another user's task", async () => {
    const theirReminder = await createReminder(intruder.id, intruder.timeZone, {
      title: "[TEST] Intruder reminder",
      remindDate: TODAY,
      remindTime: "09:00",
      recurrence: "NONE",
      weekdays: [],
    } as never);

    const ownerTask = await db.task.create({
      data: { profileId: owner.id, title: "[TEST] Owner task", position: 0 },
    });

    await expectNotFound(
      updateReminder(intruder.id, intruder.timeZone, {
        reminderId: theirReminder.id,
        taskId: ownerTask.id,
      } as never),
    );
  });
});

describe("the worker respects ownership", () => {
  test("a sweep delivers each notification to its own profile", async () => {
    await createReminder(intruder.id, intruder.timeZone, {
      title: "[TEST] Intruder reminder",
      remindDate: TODAY,
      remindTime: "09:00",
      recurrence: "NONE",
      weekdays: [],
    } as never);

    const now = new Date("2026-09-15T06:00:00.000Z");
    const result = await sweepReminders(now);

    expect(result.examined).toBe(2);
    expect(result.fired).toBe(2);

    // Two reminders, two notifications, one per owner — no crossover.
    const ownerAlerts = await db.notification.findMany({
      where: { profileId: owner.id, kind: "REMINDER" },
    });
    const intruderAlerts = await db.notification.findMany({
      where: { profileId: intruder.id, kind: "REMINDER" },
    });

    expect(ownerAlerts).toHaveLength(1);
    expect(intruderAlerts).toHaveLength(1);
    expect(ownerAlerts[0]?.title).toBe("[TEST] Owner reminder");
    expect(intruderAlerts[0]?.title).toBe("[TEST] Intruder reminder");
  });

  test("the same dedupe key for different profiles is not a collision", async () => {
    // The unique index is (profileId, dedupeKey) — two users can legitimately
    // have the same logical alert.
    const first = await enqueueNotification({
      profileId: owner.id,
      kind: "SYSTEM",
      title: "[TEST] Shared key",
      dedupeKey: "shared:key",
    });

    const second = await enqueueNotification({
      profileId: intruder.id,
      kind: "SYSTEM",
      title: "[TEST] Shared key",
      dedupeKey: "shared:key",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.notification.id).not.toBe(first.notification.id);
  });
});
