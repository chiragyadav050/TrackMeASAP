"use client";

import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NativeSelect } from "@/components/form/native-select";
import {
  deleteProjectCommand,
  setProjectArchivedCommand,
  setProjectStatusCommand,
} from "@/features/work/actions";
import { BlockerPanel } from "@/features/work/components/blocker-panel";
import { MilestonePanel } from "@/features/work/components/milestone-panel";
import { ProjectDialog } from "@/features/work/components/project-dialog";
import { ProjectTaskPanel } from "@/features/work/components/project-task-panel";
import {
  HEALTH_META,
  HealthBadge,
  ProjectProgress,
  PROJECT_STATUS_LABELS,
  TargetIndicator,
} from "@/features/work/components/work-badges";
import type { ProjectDetailDto, WorkspaceDto } from "@/types/work";

const SELECTABLE_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;

/**
 * One project, in full.
 *
 * The header answers "should I be worried?" before anything else: health,
 * with the reason spelled out underneath in words rather than left implicit
 * in a colour.
 */
export function ProjectDetail({
  detail,
  workspaces,
}: {
  detail: ProjectDetailDto;
  workspaces: readonly WorkspaceDto[];
}) {
  const { project, milestones, blockers, tasks } = detail;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    fallback: string,
    onDone?: () => void,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? fallback);
        return;
      }

      // Deleting navigates away; everything else re-reads the current page.
      if (onDone) {
        onDone();
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2 text-muted-foreground"
          render={
            <Link href="/projects">
              <ChevronLeft className="size-3.5" />
              All projects
            </Link>
          }
        />

        <PageHeader
          eyebrow={project.workspaceName}
          title={project.name}
          description={project.description ?? undefined}
          actions={
            <>
              <NativeSelect
                aria-label="Project status"
                value={project.status}
                disabled={isPending}
                className="h-9 w-auto"
                onChange={(event) =>
                  run(
                    () =>
                      setProjectStatusCommand({
                        projectId: project.id,
                        status: event.target
                          .value as (typeof SELECTABLE_STATUSES)[number],
                      }),
                    "Couldn't change the status.",
                  )
                }
              >
                {SELECTABLE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PROJECT_STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditOpen(true)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="More project actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  }
                />

                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        () =>
                          setProjectArchivedCommand({
                            projectId: project.id,
                            isArchived: !project.isArchived,
                          }),
                        "Couldn't archive the project.",
                      )
                    }
                  >
                    {project.isArchived ? (
                      <>
                        <ArchiveRestore className="size-4 text-muted-foreground" />
                        Restore
                      </>
                    ) : (
                      <>
                        <Archive className="size-4 text-muted-foreground" />
                        Archive
                      </>
                    )}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    className="text-danger"
                    onClick={() => {
                      // Permanent. Archiving — offered directly above — is the
                      // reversible option, and the tasks survive either way.
                      const confirmed = window.confirm(
                        `Delete "${project.name}" permanently? Its tasks are kept and simply unlinked. Archiving keeps the project retrievable instead.`,
                      );

                      if (confirmed) {
                        run(
                          () => deleteProjectCommand({ projectId: project.id }),
                          "Couldn't delete the project.",
                          () => router.push("/projects"),
                        );
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete permanently
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <HealthBadge health={project.health} />
            <p className="max-w-md text-label text-muted-foreground">
              {HEALTH_META[project.health].description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <TargetIndicator
              label={project.targetLabel}
              daysRemaining={project.daysRemaining}
            />

            {project.isArchived ? (
              <Badge variant="secondary">Archived</Badge>
            ) : null}
          </div>
        </div>

        <ProjectProgress
          percent={project.progressPercent}
          completed={project.taskCompleted}
          total={project.taskTotal}
          className="mt-4 max-w-md"
        />

        {project.milestoneTotal > 0 ? (
          <p className="mt-2 text-label text-muted-foreground">
            {project.milestoneCompleted} of {project.milestoneTotal} milestones
            complete. Progress above is measured from tasks, so it stays
            comparable across projects.
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProjectTaskPanel projectId={project.id} tasks={tasks} />
        <MilestonePanel projectId={project.id} milestones={milestones} />
        <BlockerPanel projectId={project.id} blockers={blockers} />
      </div>

      <ProjectDialog
        isOpen={isEditOpen}
        onOpenChange={setIsEditOpen}
        workspaces={workspaces}
        project={project}
      />
    </div>
  );
}
