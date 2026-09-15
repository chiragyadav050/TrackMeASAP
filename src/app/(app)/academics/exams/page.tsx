import type { Metadata } from "next";

import { ExamManager } from "@/features/academics/components/exam-manager";
import { requireProfileForPage } from "@/server/auth";
import { listExams } from "@/services/academics/academic.query";
import { examFiltersSchema } from "@/services/academics/academic.schema";
import {
  listSubjects,
  resolveActiveSemester,
} from "@/services/academics/semester.service";

export const metadata: Metadata = {
  title: "Exams",
};

export default async function ExamsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  const parsed = examFiltersSchema.safeParse({
    view: params.view,
    semesterId: params.semesterId,
    subjectId: params.subjectId,
    type: params.type,
  });

  const filters = parsed.success ? parsed.data : examFiltersSchema.parse({});

  const active = await resolveActiveSemester(profile.id);

  const [exams, subjects] = await Promise.all([
    listExams(profile, filters),
    listSubjects(profile.id, active ? { semesterId: active.id } : {}),
  ]);

  return (
    <ExamManager
      exams={exams}
      filters={filters}
      subjects={subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        code: subject.code,
      }))}
      semesterId={active?.id ?? null}
    />
  );
}
