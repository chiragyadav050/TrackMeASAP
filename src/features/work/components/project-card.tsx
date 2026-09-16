import { Flag, OctagonX } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  HealthBadge,
  ProjectProgress,
  PROJECT_STATUS_LABELS,
  TargetIndicator,
} from "@/features/work/components/work-badges";
import { PriorityIndicator } from "@/features/tasks/components/task-badges";
import { cn } from "@/lib/utils";
import type { ProjectDto } from "@/types/work";

/**
 * One project, as it appears in a list.
 *
 * Reads top-down in the order a person actually asks: what is it, is it in
 * trouble, how far along is it, and what is next. Health sits beside the name
 * rather than at the bottom, because "blocked" is the thing you need to see
 * before deciding whether to read any further.
 */
export function ProjectCard({
  project,
  showWorkspace = true,
  className,
}: {
  project: ProjectDto;
  showWorkspace?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/projects/${project.id}` as never}
      className={cn(
        "flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        project.health === "BLOCKED" && "border-danger/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {/*
            Same reason as the grid item: a FLEX ITEM also defaults to
            `min-width: auto`, so without `min-w-0` here the name below refuses
            to shrink and `truncate` never gets the chance to ellipsise it.
          */}
          <div className="flex min-w-0 items-center gap-2">
            <PriorityIndicator priority={project.priority} showLabel={false} />
            <p className="truncate font-medium">{project.name}</p>
          </div>

          {showWorkspace ? (
            <p className="truncate text-label text-muted-foreground">
              {project.workspaceName}
            </p>
          ) : null}
        </div>

        <HealthBadge health={project.health} className="shrink-0" />
      </div>

      {project.openBlockerCount > 0 ? (
        <p className="flex items-center gap-1.5 text-label text-danger">
          <OctagonX className="size-3.5 shrink-0" aria-hidden />
          {project.openBlockerCount === 1
            ? "1 open blocker"
            : `${project.openBlockerCount} open blockers`}
        </p>
      ) : null}

      <ProjectProgress
        percent={project.progressPercent}
        completed={project.taskCompleted}
        total={project.taskTotal}
      />

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
        <TargetIndicator
          label={project.targetLabel}
          daysRemaining={project.daysRemaining}
        />

        {project.nextMilestoneTitle ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted-foreground">
            <Flag className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {project.nextMilestoneTitle}
              {project.nextMilestoneDueLabel
                ? ` · ${project.nextMilestoneDueLabel}`
                : ""}
            </span>
          </span>
        ) : null}

        {project.overdueTaskCount > 0 ? (
          <span className="text-label text-danger">
            {project.overdueTaskCount} overdue
          </span>
        ) : null}

        {project.isArchived ? (
          <Badge variant="secondary" className="ml-auto">
            Archived
          </Badge>
        ) : project.status === "PAUSED" || project.status === "PLANNED" ? (
          <Badge variant="outline" className="ml-auto">
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}
