import "server-only";

import type { AcademicNote, StudySession } from "@/generated/prisma/client";
import { validationFailed } from "@/lib/errors";
import { startOfLocalDay, startOfLocalDayOffset } from "@/lib/time";
import { db } from "@/server/db";
import {
  ENTITY_ACADEMIC_NOTE,
  ENTITY_STUDY_SESSION,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import { toInstant, todayKey } from "@/services/academics/academic.dates";
import {
  requireOwnedExam,
  requireOwnedNote,
  requireOwnedStudySession,
  requireOwnedSubject,
  requireOwnedTopic,
} from "@/services/academics/academic.ownership";
import type { LogStudySessionInput } from "@/services/academics/academic.schema";

/**
 * Study session logging and aggregation, plus subject notes.
 *
 * Sessions are logged AFTER the fact rather than run as a live timer. Phase 3
 * has no background job to close an abandoned session, and a stopwatch left
 * running overnight produces worse data than an honest "45 minutes".
 */

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export async function logStudySession(
  profileId: string,
  timeZone: string,
  input: LogStudySessionInput,
  now: Date = new Date(),
): Promise<StudySession> {
  await requireOwnedSubject(profileId, input.subjectId);

  // Every optional link is ownership-checked. Without this, a valid subject
  // id plus someone else's exam id would attach the session to their exam.
  if (input.examId) {
    await requireOwnedExam(profileId, input.examId);
  }

  if (input.topicId) {
    const topic = await requireOwnedTopic(profileId, input.topicId);

    if (input.examId && topic.examId !== input.examId) {
      throw validationFailed({
        topicId: ["That topic does not belong to the selected exam."],
      });
    }
  }

  const dateKey = input.date ?? todayKey(now, timeZone);
  const startedAt = toInstant(dateKey, input.startTime, timeZone);

  const session = await db.studySession.create({
    data: {
      profileId,
      subjectId: input.subjectId,
      examId: input.examId ?? null,
      topicId: input.topicId ?? null,
      startedAt,
      endedAt: new Date(startedAt.getTime() + input.durationMinutes * 60_000),
      durationMinutes: input.durationMinutes,
      focusRating: input.focusRating ?? null,
      confidenceBefore: input.confidenceBefore ?? null,
      confidenceAfter: input.confidenceAfter ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_STUDY_SESSION,
    session.id,
    "CREATED",
    { subjectId: input.subjectId, minutes: input.durationMinutes },
  );

  return session;
}

export async function deleteStudySession(
  profileId: string,
  studySessionId: string,
): Promise<void> {
  const existing = await requireOwnedStudySession(profileId, studySessionId);

  await db.studySession.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_STUDY_SESSION,
    existing.id,
    "DELETED",
  );
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Total minutes studied inside a window.
 *
 * `aggregate` rather than fetching rows and summing in JavaScript — the
 * dashboard must not get slower as the semester goes on.
 */
export async function getStudyMinutes(
  profileId: string,
  from: Date,
  to: Date,
  subjectId?: string,
): Promise<number> {
  const result = await db.studySession.aggregate({
    where: {
      profileId,
      ...(subjectId ? { subjectId } : {}),
      startedAt: { gte: from, lt: to },
    },
    _sum: { durationMinutes: true },
  });

  return result._sum.durationMinutes ?? 0;
}

/** Per-subject totals in one grouped query, highest first. */
export async function getStudyMinutesBySubject(
  profileId: string,
  from: Date,
  to: Date,
): Promise<
  readonly { subjectId: string; subjectName: string; minutes: number }[]
> {
  const grouped = await db.studySession.groupBy({
    by: ["subjectId"],
    where: { profileId, startedAt: { gte: from, lt: to } },
    _sum: { durationMinutes: true },
  });

  if (grouped.length === 0) {
    return [];
  }

  const subjects = await db.subject.findMany({
    where: { profileId, id: { in: grouped.map((row) => row.subjectId) } },
    select: { id: true, name: true },
  });

  const names = new Map(subjects.map((subject) => [subject.id, subject.name]));

  return grouped
    .map((row) => ({
      subjectId: row.subjectId,
      subjectName: names.get(row.subjectId) ?? "Unknown subject",
      minutes: row._sum.durationMinutes ?? 0,
    }))
    .sort(
      (a, b) =>
        b.minutes - a.minutes || a.subjectName.localeCompare(b.subjectName),
    );
}

/**
 * Today and this-week totals, both resolved in the profile's zone.
 *
 * "This week" is the trailing seven local days rather than a calendar week —
 * `Profile.weekStart` governs calendars, and a rolling window is the more
 * useful signal for "am I keeping up".
 */
export async function getStudySummary(
  profileId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<{
  todayMinutes: number;
  weekMinutes: number;
  bySubject: readonly {
    subjectId: string;
    subjectName: string;
    minutes: number;
  }[];
  recentSessions: readonly (StudySession & {
    subject: { name: string; code: string | null };
  })[];
  activeDays: number;
}> {
  const dayStart = startOfLocalDay(now, timeZone);
  const dayEnd = startOfLocalDayOffset(now, timeZone, 1);
  const weekStart = startOfLocalDayOffset(now, timeZone, -6);

  const [todayMinutes, weekMinutes, bySubject, recentSessions, distinctDays] =
    await Promise.all([
      getStudyMinutes(profileId, dayStart, dayEnd),
      getStudyMinutes(profileId, weekStart, dayEnd),
      getStudyMinutesBySubject(profileId, weekStart, dayEnd),
      db.studySession.findMany({
        where: { profileId },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
      db.studySession.findMany({
        where: { profileId, startedAt: { gte: weekStart, lt: dayEnd } },
        select: { startedAt: true },
      }),
    ]);

  // Consistency is distinct local DAYS studied, not session count — three
  // sessions in one evening is not three days of work.
  const activeDays = new Set(
    distinctDays.map((session) => todayKey(session.startedAt, timeZone)),
  ).size;

  return {
    todayMinutes,
    weekMinutes,
    bySubject,
    recentSessions,
    activeDays,
  };
}

export async function listStudySessions(
  profileId: string,
  options: { subjectId?: string; from?: Date; to?: Date; take?: number } = {},
) {
  return db.studySession.findMany({
    where: {
      profileId,
      ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      ...(options.from || options.to
        ? {
            startedAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lt: options.to } : {}),
            },
          }
        : {}),
    },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      topic: { select: { id: true, title: true } },
    },
    orderBy: { startedAt: "desc" },
    take: options.take ?? 50,
  });
}

// ---------------------------------------------------------------------------
// Subject notes
// ---------------------------------------------------------------------------

export async function createAcademicNote(
  profileId: string,
  subjectId: string,
  title: string,
  body: string,
): Promise<AcademicNote> {
  await requireOwnedSubject(profileId, subjectId);

  const note = await db.academicNote.create({
    data: { profileId, subjectId, title, body },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ACADEMIC_NOTE,
    note.id,
    "CREATED",
    { subjectId },
  );

  return note;
}

export async function updateAcademicNote(
  profileId: string,
  noteId: string,
  input: { title?: string; body?: string },
): Promise<AcademicNote> {
  const existing = await requireOwnedNote(profileId, noteId);

  return db.academicNote.update({
    where: { id: existing.id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.body === undefined ? {} : { body: input.body }),
    },
  });
}

export async function deleteAcademicNote(
  profileId: string,
  noteId: string,
): Promise<void> {
  const existing = await requireOwnedNote(profileId, noteId);

  await db.academicNote.delete({ where: { id: existing.id } });
}

export async function listAcademicNotes(
  profileId: string,
  subjectId: string,
): Promise<readonly AcademicNote[]> {
  await requireOwnedSubject(profileId, subjectId);

  return db.academicNote.findMany({
    where: { profileId, subjectId },
    orderBy: { updatedAt: "desc" },
  });
}
