import type { Metadata } from "next";

import { SemesterManager } from "@/features/academics/components/semester-manager";
import { requireProfileForPage } from "@/server/auth";
import { semesterProgress } from "@/services/academics/academic.derive";
import { listSemesters } from "@/services/academics/semester.service";

export const metadata: Metadata = {
  title: "Semesters",
};

export default async function SemestersPage() {
  const profile = await requireProfileForPage();
  const semesters = await listSemesters(profile.id, true);
  const now = new Date();

  return (
    <SemesterManager
      semesters={semesters.map((semester) => ({
        id: semester.id,
        name: semester.name,
        academicYear: semester.academicYear,
        startDate: semester.startDate,
        endDate: semester.endDate,
        status: semester.status,
        isCurrent: semester.isCurrent,
        progressPercent: semesterProgress(
          semester.startDate,
          semester.endDate,
          now,
        ),
      }))}
    />
  );
}
