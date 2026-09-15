import { OctagonX } from "lucide-react";
import Link from "next/link";

import { SectionCard } from "@/components/common/section-card";
import { HealthBadge } from "@/features/work/components/work-badges";
import type { ProjectsSummaryDto } from "@/types/work";

/**
 * Work, as it matters to today.
 *
 * Deliberately narrow: project TASKS already appear in the lists above,
 * because they are ordinary tasks. What those lists cannot show is a project
 * that is stuck — nothing will appear as due, and the silence reads as
 * progress. So this panel renders ONLY when something needs attention, and
 * stays absent otherwise rather than occupying the sidebar with "all clear".
 */
export function WorkPanel({ work }: { work: ProjectsSummaryDto }) {
  const needsAttention = work.projects.filter(
    (project) =>
      project.health === "BLOCKED" ||
      project.health === "OVERDUE" ||
      project.health === "AT_RISK",
  );

  if (needsAttention.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title="Projects needing attention"
      icon={OctagonX}
      badge={String(needsAttention.length)}
    >
      <ul className="divide-y divide-border-subtle">
        {needsAttention.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}` as never}
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-meta">{project.name}</span>
                <span className="block truncate text-label text-muted-foreground">
                  {project.openBlockerCount > 0
                    ? project.openBlockerCount === 1
                      ? "1 open blocker"
                      : `${project.openBlockerCount} open blockers`
                    : project.overdueTaskCount > 0
                      ? `${project.overdueTaskCount} overdue ${project.overdueTaskCount === 1 ? "task" : "tasks"}`
                      : (project.targetLabel ?? project.workspaceName)}
                </span>
              </span>

              <HealthBadge
                health={project.health}
                showLabel={false}
                className="shrink-0"
              />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
