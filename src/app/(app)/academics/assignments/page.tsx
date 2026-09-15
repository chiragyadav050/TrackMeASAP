import type { Metadata } from "next";

import { AssignmentManager } from "@/features/academics/components/assignment-manager";
import { requireProfileForPage } from "@/server/auth";
import { listAssignments } from "@/services/academics/academic.query";
import { assignmentFiltersSchema } from "@/services/academics/academic.schema";
import {
  listSubjects,
  resolveActiveSemester,
} from "@/services/academics/semester.service";

export const metadata: Metadata = {
  title: "Assignments",
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  // A hand-edited URL degrades to the default view rather than erroring.
  const parsed = assignmentFiltersSchema.safeParse({
    view: params.view,
    semesterId: params.semesterId,
    subjectId: params.subjectId,
    priority: params.priority,
    sort: params.sort,
    search: params.search,
  });

  const filters = parsed.success
    ? parsed.data
    : assignmentFiltersSchema.parse({});

  const active = await resolveActiveSemester(profile.id);

  const [assignments, subjects] = await Promise.all([
    listAssignments(profile, filters),
    listSubjects(profile.id, active ? { semesterId: active.id } : {}),
  ]);

  return (
    <AssignmentManager
      assignments={assignments}
      filters={filters}
      subjects={subjects.map((subject) => ({
        id: subject.id,
        name: subject.name,
        code: subject.code,
      }))}
    />
  );
}
