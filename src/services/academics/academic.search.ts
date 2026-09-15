import "server-only";

import type { Profile } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * Academic global search.
 *
 * Every query is scoped by `profileId`, so results can only ever be the
 * caller's own — the same rule as task search.
 *
 * Deliberately a set of narrow, indexed queries rather than one clever union:
 * each entity has a different shape and a different route, and the result
 * limit is small enough that six parallel lookups are cheaper than the
 * machinery a unified index would need.
 */

export type AcademicSearchResult = {
  readonly id: string;
  readonly kind:
    "SEMESTER" | "SUBJECT" | "ASSIGNMENT" | "EXAM" | "ASSESSMENT" | "NOTE";
  readonly title: string;
  readonly subtitle: string | null;
  readonly href: string;
};

/** Per-entity cap, so a broad term cannot flood the palette. */
const PER_KIND_LIMIT = 4;

export async function searchAcademics(
  profile: Profile,
  query: string,
  limit = 10,
): Promise<readonly AcademicSearchResult[]> {
  const trimmed = query.trim();

  if (trimmed.length < 2) {
    return [];
  }

  const contains = { contains: trimmed, mode: "insensitive" as const };
  const scope = { profileId: profile.id };

  const [semesters, subjects, assignments, exams, assessments, notes] =
    await Promise.all([
      db.semester.findMany({
        where: {
          ...scope,
          OR: [{ name: contains }, { academicYear: contains }],
        },
        select: { id: true, name: true, academicYear: true },
        take: PER_KIND_LIMIT,
      }),
      db.subject.findMany({
        where: {
          ...scope,
          archivedAt: null,
          OR: [
            { name: contains },
            { code: contains },
            { facultyName: contains },
          ],
        },
        select: { id: true, name: true, code: true },
        take: PER_KIND_LIMIT,
      }),
      db.assignment.findMany({
        where: {
          ...scope,
          archivedAt: null,
          OR: [{ title: contains }, { description: contains }],
        },
        select: {
          id: true,
          title: true,
          subject: { select: { name: true, code: true } },
        },
        take: PER_KIND_LIMIT,
      }),
      db.exam.findMany({
        where: { ...scope, OR: [{ title: contains }, { notes: contains }] },
        select: {
          id: true,
          title: true,
          type: true,
          subject: { select: { code: true, name: true } },
        },
        take: PER_KIND_LIMIT,
      }),
      db.assessment.findMany({
        where: {
          ...scope,
          OR: [{ title: contains }, { syllabusNotes: contains }],
        },
        select: {
          id: true,
          title: true,
          subject: { select: { id: true, code: true, name: true } },
        },
        take: PER_KIND_LIMIT,
      }),
      db.academicNote.findMany({
        where: { ...scope, OR: [{ title: contains }, { body: contains }] },
        select: {
          id: true,
          title: true,
          subjectId: true,
          subject: { select: { name: true } },
        },
        take: PER_KIND_LIMIT,
      }),
    ]);

  const results: AcademicSearchResult[] = [
    ...subjects.map((subject) => ({
      id: subject.id,
      kind: "SUBJECT" as const,
      title: subject.name,
      subtitle: subject.code,
      href: `/academics/subjects/${subject.id}`,
    })),

    ...assignments.map((assignment) => ({
      id: assignment.id,
      kind: "ASSIGNMENT" as const,
      title: assignment.title,
      subtitle: assignment.subject.code ?? assignment.subject.name,
      href: "/academics/assignments",
    })),

    ...exams.map((exam) => ({
      id: exam.id,
      kind: "EXAM" as const,
      title: exam.title,
      subtitle: exam.subject?.code ?? exam.subject?.name ?? null,
      href: `/academics/exams/${exam.id}`,
    })),

    ...assessments.map((assessment) => ({
      id: assessment.id,
      kind: "ASSESSMENT" as const,
      title: assessment.title,
      subtitle: assessment.subject.code ?? assessment.subject.name,
      href: `/academics/subjects/${assessment.subject.id}`,
    })),

    ...notes.map((note) => ({
      id: note.id,
      kind: "NOTE" as const,
      title: note.title,
      subtitle: note.subject.name,
      href: `/academics/subjects/${note.subjectId}`,
    })),

    ...semesters.map((semester) => ({
      id: semester.id,
      kind: "SEMESTER" as const,
      title: semester.name,
      subtitle: semester.academicYear,
      href: "/academics/semesters",
    })),
  ];

  return results.slice(0, limit);
}
