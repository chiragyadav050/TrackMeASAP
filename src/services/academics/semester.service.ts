import "server-only";

import type { Semester, Subject } from "@/generated/prisma/client";
import { AppError, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";
import {
  ENTITY_SEMESTER,
  ENTITY_SUBJECT,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import { toDateOnly } from "@/services/academics/academic.dates";
import {
  requireOwnedSemester,
  requireOwnedSubject,
} from "@/services/academics/academic.ownership";
import type {
  CreateSemesterInput,
  CreateSubjectInput,
} from "@/services/academics/academic.schema";
import type { z } from "zod";
import type {
  updateSemesterSchema,
  updateSubjectSchema,
} from "@/services/academics/academic.schema";

/**
 * Semester and subject mutations.
 *
 * Same contract as every other service in Life OS: `profileId` is the first
 * argument, it always comes from the Clerk session, and no function here
 * reads the ambient session itself.
 */

const log = logger.child({ service: "semester" });

// ---------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------

export async function createSemester(
  profileId: string,
  input: CreateSemesterInput,
): Promise<Semester> {
  const semester = await db.semester.create({
    data: {
      profileId,
      name: input.name,
      academicYear: input.academicYear,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
      status: input.status,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SEMESTER,
    semester.id,
    "CREATED",
  );

  return semester;
}

export async function updateSemester(
  profileId: string,
  input: z.infer<typeof updateSemesterSchema>,
): Promise<Semester> {
  const existing = await requireOwnedSemester(profileId, input.semesterId);

  const semester = await db.semester.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      academicYear: input.academicYear,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
      status: input.status,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SEMESTER,
    semester.id,
    "UPDATED",
  );

  return semester;
}

/**
 * Makes one semester current, clearing whichever was.
 *
 * TWO LAYERS OF ENFORCEMENT, deliberately:
 *
 *  1. This transaction clears every other `isCurrent` before setting the new
 *     one, so the two writes cannot be observed half-applied.
 *  2. A PARTIAL UNIQUE INDEX in the migration (`WHERE is_current`) makes the
 *     rule true at the database level. If a future code path ever forgets to
 *     clear the old flag, the insert fails loudly rather than leaving the
 *     account with two "current" semesters and a dashboard that picks one at
 *     random.
 *
 * The brief asked for this not to rest on client-side logic. It does not rest
 * on application logic either.
 */
export async function setCurrentSemester(
  profileId: string,
  semesterId: string,
): Promise<Semester> {
  await requireOwnedSemester(profileId, semesterId);

  const [, semester] = await db.$transaction([
    db.semester.updateMany({
      where: { profileId, isCurrent: true, id: { not: semesterId } },
      data: { isCurrent: false },
    }),
    db.semester.update({
      where: { id: semesterId },
      data: { isCurrent: true, status: "ACTIVE" },
    }),
  ]);

  await recordAcademicActivity(
    profileId,
    ENTITY_SEMESTER,
    semesterId,
    "UPDATED",
    {
      fields: ["isCurrent"],
    },
  );

  log.info("Current semester changed", { semesterId });

  return semester;
}

/**
 * Archives a semester.
 *
 * A current semester cannot be archived without first choosing another —
 * silently leaving the account with no current semester would empty every
 * academic surface with no explanation.
 */
export async function archiveSemester(
  profileId: string,
  semesterId: string,
): Promise<Semester> {
  const existing = await requireOwnedSemester(profileId, semesterId);

  if (existing.isCurrent) {
    throw new AppError({
      code: "CONFLICT",
      message: "Refused to archive the current semester",
      userMessage: "Set another semester as current before archiving this one.",
    });
  }

  const semester = await db.semester.update({
    where: { id: existing.id },
    data: { status: "ARCHIVED", isCurrent: false },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SEMESTER,
    semester.id,
    "ARCHIVED",
  );

  return semester;
}

export async function deleteSemester(
  profileId: string,
  semesterId: string,
): Promise<void> {
  const existing = await requireOwnedSemester(profileId, semesterId);

  if (existing.isCurrent) {
    throw new AppError({
      code: "CONFLICT",
      message: "Refused to delete the current semester",
      userMessage: "Set another semester as current before deleting this one.",
    });
  }

  // Subjects, and everything beneath them, cascade at the database level.
  await db.semester.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_SEMESTER,
    existing.id,
    "DELETED",
    { name: existing.name },
  );
}

/** The current semester, or `null` when none has been chosen. */
export async function getCurrentSemester(
  profileId: string,
): Promise<Semester | null> {
  return db.semester.findFirst({ where: { profileId, isCurrent: true } });
}

/**
 * The current semester, or the most recent one as a fallback.
 *
 * Used by dashboards that want to show something sensible for a user who
 * created semesters but never marked one current.
 */
export async function resolveActiveSemester(
  profileId: string,
): Promise<Semester | null> {
  const current = await getCurrentSemester(profileId);

  if (current) {
    return current;
  }

  return db.semester.findFirst({
    where: { profileId, status: { not: "ARCHIVED" } },
    orderBy: { startDate: "desc" },
  });
}

export async function listSemesters(
  profileId: string,
  includeArchived = false,
): Promise<readonly Semester[]> {
  return db.semester.findMany({
    where: {
      profileId,
      ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }),
    },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
  });
}

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export async function createSubject(
  profileId: string,
  input: CreateSubjectInput,
): Promise<Subject> {
  // Proves the parent semester is owned before attaching anything to it.
  await requireOwnedSemester(profileId, input.semesterId);

  const subject = await db.subject.create({
    data: {
      profileId,
      semesterId: input.semesterId,
      name: input.name,
      code: input.code ?? null,
      facultyName: input.facultyName ?? null,
      credits: input.credits ?? null,
      attendanceThreshold: input.attendanceThreshold,
      colorKey: input.colorKey ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SUBJECT,
    subject.id,
    "CREATED",
  );

  return subject;
}

export async function updateSubject(
  profileId: string,
  input: z.infer<typeof updateSubjectSchema>,
): Promise<Subject> {
  const existing = await requireOwnedSubject(profileId, input.subjectId);

  // Moving a subject between semesters is allowed, but only into one the
  // caller also owns.
  if (input.semesterId && input.semesterId !== existing.semesterId) {
    await requireOwnedSemester(profileId, input.semesterId);
  }

  const subject = await db.subject.update({
    where: { id: existing.id },
    data: {
      ...(input.semesterId ? { semesterId: input.semesterId } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.attendanceThreshold === undefined
        ? {}
        : { attendanceThreshold: input.attendanceThreshold }),
      ...(input.credits === undefined ? {} : { credits: input.credits }),
      code: input.code ?? null,
      facultyName: input.facultyName ?? null,
      colorKey: input.colorKey ?? null,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SUBJECT,
    subject.id,
    "UPDATED",
  );

  return subject;
}

export async function setSubjectArchived(
  profileId: string,
  subjectId: string,
  isArchived: boolean,
): Promise<Subject> {
  const existing = await requireOwnedSubject(profileId, subjectId);

  const subject = await db.subject.update({
    where: { id: existing.id },
    data: { archivedAt: isArchived ? new Date() : null },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_SUBJECT,
    subject.id,
    isArchived ? "ARCHIVED" : "UNARCHIVED",
  );

  return subject;
}

export async function deleteSubject(
  profileId: string,
  subjectId: string,
): Promise<void> {
  const existing = await requireOwnedSubject(profileId, subjectId);

  // Classes, attendance, assignments, exams and notes cascade. Tasks do NOT:
  // `Task.subjectId` is `SetNull`, so work the student actually did survives
  // the subject being removed.
  await db.subject.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_SUBJECT,
    existing.id,
    "DELETED",
    {
      name: existing.name,
    },
  );
}

export async function getSubject(
  profileId: string,
  subjectId: string,
): Promise<Subject> {
  return requireOwnedSubject(profileId, subjectId);
}

export async function listSubjects(
  profileId: string,
  options: {
    semesterId?: string;
    includeArchived?: boolean;
    search?: string;
  } = {},
): Promise<readonly Subject[]> {
  return db.subject.findMany({
    where: {
      profileId,
      ...(options.semesterId ? { semesterId: options.semesterId } : {}),
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: "insensitive" } },
              { code: { contains: options.search, mode: "insensitive" } },
              {
                facultyName: {
                  contains: options.search,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }],
  });
}

/** Throws unless the semester exists and belongs to the caller. */
export async function requireSemester(
  profileId: string,
  semesterId: string | null | undefined,
): Promise<Semester> {
  if (!semesterId) {
    throw notFound("Semester");
  }

  return requireOwnedSemester(profileId, semesterId);
}
