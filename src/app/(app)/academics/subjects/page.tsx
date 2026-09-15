import type { Metadata } from "next";

import { SubjectManager } from "@/features/academics/components/subject-manager";
import { db } from "@/server/db";
import { requireProfileForPage } from "@/server/auth";
import { getSemesterAttendance } from "@/services/academics/attendance.service";
import {
  listSemesters,
  listSubjects,
  resolveActiveSemester,
} from "@/services/academics/semester.service";

export const metadata: Metadata = {
  title: "Subjects",
};

export default async function SubjectsPage() {
  const profile = await requireProfileForPage();
  const now = new Date();

  const [semesters, active] = await Promise.all([
    listSemesters(profile.id, true),
    resolveActiveSemester(profile.id),
  ]);

  if (!active) {
    return (
      <SubjectManager
        subjects={[]}
        semesters={semesters.map((s) => ({ id: s.id, name: s.name }))}
        currentSemesterId={null}
      />
    );
  }

  // Three queries regardless of subject count — the attendance helper already
  // batches, and open-assignment counts come from one grouped query rather
  // than a per-subject loop.
  const [subjects, attendance, openCounts] = await Promise.all([
    listSubjects(profile.id, { semesterId: active.id }),
    getSemesterAttendance(profile.id, active.id, now),
    db.assignment.groupBy({
      by: ["subjectId"],
      where: {
        profileId: profile.id,
        semesterId: active.id,
        archivedAt: null,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      _count: { _all: true },
    }),
  ]);

  const attendanceBySubject = new Map(
    attendance.map((entry) => [entry.subjectId, entry]),
  );
  const openBySubject = new Map(
    openCounts.map((row) => [row.subjectId, row._count._all]),
  );

  return (
    <SubjectManager
      subjects={subjects.map((subject) => {
        const entry = attendanceBySubject.get(subject.id);

        return {
          id: subject.id,
          name: subject.name,
          code: subject.code,
          facultyName: subject.facultyName,
          credits: subject.credits,
          attendance: entry
            ? {
                subjectId: entry.subjectId,
                subjectName: entry.subjectName,
                subjectCode: entry.subjectCode,
                percentage: entry.summary.percentage,
                thresholdPercent: entry.summary.thresholdPercent,
                risk: entry.summary.risk,
                canMiss: entry.summary.canMiss,
                mustAttend: entry.summary.mustAttend,
              }
            : null,
          openAssignments: openBySubject.get(subject.id) ?? 0,
        };
      })}
      semesters={semesters.map((s) => ({ id: s.id, name: s.name }))}
      currentSemesterId={active.id}
    />
  );
}
