import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ProjectBoard } from "@/features/work/components/project-board";
import { requireProfileForPage } from "@/server/auth";
import {
  listProjects,
  listWorkspacesWithCounts,
} from "@/services/work/work.query";
import { projectFiltersSchema } from "@/services/work/work.schema";

export const metadata: Metadata = {
  title: "Projects",
};

/**
 * The project list.
 *
 * Filters arrive as search params and are parsed with the SAME Zod schema the
 * actions use, so a hand-edited URL cannot reach the query layer with a
 * filter the server never anticipated — it falls back to the defaults.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  const parsed = projectFiltersSchema.safeParse({
    view: params.view,
    workspaceId: params.workspaceId,
    priority: params.priority,
    sort: params.sort,
    search: params.search,
  });

  const filters = parsed.success ? parsed.data : projectFiltersSchema.parse({});

  const [projects, workspaces] = await Promise.all([
    listProjects(profile, filters),
    listWorkspacesWithCounts(profile),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Long-running efforts with milestones, blockers and real momentum."
      />

      <ProjectBoard
        projects={projects}
        workspaces={workspaces}
        filters={filters}
      />
    </div>
  );
}
