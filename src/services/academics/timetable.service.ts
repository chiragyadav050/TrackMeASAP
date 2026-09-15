import "server-only";

import type {
  ClassSchedule,
  ClassSession,
  Prisma,
} from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { parseMinutesFromTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  ENTITY_CLASS_SESSION,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import {
  eachLocalDate,
  fromDateOnly,
  isoWeekdayOf,
  toDateOnly,
  toInstant,
} from "@/services/academics/academic.dates";
import {
  requireOwnedClassSession,
  requireOwnedSchedule,
  requireOwnedSubject,
} from "@/services/academics/academic.ownership";
import type { z } from "zod";
import type {
  createClassSessionSchema,
  createScheduleSchema,
  generateSessionsSchema,
  updateScheduleSchema,
} from "@/services/academics/academic.schema";

/**
 * The timetable.
 *
 * ===========================================================================
 * THE TWO-LAYER MODEL, AND WHY IT EXISTS
 * ===========================================================================
 *
 *   ClassSchedule   A RULE.  "Cloud Computing, every Monday 10:00–11:00."
 *   ClassSession    A FACT.  "Cloud Computing on Monday 21 September."
 *   AttendanceRecord attaches to the FACT, never the rule.
 *
 * Collapsing these into one table is the obvious shortcut and the reason
 * timetable features usually break by mid-semester. Attendance is a statement
 * about a specific day; the timetable is a statement about a pattern. Once a
 * single Monday is cancelled, or the slot moves from 10:00 to 14:00 in week
 * seven, a single-table design has to either rewrite history or lose it.
 *
 * With the split:
 *   • cancelling one Monday sets that SESSION to CANCELLED; the rule is
 *     untouched and next Monday still generates.
 *   • changing the slot mid-term closes the old rule with `effectiveTo` and
 *     opens a new one. Sessions already generated — and the attendance hanging
 *     off them — remain exactly as they were.
 *   • deleting a rule entirely uses `onDelete: SetNull`, so past sessions
 *     survive as ad-hoc records rather than vanishing with their attendance.
 * ===========================================================================
 */

const log = logger.child({ service: "timetable" });

/** Bounded so one generation request cannot become an unbounded write. */
const MAX_GENERATION_DAYS = 200;

// ---------------------------------------------------------------------------
// Recurring schedule
// ---------------------------------------------------------------------------

export async function createSchedule(
  profileId: string,
  input: z.infer<typeof createScheduleSchema>,
): Promise<ClassSchedule> {
  await requireOwnedSubject(profileId, input.subjectId);

  return db.classSchedule.create({
    data: {
      profileId,
      subjectId: input.subjectId,
      dayOfWeek: input.dayOfWeek,
      startMinute: parseMinutesFromTime(input.startTime) ?? 0,
      endMinute: parseMinutesFromTime(input.endTime) ?? 0,
      sessionType: input.sessionType,
      room: input.room ?? null,
      teacherName: input.teacherName ?? null,
      effectiveFrom: input.effectiveFrom
        ? toDateOnly(input.effectiveFrom)
        : null,
      effectiveTo: input.effectiveTo ? toDateOnly(input.effectiveTo) : null,
    },
  });
}

export async function updateSchedule(
  profileId: string,
  input: z.infer<typeof updateScheduleSchema>,
): Promise<ClassSchedule> {
  const existing = await requireOwnedSchedule(profileId, input.scheduleId);

  if (input.subjectId !== existing.subjectId) {
    await requireOwnedSubject(profileId, input.subjectId);
  }

  return db.classSchedule.update({
    where: { id: existing.id },
    data: {
      subjectId: input.subjectId,
      dayOfWeek: input.dayOfWeek,
      startMinute: parseMinutesFromTime(input.startTime) ?? 0,
      endMinute: parseMinutesFromTime(input.endTime) ?? 0,
      sessionType: input.sessionType,
      room: input.room ?? null,
      teacherName: input.teacherName ?? null,
      effectiveFrom: input.effectiveFrom
        ? toDateOnly(input.effectiveFrom)
        : null,
      effectiveTo: input.effectiveTo ? toDateOnly(input.effectiveTo) : null,
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
}

/**
 * Retires a timetable rule.
 *
 * Deactivates rather than deletes by default: the sessions it already
 * generated keep pointing at it, which is what makes "why is this class on my
 * timetable" answerable months later.
 */
export async function deactivateSchedule(
  profileId: string,
  scheduleId: string,
): Promise<ClassSchedule> {
  const existing = await requireOwnedSchedule(profileId, scheduleId);

  return db.classSchedule.update({
    where: { id: existing.id },
    data: { isActive: false },
  });
}

export async function deleteSchedule(
  profileId: string,
  scheduleId: string,
): Promise<void> {
  const existing = await requireOwnedSchedule(profileId, scheduleId);

  // `scheduleId` on ClassSession is `SetNull`, so past classes and their
  // attendance survive as ad-hoc records.
  await db.classSchedule.delete({ where: { id: existing.id } });
}

export async function listSchedules(
  profileId: string,
  options: { subjectId?: string; semesterId?: string } = {},
): Promise<
  readonly (ClassSchedule & {
    subject: { name: string; code: string | null };
  })[]
> {
  return db.classSchedule.findMany({
    where: {
      profileId,
      isActive: true,
      ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      ...(options.semesterId
        ? { subject: { semesterId: options.semesterId } }
        : {}),
    },
    include: { subject: { select: { name: true, code: true } } },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

// ---------------------------------------------------------------------------
// Generating occurrences
// ---------------------------------------------------------------------------

export type GenerationResult = {
  readonly created: number;
  readonly skipped: number;
  readonly daysConsidered: number;
};

/**
 * Materialises recurring rules into real class occurrences over a date range.
 *
 * IDEMPOTENT. `@@unique([scheduleId, startAt])` means re-running over an
 * overlapping range creates nothing new, so the user can safely hit "generate"
 * again after adding one more subject.
 *
 * A rule only applies on a day inside its `effectiveFrom`/`effectiveTo`
 * window, which is how a mid-semester timetable change avoids rewriting the
 * weeks before it.
 */
export async function generateClassSessions(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof generateSessionsSchema>,
): Promise<GenerationResult> {
  const days = eachLocalDate(input.fromDate, input.toDate).slice(
    0,
    MAX_GENERATION_DAYS,
  );

  const schedules = await db.classSchedule.findMany({
    where: {
      profileId,
      isActive: true,
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    },
  });

  if (schedules.length === 0 || days.length === 0) {
    return { created: 0, skipped: 0, daysConsidered: days.length };
  }

  const rows: Prisma.ClassSessionCreateManyInput[] = [];

  for (const dateKey of days) {
    const weekday = isoWeekdayOf(dateKey);

    for (const schedule of schedules) {
      if (schedule.dayOfWeek !== weekday) {
        continue;
      }

      if (!isWithinWindow(dateKey, schedule)) {
        continue;
      }

      rows.push({
        profileId,
        subjectId: schedule.subjectId,
        scheduleId: schedule.id,
        startAt: toInstant(
          dateKey,
          minutesToTime(schedule.startMinute),
          timeZone,
        ),
        endAt: toInstant(dateKey, minutesToTime(schedule.endMinute), timeZone),
        sessionType: schedule.sessionType,
        room: schedule.room,
        teacherName: schedule.teacherName,
        status: "SCHEDULED",
      });
    }
  }

  if (rows.length === 0) {
    return { created: 0, skipped: 0, daysConsidered: days.length };
  }

  // `skipDuplicates` is what makes re-running safe.
  const result = await db.classSession.createMany({
    data: rows,
    skipDuplicates: true,
  });

  log.info("Generated class sessions", {
    requested: rows.length,
    created: result.count,
  });

  return {
    created: result.count,
    skipped: rows.length - result.count,
    daysConsidered: days.length,
  };
}

function isWithinWindow(dateKey: string, schedule: ClassSchedule): boolean {
  if (
    schedule.effectiveFrom &&
    dateKey < fromDateOnly(schedule.effectiveFrom)
  ) {
    return false;
  }

  if (schedule.effectiveTo && dateKey > fromDateOnly(schedule.effectiveTo)) {
    return false;
  }

  return true;
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Individual occurrences
// ---------------------------------------------------------------------------

/** An extra lecture, a make-up class, anything off the timetable. */
export async function createClassSession(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof createClassSessionSchema>,
): Promise<ClassSession> {
  await requireOwnedSubject(profileId, input.subjectId);

  const session = await db.classSession.create({
    data: {
      profileId,
      subjectId: input.subjectId,
      // No `scheduleId`: this class exists in its own right.
      startAt: toInstant(input.date, input.startTime, timeZone),
      endAt: toInstant(input.date, input.endTime, timeZone),
      title: input.title ?? null,
      sessionType: input.sessionType,
      room: input.room ?? null,
      teacherName: input.teacherName ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_CLASS_SESSION,
    session.id,
    "CREATED",
  );

  return session;
}

/**
 * Changes one occurrence's status.
 *
 * Cancelling here affects ONLY this day. The recurring rule is untouched and
 * next week still generates — which is the entire point of the split model.
 *
 * Cancelling also removes any attendance already marked: attendance for a
 * class that did not happen is not a fact about the student.
 */
export async function setClassSessionStatus(
  profileId: string,
  classSessionId: string,
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED",
): Promise<ClassSession> {
  const existing = await requireOwnedClassSession(profileId, classSessionId);

  const session = await db.$transaction(async (tx) => {
    if (status === "CANCELLED") {
      await tx.attendanceRecord.deleteMany({
        where: { classSessionId: existing.id },
      });
    }

    return tx.classSession.update({
      where: { id: existing.id },
      data: { status },
    });
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_CLASS_SESSION,
    session.id,
    "UPDATED",
    { status },
  );

  return session;
}

export async function deleteClassSession(
  profileId: string,
  classSessionId: string,
): Promise<void> {
  const existing = await requireOwnedClassSession(profileId, classSessionId);

  await db.classSession.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_CLASS_SESSION,
    existing.id,
    "DELETED",
  );
}

export async function listClassSessions(
  profileId: string,
  options: {
    subjectId?: string;
    semesterId?: string;
    from?: Date;
    to?: Date;
    status?: "SCHEDULED" | "COMPLETED" | "CANCELLED";
    take?: number;
  } = {},
) {
  return db.classSession.findMany({
    where: {
      profileId,
      ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      ...(options.semesterId
        ? { subject: { semesterId: options.semesterId } }
        : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.from || options.to
        ? {
            startAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lt: options.to } : {}),
            },
          }
        : {}),
    },
    include: {
      subject: { select: { id: true, name: true, code: true, colorKey: true } },
      attendance: { select: { status: true } },
    },
    orderBy: { startAt: "asc" },
    take: options.take ?? 200,
  });
}
