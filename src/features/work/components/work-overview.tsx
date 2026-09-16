"use client";

import {
  Briefcase,
  Flag,
  FolderKanban,
  OctagonX,
  Plus,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/features/work/components/project-card";
import { ProjectDialog } from "@/features/work/components/project-dialog";
import { WorkspaceDialog } from "@/features/work/components/workspace-dialog";
import { WORKSPACE_TYPE_LABELS } from "@/features/work/components/work-badges";
import type { WorkOverviewDto } from "@/types/work";

/**
 * "What is going on with my work?"
 *
 * Ordered by urgency rather than by entity: blocked first, then at risk, then
 * what is coming up. A user who opens this page and sees nothing alarming
 * should be able to close it again in two seconds.
 */
export function WorkOverview({ view }: { view: WorkOverviewDto }) {
  const [isProjectOpen, setIsProjectOpen] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);

  const hasWorkspaces = view.workspaces.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work"
        description="Workspaces, projects and everything currently standing in their way."
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsWorkspaceOpen(true)}
            >
              <Plus className="size-3.5" />
              Workspace
            </Button>

            {hasWorkspaces ? (
              <Button size="sm" onClick={() => setIsProjectOpen(true)}>
                <Plus className="size-3.5" />
                New project
              </Button>
            ) : null}
          </>
        }
      />

      {!hasWorkspaces ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={Briefcase}
            title="Start with a workspace."
            description="A workspace is one context you keep separate in your head — freelance, a business, coursework side projects. Projects live inside them."
            action={
              <Button size="sm" onClick={() => setIsWorkspaceOpen(true)}>
                Create a workspace
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {view.blockedProjects.length > 0 || view.atRiskProjects.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.blockedProjects.length > 0 ? (
                <SectionCard
                  title="Blocked"
                  icon={OctagonX}
                  description="Nothing moves on these until the blocker clears."
                >
                  <ul className="divide-y divide-border-subtle">
                    {view.blockedProjects.map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects/${project.id}` as never}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-meta transition-colors hover:bg-surface-sunken"
                        >
                          <span className="min-w-0 truncate">
                            {project.name}
                          </span>
                          <span className="shrink-0 text-label text-danger">
                            {project.openBlockerCount === 1
                              ? "1 blocker"
                              : `${project.openBlockerCount} blockers`}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {view.atRiskProjects.length > 0 ? (
                <SectionCard
                  title="Needs attention"
                  icon={TriangleAlert}
                  description={
                    view.totalOverdueTasks > 0
                      ? `${view.totalOverdueTasks} overdue ${view.totalOverdueTasks === 1 ? "task" : "tasks"} across your projects.`
                      : "Deadlines are close relative to how much is done."
                  }
                >
                  <ul className="divide-y divide-border-subtle">
                    {view.atRiskProjects.map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/projects/${project.id}` as never}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-meta transition-colors hover:bg-surface-sunken"
                        >
                          <span className="min-w-0 truncate">
                            {project.name}
                          </span>
                          <span className="shrink-0 text-label text-muted-foreground">
                            {project.targetLabel ?? "No target date"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}
            </div>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-heading font-medium tracking-tight">
                Workspaces
              </h2>
            </div>

            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {view.workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link
                    href={`/projects?workspaceId=${workspace.id}` as never}
                    className="block h-full rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
                  >
                    <p className="truncate font-medium">{workspace.name}</p>
                    <p className="text-label text-muted-foreground">
                      {WORKSPACE_TYPE_LABELS[workspace.type]}
                    </p>

                    <p className="mt-3 text-label text-muted-foreground">
                      {workspace.activeProjectCount === 0
                        ? "No active projects"
                        : `${workspace.activeProjectCount} active ${workspace.activeProjectCount === 1 ? "project" : "projects"}`}
                      {workspace.blockedProjectCount > 0
                        ? ` · ${workspace.blockedProjectCount} blocked`
                        : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-heading font-medium tracking-tight">
                Active projects
              </h2>

              <Button
                size="sm"
                variant="ghost"
                render={<Link href="/projects">See all</Link>}
              />
            </div>

            {view.projects.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface">
                <EmptyState
                  icon={FolderKanban}
                  title="No active projects."
                  description="Create one and its progress, milestones and blockers will show up here."
                  action={
                    <Button size="sm" onClick={() => setIsProjectOpen(true)}>
                      New project
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {view.projects.slice(0, 6).map((project) => (
                  <li key={project.id}>
                    <ProjectCard project={project} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.upcomingMilestones.length > 0 ? (
            <SectionCard
              title="Milestones in the next two weeks"
              icon={Flag}
              className="lg:max-w-2xl"
            >
              <ul className="divide-y divide-border-subtle">
                {view.upcomingMilestones.map((milestone) => (
                  <li key={milestone.id}>
                    <Link
                      href={`/projects/${milestone.projectId}` as never}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-meta transition-colors hover:bg-surface-sunken"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">
                          {milestone.title}
                        </span>
                        <span className="block truncate text-label text-muted-foreground">
                          {milestone.projectName}
                        </span>
                      </span>

                      <span className="shrink-0 text-label text-muted-foreground">
                        {milestone.dueLabel}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </>
      )}

      <WorkspaceDialog
        isOpen={isWorkspaceOpen}
        onOpenChange={setIsWorkspaceOpen}
      />

      <ProjectDialog
        isOpen={isProjectOpen}
        onOpenChange={setIsProjectOpen}
        workspaces={view.workspaces}
      />
    </div>
  );
}
