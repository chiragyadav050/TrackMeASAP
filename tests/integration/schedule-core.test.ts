import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import { sweepReminders } from "@/server/jobs";
import {
  createEvent,
  deleteEvent,
  setEventCancelled,
} from "@/services/schedule/calendar.service";
import {
  getCalendarView,
  getFreeTime,
  listReminders,
} from "@/services/schedule/calendar.query";
import {
  countUnread,
  enqueueNotification,
  getNotificationSettings,
  isChannelEnabled,
  markAllRead,
  markFailed,
  markRead,
  MAX_ATTEMPTS,
  saveNotificationSettings,
  setNotificationPreference,
} from "@/services/schedule/notification.service";
import {
  createReminder,
  fireReminder,
  findDueReminders,
  flushPendingNotifications,
  snoozeReminder,
} from "@/services/schedule/reminder.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Reminders, notifications and the calendar against a real database.
 *
 * The arithmetic is unit-tested in `schedule-derive.test.ts`; these tests
 * prove the parts that only a database can: that firing is IDEMPOTENT under a
 * unique index, that recurrence rearms the row, and that the calendar projects
 * five different sources onto one timeline without duplicating anything.
 */

let profile: Profile;

/** 2026-09-15, 10:00 in Kolkata (a Tuesday). */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);
const TODAY = "2026-09-15";

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const makeReminder = (overrides: Record<string, unknown> = {}) =>
  createReminder(profile.id, profile.timeZone, {
    title: "[TEST] Submit the lab report",
    remindDate: TODAY,
    remindTime: "09:00",
    recurrence: "NONE",
    weekdays: [],
    ...overrides,
  } as never);

const makeEvent = (overrides: Record<string, unknown> = {}) =>
  createEvent(profile.id, profile.timeZone, {
    title: "[TEST] Study group",
    kind: "PERSONAL",
    startDate: TODAY,
    startTime: "14:00",
    endTime: "16:00",
    isAllDay: false,
    isBusy: true,
    ...overrides,
  } as never);

/** Loads the one reminder for this profile. */
const reloadReminder = async (id: string) =>
  db.reminder.findUniqueOrThrow({ where: { id } });

