import "server-only";

import type { Profile } from "@/generated/prisma/client";
import {
  formatInTimeZone,
  localDateKey,
  localTimeKey,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  eachLocalDate,
  isoWeekdayOf,
  toDateOnly,
} from "@/services/academics/academic.dates";
import {
  busyMinutesIn,
  findConflicts,
  findFreeSlots,
  type TimeBlock,
} from "@/services/schedule/schedule.derive";
import type {
  CalendarDayDto,
  CalendarEntryDto,
  CalendarViewDto,
  ConflictDto,
  FreeSlotDto,
  ReminderDto,
} from "@/types/schedule";

/**
 * Calendar reads.
 *
 * ONE TIMELINE, MANY SOURCES. Classes, assignment deadlines, exams and
 * personal events are separate records with separate rules, but a user's
 * Tuesday is a single thing. This module projects all of them into one
 * `CalendarEntryDto` shape so the view never has to know where a block came
 * from — and so conflict detection sees a class and a meeting as equally real.
 *
 * Nothing here duplicates data: coursework is PROJECTED at read time, never
 * copied into `calendar_events`, so editing a class in Academics cannot leave
 * a stale copy on the calendar.
 */

/** An exam with no stated duration still occupies real time. */
const DEFAULT_EXAM_MINUTES = 60;

/** Resolves the window a view covers, in the profile's zone. */
function resolveWindow(
  profile: Profile,
  anchorKey: string,
  view: "DAY" | "WEEK" | "MONTH" | "AGENDA",
): { startAt: Date; endAt: Date; dayKeys: string[] } {
  const anchor = toDateOnly(anchorKey);

  if (view === "DAY") {
    const startAt = startOfLocalDay(anchor, profile.timeZone);
    return {
      startAt,
      endAt: startOfLocalDayOffset(anchor, profile.timeZone, 1),
      dayKeys: [anchorKey],
    };
  }

  if (view === "MONTH") {
    const first = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1),
    );
    const last = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0),
    );

    return {
      startAt: startOfLocalDay(first, profile.timeZone),
      endAt: startOfLocalDayOffset(last, profile.timeZone, 1),
      dayKeys: eachLocalDate(
        first.toISOString().slice(0, 10),
        last.toISOString().slice(0, 10),
      ),
    };
  }

  // WEEK and AGENDA both cover seven days; AGENDA starts from the anchor
  // rather than the week boundary, because "what's next" is not "this week".
  if (view === "AGENDA") {
    const dayKeys = eachLocalDate(
      anchorKey,
      new Date(anchor.getTime() + 6 * 86_400_000).toISOString().slice(0, 10),
    );

    return {
      startAt: startOfLocalDay(anchor, profile.timeZone),
      endAt: startOfLocalDayOffset(anchor, profile.timeZone, 7),
      dayKeys,
    };
  }

  const weekday = isoWeekdayOf(anchorKey);
  const offset = profile.weekStart === "MONDAY" ? weekday - 1 : weekday % 7;

  const start = new Date(anchor.getTime() - offset * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);

  return {
    startAt: startOfLocalDay(start, profile.timeZone),
    endAt: startOfLocalDayOffset(start, profile.timeZone, 7),
    dayKeys: eachLocalDate(
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    ),
  };
}

function timeLabel(
  entry: { startAt: Date; endAt: Date; isAllDay: boolean },
  profile: Profile,
): string {
  if (entry.isAllDay) {
    return "All day";
  }

  return `${localTimeKey(entry.startAt, profile.timeZone)}–${localTimeKey(
    entry.endAt,
    profile.timeZone,
  )}`;
}

/**
 * Every block in a window, from every source, on one timeline.
 */
