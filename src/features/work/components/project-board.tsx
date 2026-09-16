"use client";

import { FolderKanban, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/form/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectCard } from "@/features/work/components/project-card";
import { ProjectDialog } from "@/features/work/components/project-dialog";
import { PROJECT_VIEWS } from "@/services/work/work.schema";
import type { ProjectDto, WorkspaceDto } from "@/types/work";

const VIEW_LABELS: Readonly<Record<(typeof PROJECT_VIEWS)[number], string>> = {
  ACTIVE: "Active",
  ALL: "All",
  PLANNED: "Planned",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

/** Long enough to skip a burst of keystrokes, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 300;

const SORT_LABELS = {
  TARGET_DATE: "Target date",
  PRIORITY: "Priority",
  RECENTLY_UPDATED: "Recently updated",
  NAME: "Name",
} as const;

type ProjectBoardProps = {
  readonly projects: readonly ProjectDto[];
  readonly workspaces: readonly WorkspaceDto[];
  readonly filters: {
    readonly view: string;
    readonly sort: string;
    readonly workspaceId?: string;
    readonly search?: string;
  };
};

/**
 * The project list.
 *
 * FILTER STATE LIVES IN THE URL, not in component state: a filtered view is
 * something you bookmark, share and come back to, and the server needs it
 * anyway to run the query. The inputs below only ever push a new URL.
 */
export function ProjectBoard({
  projects,
  workspaces,
  filters,
}: ProjectBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());

    if (value === null || value === "") {
      next.delete(key);
    } else {
      next.set(key, value);
    }

    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}` as never, {
        scroll: false,
      });
    });
  };

  // Debounced search: typing must not fire a query per keystroke, but the URL
  // still has to end up holding whatever was typed. Written out in full here
  // rather than calling `setParam`, so the effect depends only on values —
  // stashing the closure in a ref would mean writing to it during render.
  useEffect(() => {
    if (searchDraft === (searchParams.get("search") ?? "")) {
      return;
    }

    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());

      if (searchDraft === "") {
        next.delete("search");
      } else {
        next.set("search", searchDraft);
      }

      router.replace(`${pathname}?${next.toString()}` as never, {
        scroll: false,
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchDraft, searchParams, router, pathname]);

  const hasWorkspaces = workspaces.length > 0;

  if (!hasWorkspaces) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={FolderKanban}
          title="Create a workspace first"
          description="Projects live inside a workspace — freelance, business, personal, whatever you actually separate in your head."
          action={
            <Button size="sm" render={<Link href="/work">Go to Work</Link>} />
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter projects by status"
        >
          {PROJECT_VIEWS.map((view) => (
            <Button
              key={view}
              size="sm"
              variant={filters.view === view ? "secondary" : "ghost"}
              aria-pressed={filters.view === view}
              onClick={() => setParam("view", view === "ACTIVE" ? null : view)}
            >
              {VIEW_LABELS[view]}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              className="h-9 pl-8"
            />
          </div>

          <NativeSelect
            aria-label="Workspace"
            value={filters.workspaceId ?? ""}
            onChange={(event) =>
              setParam("workspaceId", event.target.value || null)
            }
            className="h-9 w-auto"
          >
            <option value="">All workspaces</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Sort projects"
            value={filters.sort}
            onChange={(event) => setParam("sort", event.target.value)}
            className="h-9 w-auto"
          >
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>

          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-3.5" />
            New project
          </Button>
        </div>
      </div>

      <div aria-busy={isPending}>
        {projects.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              size="page"
              icon={FolderKanban}
              title={
                filters.search
                  ? `No projects match “${filters.search}”.`
                  : filters.view === "ARCHIVED"
                    ? "Nothing archived."
                    : "No projects here yet."
              }
              description={
                filters.search
                  ? "Try a different search, or clear it to see everything."
                  : "A project is any effort with more than one step and an end in sight."
              }
              action={
                filters.search ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSearchDraft("")}
                  >
                    Clear search
                  </Button>
                ) : filters.view === "ARCHIVED" ? null : (
                  <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                    New project
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              // `min-w-0` because a GRID ITEM defaults to `min-width: auto`,
              // which means "at least as wide as my content". A long project
              // name therefore widened the column past the viewport and
              // scrolled the whole page sideways on a 320px screen, defeating
              // the `truncate` inside the card.
              <li key={project.id} className="min-w-0">
                <ProjectCard project={project} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProjectDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        workspaces={workspaces}
        defaultWorkspaceId={filters.workspaceId}
      />
    </div>
  );
}
