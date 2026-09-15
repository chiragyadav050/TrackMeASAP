import "server-only";

import type { AttendanceRecord } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { db } from "@/server/db";
import {
  ENTITY_ATTENDANCE,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import {
  requireOwnedClassSession,
  requireOwnedSubject,
} from "@/services/academics/academic.ownership";
import {
  EMPTY_ATTENDANCE,
  summariseAttendance,
  type AttendanceCounts,
  type AttendanceSummary,
} from "@/services/academics/attendance.calculator";

/**
 * Attendance marking and aggregation.
 *
 * The arithmetic lives in `attendance.calculator.ts` — pure, and tested to
 * death. This file is only responsible for reading the right rows and writing
 * them back safely.
 */

// ---------------------------------------------------------------------------
// Marking
// ---------------------------------------------------------------------------

/**
 * Marks attendance for one class occurrence.
 *
 * Upserts, so re-marking corrects the record rather than creating a second
 * one — enforced by `@@unique` on `classSessionId` at the database level too.
 *
 * Marking also moves the class to COMPLETED. A class you attended or missed
 * has, by definition, happened; leaving it SCHEDULED would make the timetable
 * disagree with the attendance register.
 */
export async function markAttendance(
  profileId: string,
  classSessionId: string,
  status: "PRESENT" | "ABSENT" | "EXCUSED",
  note?: string,
): Promise<AttendanceRecord> {
  const session = await requireOwnedClassSession(profileId, classSessionId);

  if (session.status === "CANCELLED") {
    // Attendance for a class that did not happen is not a fact about the
    // student, and would quietly distort the percentage.
    throw new AppError({
      code: "CONFLICT",
      message: "Attendance marked on a cancelled class",
      userMessage:
        "That class was cancelled. Restore it before marking attendance.",
    });
  }

  const record = await db.$transaction(async (tx) => {
    const upserted = await tx.attendanceRecord.upsert({
      where: { classSessionId: session.id },
      create: {
        profileId,
        subjectId: session.subjectId,
        classSessionId: session.id,
        status,
        note: note ?? null,
      },
      update: { status, note: note ?? null, markedAt: new Date() },
    });

    await tx.classSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED" },
    });

    return upserted;
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ATTENDANCE,
    record.id,
    "UPDATED",
    { status, subjectId: session.subjectId },
  );

  return record;
}

/**
 * Removes a mark, returning the class to "not yet recorded".
 *
 * Distinct from marking ABSENT: an unmarked class counts toward nothing,
 * which is why the two cannot share a representation.
 */
