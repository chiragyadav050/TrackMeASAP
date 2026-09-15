import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SubjectDetail } from "@/features/academics/components/subject-detail";
import { startOfLocalDayOffset } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import { db } from "@/server/db";
import {
  listAssignments,
  listExams,
} from "@/services/academics/academic.query";
import { getAttendanceSummary } from "@/services/academics/attendance.service";
import { getStudyMinutes } from "@/services/academics/study.service";
import { listAcademicNotes } from "@/services/academics/study.service";

export const metadata: Metadata = {
  title: "Subject",
};

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ subjectId: string }>;
}) {
  const profile = await requireProfileForPage();
  const { subjectId } = await params;
  const now = new Date();

  // Ownership is proven by the scoped query itself; a foreign id simply does
  // not match and the page 404s rather than confirming the id exists.
  const subject = await db.subject.findFirst({
    where: { id: subjectId, profileId: profile.id },
  });

  if (!subject) {
    notFound();
  }

  const weekStart = startOfLocalDayOffset(now, profile.timeZone, -6);
  const dayEnd = startOfLocalDayOffset(now, profile.timeZone, 1);

  const [
    attendance,
    assignments,
    exams,
    studyWeekMinutes,
    studyTotalMinutes,
    notes,
    openTaskCount,
  ] = await Promise.all([
    getAttendanceSummary(profile.id, subject.id, now),
    listAssignments(
      profile,
      { view: "ALL", subjectId: subject.id, sort: "DUE_DATE" } as never,
      now,
    ),
    listExams(profile, { view: "ALL", subjectId: subject.id } as never, now),
    getStudyMinutes(profile.id, weekStart, dayEnd, subject.id),
    getStudyMinutes(profile.id, new Date(0), dayEnd, subject.id),
    listAcademicNotes(profile.id, subject.id),
    db.task.count({
      where: {
        profileId: profile.id,
        subjectId: subject.id,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
    }),
  ]);

  return (
    <SubjectDetail
      view={{
        subject: {
          id: subject.id,
          name: subject.name,
          code: subject.code,
          facultyName: subject.facultyName,
          credits: subject.credits,
          notes: subject.notes,
        },
        attendance,
        assignments,
        exams,
        studyWeekMinutes,
        studyTotalMinutes,
        notes: notes.map((note) => ({
          id: note.id,
          title: note.title,
          body: note.body,
          updatedAt: note.updatedAt,
        })),
        openTaskCount,
      }}
    />
  );
}