export async function getCalendarView(
  profile: Profile,
  anchorKey: string,
  view: "DAY" | "WEEK" | "MONTH" | "AGENDA" = "WEEK",
  now: Date = new Date(),
): Promise<CalendarViewDto> {
  const window = resolveWindow(profile, anchorKey, view);
  const range = { gte: window.startAt, lt: window.endAt };

  // Five parallel reads rather than five sequential ones — the window is the
  // same for all of them and none depends on another.
  const [events, classes, assignments, exams, tasks] = await Promise.all([
    db.calendarEvent.findMany({
      where: { profileId: profile.id, startAt: range, cancelledAt: null },
      orderBy: { startAt: "asc" },
    }),
    db.classSession.findMany({
      where: {
        profileId: profile.id,
        startAt: range,
        status: { not: "CANCELLED" },
      },
      include: { subject: { select: { name: true, colorKey: true } } },
      orderBy: { startAt: "asc" },
    }),
    db.assignment.findMany({
      where: { profileId: profile.id, dueAt: range, archivedAt: null },
      include: { subject: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
    }),
    db.exam.findMany({
      where: { profileId: profile.id, startAt: range },
      include: { subject: { select: { name: true } } },
      orderBy: { startAt: "asc" },
    }),
    db.task.findMany({
      where: {
        profileId: profile.id,
        dueAt: range,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      orderBy: { dueAt: "asc" },
      take: 200,
    }),
  ]);

  const entries: CalendarEntryDto[] = [];

  for (const event of events) {
    entries.push({
      id: event.id,
      source: "EVENT",
      sourceId: event.id,
      title: event.title,
      subtitle: event.location,
      kind: event.kind,
      startAt: event.startAt,
      endAt: event.endAt,
      isAllDay: event.isAllDay,
      isBusy: event.isBusy,
      dayKey: localDateKey(event.startAt, profile.timeZone),
      timeLabel: timeLabel(event, profile),
      colorKey: event.colorKey,
      href: "/calendar",
      isEditable: true,
    });
  }

  for (const session of classes) {
    entries.push({
      id: `class-${session.id}`,
      source: "CLASS",
      sourceId: session.id,
      title: session.subject.name,
      subtitle: session.room,
      kind: "CLASS",
      startAt: session.startAt,
      endAt: session.endAt,
      isAllDay: false,
      // A class occupies the room and the student; it conflicts like anything
      // else.
      isBusy: true,
      dayKey: localDateKey(session.startAt, profile.timeZone),
      timeLabel: timeLabel(
        { startAt: session.startAt, endAt: session.endAt, isAllDay: false },
        profile,
      ),
      colorKey: session.subject.colorKey,
      href: "/academics/attendance",
      isEditable: false,
    });
  }

  for (const assignment of assignments) {
    if (!assignment.dueAt) continue;

    entries.push({
      id: `assignment-${assignment.id}`,
      source: "ASSIGNMENT",
      sourceId: assignment.id,
      title: assignment.title,
      subtitle: assignment.subject?.name ?? null,
      kind: "DEADLINE",
      startAt: assignment.dueAt,
      endAt: assignment.dueAt,
      isAllDay: assignment.isAllDay,
      // A deadline is a MOMENT, not a block of occupied time. Marking it busy
      // would make every due date conflict with whatever you scheduled to do
      // it in — exactly backwards.
      isBusy: false,
      dayKey: localDateKey(assignment.dueAt, profile.timeZone),
      timeLabel: assignment.isAllDay
        ? "Due today"
        : `Due ${localTimeKey(assignment.dueAt, profile.timeZone)}`,
      colorKey: null,
      href: "/academics/assignments",
      isEditable: false,
    });
  }

  for (const exam of exams) {
    // An exam with no scheduled time is real but not placeable on a timeline;
    // it belongs to the Exams page until a time is set.
    if (!exam.startAt) continue;

    // Exams store a duration, not an end instant. A paper with no stated
    // duration is treated as an hour rather than a zero-length block, which
    // would vanish from the grid and conflict with nothing.
    const endAt = new Date(
      exam.startAt.getTime() +
        (exam.durationMinutes ?? DEFAULT_EXAM_MINUTES) * 60_000,
    );

    entries.push({
      id: `exam-${exam.id}`,
      source: "EXAM",
      sourceId: exam.id,
      title: exam.title,
      subtitle: exam.subject?.name ?? null,
      kind: "EXAM",
      startAt: exam.startAt,
      endAt,
      isAllDay: false,
      isBusy: true,
      dayKey: localDateKey(exam.startAt, profile.timeZone),
      timeLabel: timeLabel(
        { startAt: exam.startAt, endAt, isAllDay: false },
        profile,
      ),
      colorKey: null,
      href: `/academics/exams/${exam.id}`,
      isEditable: false,
    });
  }

  for (const task of tasks) {
    if (!task.dueAt) continue;

    entries.push({
      id: `task-${task.id}`,
      source: "TASK",
      sourceId: task.id,
      title: task.title,
      subtitle: null,
      kind: "DEADLINE",
      startAt: task.dueAt,
      endAt: task.dueAt,
      isAllDay: task.isAllDay,
      isBusy: false,
      dayKey: localDateKey(task.dueAt, profile.timeZone),
      timeLabel: task.isAllDay
        ? "Due today"
        : `Due ${localTimeKey(task.dueAt, profile.timeZone)}`,
      colorKey: null,
      href: "/tasks",
      isEditable: false,
    });
  }

  entries.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const byDay = new Map<string, CalendarEntryDto[]>();

  for (const entry of entries) {
    const list = byDay.get(entry.dayKey) ?? [];
    list.push(entry);
    byDay.set(entry.dayKey, list);
  }

  const todayKey = localDateKey(now, profile.timeZone);

  const days: CalendarDayDto[] = window.dayKeys.map((dayKey) => {
    const dayEntries = byDay.get(dayKey) ?? [];
    const date = toDateOnly(dayKey);

    return {
      dayKey,
      label: formatInTimeZone(
        date,
        "UTC",
        { weekday: "short", day: "numeric" },
        profile.locale,
      ),
      weekdayLabel: formatInTimeZone(
        date,
        "UTC",
        { weekday: "long" },
        profile.locale,
      ),
      isToday: dayKey === todayKey,
      isPast: dayKey < todayKey,
      entries: dayEntries,
      busyMinutes: busyMinutesIn(
        startOfLocalDay(date, profile.timeZone),
        startOfLocalDayOffset(date, profile.timeZone, 1),
        dayEntries as unknown as TimeBlock[],
      ),
    };
  });

  const conflicts: ConflictDto[] = findConflicts(
    entries as unknown as TimeBlock[],
  ).map((conflict) => ({
    firstId: conflict.first.id,
    firstTitle: conflict.first.title,
    secondId: conflict.second.id,
    secondTitle: conflict.second.title,
    overlapMinutes: conflict.overlapMinutes,
    dayKey: localDateKey(conflict.first.startAt, profile.timeZone),
  }));

  return {
    view,
    anchorKey,
    rangeLabel: `${formatInTimeZone(
      toDateOnly(window.dayKeys[0]!),
      "UTC",
      { day: "numeric", month: "short" },
      profile.locale,
    )} – ${formatInTimeZone(
      toDateOnly(window.dayKeys.at(-1)!),
      "UTC",
      { day: "numeric", month: "short" },
      profile.locale,
    )}`,
    days,
    conflicts,
    totalEntries: entries.length,
  };
}

/**
 * Usable gaps on one day, inside the profile's working hours.
 *
 * Deadlines are excluded from the busy set by construction (`isBusy: false`),
 * so a day with three due dates and no meetings correctly reads as free.
 */
export async function getFreeTime(
  profile: Profile,
  dayKey: string,
  minimumMinutes = 30,
  now: Date = new Date(),
): Promise<readonly FreeSlotDto[]> {
  const view = await getCalendarView(profile, dayKey, "DAY", now);
  const entries = view.days[0]?.entries ?? [];
  const date = toDateOnly(dayKey);
  const dayStart = startOfLocalDay(date, profile.timeZone);

  const windowStart = new Date(
    dayStart.getTime() + profile.workingHoursStart * 60_000,
  );
  const windowEnd = new Date(
    dayStart.getTime() + profile.workingHoursEnd * 60_000,
  );

  return findFreeSlots(
    windowStart,
    windowEnd,
    entries as unknown as TimeBlock[],
    minimumMinutes,
  ).map((slot) => ({
    startAt: slot.startAt,
    endAt: slot.endAt,
    minutes: slot.minutes,
    label: `${localTimeKey(slot.startAt, profile.timeZone)}–${localTimeKey(
      slot.endAt,
      profile.timeZone,
    )}`,
  }));
}

export async function listReminders(
  profile: Profile,
  options: { includeClosed?: boolean } = {},
  now: Date = new Date(),
): Promise<readonly ReminderDto[]> {
  const reminders = await db.reminder.findMany({
    where: {
      profileId: profile.id,
      ...(options.includeClosed
        ? {}
        : { status: { in: ["SCHEDULED", "SNOOZED"] } }),
    },
    orderBy: { remindAt: "asc" },
    take: 100,
  });

  return reminders.map((reminder) => {
    const firesAt = reminder.snoozedUntil ?? reminder.remindAt;

    return {
      id: reminder.id,
      title: reminder.title,
      message: reminder.message,
      remindAt: reminder.remindAt,
      firesAt,
      recurrence: reminder.recurrence,
      weekdays: reminder.weekdays,
      status: reminder.status,
      isSnoozed: reminder.snoozedUntil !== null,
      isOverdue:
        reminder.status === "SCHEDULED" && firesAt.getTime() < now.getTime(),
      dateLabel: formatInTimeZone(
        firesAt,
        profile.timeZone,
        { weekday: "short", day: "numeric", month: "short" },
        profile.locale,
      ),
      timeLabel: localTimeKey(firesAt, profile.timeZone),
      remindDateInput: localDateKey(reminder.remindAt, profile.timeZone),
      remindTimeInput: localTimeKey(reminder.remindAt, profile.timeZone),
      taskId: reminder.taskId,
      eventId: reminder.eventId,
      habitId: reminder.habitId,
    };
  });
}

export async function listNotifications(
  profile: Profile,
  limit = 30,
): Promise<
  readonly {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    href: string | null;
    isRead: boolean;
    timeLabel: string;
  }[]
> {
  const notifications = await db.notification.findMany({
    where: { profileId: profile.id, status: { not: "PENDING" } },
    orderBy: { scheduledFor: "desc" },
    take: limit,
  });

  return notifications.map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    body: notification.body,
    href: notification.href,
    isRead: notification.readAt !== null,
    timeLabel: formatInTimeZone(
      notification.sentAt ?? notification.scheduledFor,
      profile.timeZone,
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
      profile.locale,
    ),
  }));
}