export async function clearAttendance(
  profileId: string,
  classSessionId: string,
): Promise<void> {
  const session = await requireOwnedClassSession(profileId, classSessionId);

  await db.$transaction(async (tx) => {
    await tx.attendanceRecord.deleteMany({
      where: { classSessionId: session.id, profileId },
    });

    await tx.classSession.update({
      where: { id: session.id },
      data: { status: "SCHEDULED" },
    });
  });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Counts one subject's attendance with a single grouped query.
 *
 * `groupBy` rather than three `count` calls, and certainly rather than
 * fetching rows and counting in JavaScript — this stays one indexed scan
 * however many classes have happened.
 */
export async function getAttendanceCounts(
  profileId: string,
  subjectId: string,
): Promise<AttendanceCounts> {
  const grouped = await db.attendanceRecord.groupBy({
    by: ["status"],
    where: { profileId, subjectId },
    _count: { _all: true },
  });

  return toCounts(grouped);
}

/** The same, for every subject at once — one query for a whole dashboard. */
export async function getAttendanceCountsBySubject(
  profileId: string,
  subjectIds: readonly string[],
): Promise<ReadonlyMap<string, AttendanceCounts>> {
  if (subjectIds.length === 0) {
    return new Map();
  }

  const grouped = await db.attendanceRecord.groupBy({
    by: ["subjectId", "status"],
    where: { profileId, subjectId: { in: [...subjectIds] } },
    _count: { _all: true },
  });

  const bySubject = new Map<string, AttendanceCounts>();

  for (const subjectId of subjectIds) {
    bySubject.set(subjectId, EMPTY_ATTENDANCE);
  }

  for (const row of grouped) {
    const current = bySubject.get(row.subjectId) ?? EMPTY_ATTENDANCE;
    const count = row._count._all;

    bySubject.set(row.subjectId, {
      present: current.present + (row.status === "PRESENT" ? count : 0),
      absent: current.absent + (row.status === "ABSENT" ? count : 0),
      excused: current.excused + (row.status === "EXCUSED" ? count : 0),
    });
  }

  return bySubject;
}

function toCounts(
  grouped: readonly { status: string; _count: { _all: number } }[],
): AttendanceCounts {
  let present = 0;
  let absent = 0;
  let excused = 0;

  for (const row of grouped) {
    if (row.status === "PRESENT") present += row._count._all;
    else if (row.status === "ABSENT") absent += row._count._all;
    else if (row.status === "EXCUSED") excused += row._count._all;
  }

  return { present, absent, excused };
}

/**
 * Classes still to come for a subject.
 *
 * Feeds the risk calculation: "below the threshold" means something very
 * different with twenty classes left than with two. Counts only SCHEDULED
 * future sessions, so cancelled ones do not inflate the student's chances.
 */
export async function countRemainingClasses(
  profileId: string,
  subjectId: string,
  now: Date,
): Promise<number> {
  return db.classSession.count({
    where: {
      profileId,
      subjectId,
      status: "SCHEDULED",
      startAt: { gte: now },
    },
  });
}

/** Everything the subject page needs about attendance, computed once. */
export async function getAttendanceSummary(
  profileId: string,
  subjectId: string,
  now: Date = new Date(),
): Promise<AttendanceSummary> {
  const subject = await requireOwnedSubject(profileId, subjectId);

  const [counts, remaining] = await Promise.all([
    getAttendanceCounts(profileId, subjectId),
    countRemainingClasses(profileId, subjectId, now),
  ]);

  return summariseAttendance(counts, subject.attendanceThreshold, remaining);
}

/**
 * Attendance for every subject in a semester.
 *
 * Three queries total regardless of subject count — the subjects, one grouped
 * attendance query, and one grouped remaining-class query. Deliberately not a
 * loop of per-subject calls, which is the N+1 pattern this dashboard would
 * otherwise fall into.
 */
export async function getSemesterAttendance(
  profileId: string,
  semesterId: string,
  now: Date = new Date(),
): Promise<
  readonly {
    subjectId: string;
    subjectName: string;
    subjectCode: string | null;
    summary: AttendanceSummary;
  }[]
> {
  const subjects = await db.subject.findMany({
    where: { profileId, semesterId, archivedAt: null },
    select: {
      id: true,
      name: true,
      code: true,
      attendanceThreshold: true,
    },
    orderBy: { name: "asc" },
  });

  if (subjects.length === 0) {
    return [];
  }

  const subjectIds = subjects.map((subject) => subject.id);

  const [countsBySubject, remainingGrouped] = await Promise.all([
    getAttendanceCountsBySubject(profileId, subjectIds),
    db.classSession.groupBy({
      by: ["subjectId"],
      where: {
        profileId,
        subjectId: { in: subjectIds },
        status: "SCHEDULED",
        startAt: { gte: now },
      },
      _count: { _all: true },
    }),
  ]);

  const remainingBySubject = new Map(
    remainingGrouped.map((row) => [row.subjectId, row._count._all]),
  );

  return subjects.map((subject) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    subjectCode: subject.code,
    summary: summariseAttendance(
      countsBySubject.get(subject.id) ?? EMPTY_ATTENDANCE,
      subject.attendanceThreshold,
      remainingBySubject.get(subject.id) ?? 0,
    ),
  }));
}

/**
 * Semester-wide attendance, pooled across subjects.
 *
 * Classes are pooled rather than averaging the per-subject percentages: a
 * subject with three classes should not weigh the same as one with forty.
 * The threshold shown alongside it is the most common per-subject value.
 */
export async function getOverallAttendance(
  profileId: string,
  semesterId: string,
  now: Date = new Date(),
): Promise<AttendanceSummary | null> {
  const perSubject = await getSemesterAttendance(profileId, semesterId, now);

  if (perSubject.length === 0) {
    return null;
  }

  const pooled = perSubject.reduce<AttendanceCounts>(
    (total, entry) => ({
      present: total.present + entry.summary.counts.present,
      absent: total.absent + entry.summary.counts.absent,
      excused: total.excused + entry.summary.counts.excused,
    }),
    EMPTY_ATTENDANCE,
  );

  const thresholds = perSubject.map((entry) => entry.summary.thresholdPercent);

  return summariseAttendance(pooled, mostCommon(thresholds));
}

function mostCommon(values: readonly number[]): number {
  const tally = new Map<number, number>();

  for (const value of values) {
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }

  let best = values[0] ?? 75;
  let bestCount = 0;

  for (const [value, count] of tally) {
    if (count > bestCount || (count === bestCount && value > best)) {
      best = value;
      bestCount = count;
    }
  }

  return best;
}