describe("reminders", () => {
  test("a reminder is stored as an absolute instant in the profile's zone", async () => {
    const reminder = await makeReminder({ remindTime: "09:00" });

    // 09:00 in Kolkata is 03:30 UTC — the worker has no profile context, so
    // the conversion must already have happened on write.
    expect(reminder.remindAt.toISOString()).toBe("2026-09-15T03:30:00.000Z");
  });

  test("a due reminder is found; a future one is not", async () => {
    await makeReminder({ remindTime: "09:00" });
    await makeReminder({ title: "[TEST] Later", remindTime: "23:00" });

    const due = await findDueReminders(NOW);

    expect(due).toHaveLength(1);
    expect(due[0]?.title).toBe("[TEST] Submit the lab report");
  });

  test("firing creates a notification and closes a one-off reminder", async () => {
    const reminder = await makeReminder();
    const due = await findDueReminders(NOW);

    const result = await fireReminder(due[0]!, NOW);

    expect(result.created).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.nextAt).toBeNull();

    const reloaded = await reloadReminder(reminder.id);
    expect(reloaded.status).toBe("SENT");
    expect(reloaded.lastFiredAt).not.toBeNull();

    const notification = await db.notification.findUniqueOrThrow({
      where: { id: result.notificationId },
    });
    expect(notification.status).toBe("SENT");
    expect(notification.kind).toBe("REMINDER");
  });

  test("firing TWICE for the same instant produces ONE notification", async () => {
    const reminder = await makeReminder();
    const due = await findDueReminders(NOW);

    const first = await fireReminder(due[0]!, NOW);

    // Simulate a crashed worker retrying the same row.
    await db.reminder.update({
      where: { id: reminder.id },
      data: { status: "SCHEDULED" },
    });

    const second = await fireReminder(
      await db.reminder.findUniqueOrThrow({
        where: { id: reminder.id },
        include: { profile: true },
      }),
      NOW,
    );

    expect(second.created).toBe(false);
    expect(second.notificationId).toBe(first.notificationId);
    expect(
      await db.notification.count({ where: { profileId: profile.id } }),
    ).toBe(1);
  });

  test("a recurring reminder rearms at its next occurrence", async () => {
    const reminder = await makeReminder({ recurrence: "DAILY" });
    const due = await findDueReminders(NOW);

    const result = await fireReminder(due[0]!, NOW);

    expect(result.nextAt).not.toBeNull();

    const reloaded = await reloadReminder(reminder.id);
    expect(reloaded.status).toBe("SCHEDULED");
    // Tomorrow at the same local time.
    expect(reloaded.remindAt.toISOString()).toBe("2026-09-16T03:30:00.000Z");
  });

  test("…and produces a NEW notification the next day", async () => {
    const reminder = await makeReminder({ recurrence: "DAILY" });

    await fireReminder((await findDueReminders(NOW))[0]!, NOW);

    const tomorrow = instantFromLocalTime(2026, 9, 16, 10 * 60, TEST_TIME_ZONE);
    await fireReminder((await findDueReminders(tomorrow))[0]!, tomorrow);

    // The dedupe key includes the instant, so a legitimate second occurrence
    // is not swallowed as a duplicate.
    expect(
      await db.notification.count({ where: { profileId: profile.id } }),
    ).toBe(2);

    expect((await reloadReminder(reminder.id)).status).toBe("SCHEDULED");
  });

  test("recurrence stops at recurUntil", async () => {
    const reminder = await makeReminder({
      recurrence: "DAILY",
      recurUntilDate: TODAY,
    });

    const result = await fireReminder((await findDueReminders(NOW))[0]!, NOW);

    expect(result.nextAt).toBeNull();
    expect((await reloadReminder(reminder.id)).status).toBe("SENT");
  });

  test("snoozing defers firing without losing the original time", async () => {
    const reminder = await makeReminder();

    await snoozeReminder(profile.id, reminder.id, 60, NOW);

    const reloaded = await reloadReminder(reminder.id);
    expect(reloaded.status).toBe("SNOOZED");
    expect(reloaded.snoozedUntil).not.toBeNull();
    // The original intent survives — recurrence still advances from it.
    expect(reloaded.remindAt.toISOString()).toBe("2026-09-15T03:30:00.000Z");

    // Not due yet at NOW…
    expect(await findDueReminders(NOW)).toHaveLength(0);

    // …but due once the snooze elapses.
    const later = new Date(NOW.getTime() + 61 * 60_000);
    expect(await findDueReminders(later)).toHaveLength(1);
  });

  test("the sweep isolates failures and reports honest counts", async () => {
    await makeReminder();
    await makeReminder({ title: "[TEST] Second", remindTime: "08:00" });

    const result = await sweepReminders(NOW);

    expect(result).toEqual({
      examined: 2,
      fired: 2,
      deduped: 0,
      delivered: 2,
      failed: 0,
    });
  });

  test("a second sweep of the same instant reports deduped, not fired", async () => {
    await makeReminder({ recurrence: "NONE" });
    await sweepReminders(NOW);

    await db.reminder.updateMany({
      where: { profileId: profile.id },
      data: { status: "SCHEDULED" },
    });

    const second = await sweepReminders(NOW);

    expect(second.fired).toBe(0);
    expect(second.deduped).toBe(1);
  });

  test("the reminder list exposes fire time and overdue state", async () => {
    await makeReminder({ remindTime: "09:00" });

    const [listed] = await listReminders(profile, {}, NOW);

    expect(listed?.isOverdue).toBe(true);
    expect(listed?.timeLabel).toBe("09:00");
    expect(listed?.remindDateInput).toBe(TODAY);
  });
});

describe("notification delivery rules", () => {
  test("quiet hours HOLD a notification rather than dropping it", async () => {
    await saveNotificationSettings(profile.id, {
      isQuietHoursEnabled: true,
      quietHoursStart: 22 * 60,
      quietHoursEnd: 7 * 60,

      dailyLimit: 20,
    });

    // 03:00 local — inside the overnight window.
    const nightTime = instantFromLocalTime(2026, 9, 15, 3 * 60, TEST_TIME_ZONE);
    await makeReminder({ remindTime: "03:00" });

    const result = await fireReminder(
      (await findDueReminders(nightTime))[0]!,
      nightTime,
    );

    expect(result.created).toBe(true);
    expect(result.delivered).toBe(false);

    const notification = await db.notification.findUniqueOrThrow({
      where: { id: result.notificationId },
    });
    expect(notification.status).toBe("PENDING");

    // …and it goes out once quiet hours end.
    const morning = instantFromLocalTime(2026, 9, 15, 9 * 60, TEST_TIME_ZONE);
    const flush = await flushPendingNotifications(morning);

    expect(flush.sent).toBe(1);
    expect(
      (
        await db.notification.findUniqueOrThrow({
          where: { id: notification.id },
        })
      ).status,
    ).toBe("SENT");
  });

  test("the daily limit holds further notifications", async () => {
    await saveNotificationSettings(profile.id, {
      isQuietHoursEnabled: false,
      dailyLimit: 1,
    });

    await makeReminder({ remindTime: "08:00" });
    await makeReminder({ title: "[TEST] Second", remindTime: "08:30" });

    const result = await sweepReminders(NOW);

    expect(result.fired).toBe(2);
    // Both alerts exist; only one was delivered.
    expect(result.delivered).toBe(1);
    expect(
      await db.notification.count({
        where: { profileId: profile.id, status: "PENDING" },
      }),
    ).toBe(1);
  });

  test("a disabled channel blocks delivery but still records the alert", async () => {
    await setNotificationPreference(profile.id, "REMINDER", "IN_APP", false);
    await makeReminder();

    const result = await fireReminder((await findDueReminders(NOW))[0]!, NOW);

    expect(result.created).toBe(true);
    expect(result.delivered).toBe(false);
  });

  test("an absent preference row means ENABLED, not disabled", async () => {
    // A kind added in a later phase must not arrive silently switched off.
    expect(await isChannelEnabled(profile.id, "PROACTIVE", "IN_APP")).toBe(
      true,
    );
  });

  test("default settings apply before anything is saved", async () => {
    const settings = await getNotificationSettings(profile.id);

    expect(settings.isQuietHoursEnabled).toBe(false);
    expect(settings.dailyLimit).toBe(20);
  });

  test("repeated failures eventually stop retrying", async () => {
    const { notification } = await enqueueNotification({
      profileId: profile.id,
      kind: "SYSTEM",
      title: "[TEST] Flaky",
      dedupeKey: "test:flaky",
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await markFailed(notification.id, "upstream timeout");
    }

    const reloaded = await db.notification.findUniqueOrThrow({
      where: { id: notification.id },
    });

    expect(reloaded.attempts).toBe(MAX_ATTEMPTS);
    expect(reloaded.status).toBe("FAILED");
  });

  test("enqueueing the same key twice returns the same row", async () => {
    const first = await enqueueNotification({
      profileId: profile.id,
      kind: "SYSTEM",
      title: "[TEST] Once",
      dedupeKey: "test:once",
    });

    const second = await enqueueNotification({
      profileId: profile.id,
      kind: "SYSTEM",
      title: "[TEST] Once",
      dedupeKey: "test:once",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.notification.id).toBe(first.notification.id);
  });

  test("unread counts and mark-read behave", async () => {
    const { notification } = await enqueueNotification({
      profileId: profile.id,
      kind: "SYSTEM",
      title: "[TEST] Unread",
      dedupeKey: "test:unread",
    });

    expect(await countUnread(profile.id)).toBe(1);

    await markRead(profile.id, notification.id);
    expect(await countUnread(profile.id)).toBe(0);

    await enqueueNotification({
      profileId: profile.id,
      kind: "SYSTEM",
      title: "[TEST] Another",
      dedupeKey: "test:another",
    });

    expect(await markAllRead(profile.id)).toBe(1);
    expect(await countUnread(profile.id)).toBe(0);
  });
});

describe("calendar", () => {
  test("an event appears on the day it starts", async () => {
    await makeEvent();

    const view = await getCalendarView(profile, TODAY, "DAY", NOW);

    expect(view.totalEntries).toBe(1);
    expect(view.days[0]?.entries[0]?.title).toBe("[TEST] Study group");
    expect(view.days[0]?.entries[0]?.timeLabel).toBe("14:00–16:00");
  });

  test("an all-day event ends at local midnight the following day", async () => {
    const event = await makeEvent({
      isAllDay: true,
      startDate: TODAY,
      endDate: TODAY,
    });

    // Exclusive end — that is what makes a one-day event exactly one day.
    expect(event.endAt.getTime() - event.startAt.getTime()).toBe(86_400_000);
  });

  test("a timed event with no end time defaults to an hour", async () => {
    // A zero-length block would vanish from every view and conflict with
    // nothing.
    const event = await makeEvent({ endTime: undefined });

    expect(event.endAt.getTime() - event.startAt.getTime()).toBe(3_600_000);
  });

  test("overlapping busy events are reported as a conflict", async () => {
    await makeEvent({ startTime: "14:00", endTime: "16:00" });
    await makeEvent({
      title: "[TEST] Overlap",
      startTime: "15:00",
      endTime: "17:00",
    });

    const view = await getCalendarView(profile, TODAY, "DAY", NOW);

    expect(view.conflicts).toHaveLength(1);
    expect(view.conflicts[0]?.overlapMinutes).toBe(60);
  });

  test("back-to-back events are NOT a conflict", async () => {
    await makeEvent({ startTime: "14:00", endTime: "15:00" });
    await makeEvent({
      title: "[TEST] Next",
      startTime: "15:00",
      endTime: "16:00",
    });

    const view = await getCalendarView(profile, TODAY, "DAY", NOW);

    expect(view.conflicts).toHaveLength(0);
  });

  test("a non-busy event never conflicts", async () => {
    await makeEvent({ startTime: "14:00", endTime: "16:00" });
    await makeEvent({
      title: "[TEST] Tentative",
      startTime: "15:00",
      endTime: "17:00",
      isBusy: false,
    });

    expect(
      (await getCalendarView(profile, TODAY, "DAY", NOW)).conflicts,
    ).toHaveLength(0);
  });

  test("task deadlines appear but do NOT occupy time", async () => {
    await db.task.create({
      data: {
        profileId: profile.id,
        title: "[TEST] Due today",
        position: 0,
        dueAt: instantFromLocalTime(2026, 9, 15, 15 * 60, TEST_TIME_ZONE),
      },
    });

    await makeEvent({ startTime: "14:00", endTime: "17:00" });

    const view = await getCalendarView(profile, TODAY, "DAY", NOW);

    expect(view.totalEntries).toBe(2);
    // A deadline is a moment, not a block. Marking it busy would make every
    // due date conflict with the time booked to do it in.
    expect(view.conflicts).toHaveLength(0);
  });

  test("a cancelled event leaves the calendar and can return", async () => {
    const event = await makeEvent();

    await setEventCancelled(profile.id, event.id, true);
    expect(
      (await getCalendarView(profile, TODAY, "DAY", NOW)).totalEntries,
    ).toBe(0);

    await setEventCancelled(profile.id, event.id, false);
    expect(
      (await getCalendarView(profile, TODAY, "DAY", NOW)).totalEntries,
    ).toBe(1);
  });

  test("deleting an event keeps a reminder that pointed at it", async () => {
    const event = await makeEvent();
    const reminder = await makeReminder({ eventId: event.id });

    await deleteEvent(profile.id, event.id);

    const reloaded = await reloadReminder(reminder.id);
    expect(reloaded.eventId).toBeNull();
    expect(reloaded.title).toBe("[TEST] Submit the lab report");
  });

  test("the week view covers seven days", async () => {
    const view = await getCalendarView(profile, TODAY, "WEEK", NOW);

    expect(view.days).toHaveLength(7);
    expect(view.days.some((day) => day.isToday)).toBe(true);
  });

  test("an empty calendar is empty, not broken", async () => {
    const view = await getCalendarView(profile, TODAY, "WEEK", NOW);

    expect(view.totalEntries).toBe(0);
    expect(view.conflicts).toHaveLength(0);
  });
});

describe("free time", () => {
  test("finds the gaps inside working hours", async () => {
    // The default profile works 09:00–17:00.
    await makeEvent({ startTime: "10:00", endTime: "11:00" });

    const slots = await getFreeTime(profile, TODAY, 30, NOW);

    expect(slots.map((slot) => slot.minutes)).toEqual([60, 360]);
    expect(slots[0]?.label).toBe("09:00–10:00");
  });

  test("a fully booked day has no slots", async () => {
    await makeEvent({ startTime: "09:00", endTime: "17:00" });

    expect(await getFreeTime(profile, TODAY, 30, NOW)).toHaveLength(0);
  });

  test("deadlines do not consume free time", async () => {
    await db.task.create({
      data: {
        profileId: profile.id,
        title: "[TEST] Due today",
        position: 0,
        dueAt: instantFromLocalTime(2026, 9, 15, 12 * 60, TEST_TIME_ZONE),
      },
    });

    const slots = await getFreeTime(profile, TODAY, 30, NOW);

    // A day with a deadline and no meetings is a free day.
    expect(slots).toHaveLength(1);
    expect(slots[0]?.minutes).toBe(480);
  });
});
