"use client";

import {
  Activity,
  Briefcase,
  FolderKanban,
  GraduationCap,
  ListTodo,
  Monitor,
  Moon,
  Plus,
  Sun,
  Target,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NAV_GROUPS } from "@/config/navigation";
import { CURRENT_PHASE } from "@/config/phases";
import { searchAcademicsCommand } from "@/features/academics/actions";
import { searchTasksCommand } from "@/features/tasks/actions";
import { searchWorkCommand } from "@/features/work/actions";
import { searchLifeCommand } from "@/features/life/actions";
import {
  DueIndicator,
  PriorityIndicator,
} from "@/features/tasks/components/task-badges";
import type { AcademicSearchResult } from "@/services/academics/academic.search";
import type { TaskDto } from "@/types/task";
import type { WorkSearchResult } from "@/types/work";
import type { LifeSearchResult } from "@/types/life";

type CommandPaletteProps = {
  readonly isOpen: boolean;
  readonly onOpenChange: (next: boolean) => void;
  /** Opens the task dialog. Absent on surfaces that cannot create tasks. */
  readonly onCreateTask?: () => void;
};

/** Long enough to avoid a query per keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 2;

const ACADEMIC_KIND_LABELS: Record<AcademicSearchResult["kind"], string> = {
  SEMESTER: "Semester",
  SUBJECT: "Subject",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  ASSESSMENT: "Test",
  NOTE: "Note",
};

const WORK_KIND_LABELS: Record<WorkSearchResult["kind"], string> = {
  PROJECT: "Project",
  WORKSPACE: "Workspace",
};

const THEME_COMMANDS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * ⌘K palette.
 *
 * Phase 2 adds live task search and "New task" alongside the navigation and
 * theme commands. Every entry still does something real today — AI commands
 * arrive with the phase that makes them meaningful.
 *
 * Search is debounced and runs through an authenticated server action, so
 * results are scoped to the caller's own tasks by the same rules as every
 * other read.
 */
export function CommandPalette({
  isOpen,
  onOpenChange,
  onCreateTask,
}: CommandPaletteProps) {
  const router = useRouter();
  const { setTheme } = useTheme();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly TaskDto[]>([]);
  const [academicResults, setAcademicResults] = useState<
    readonly AcademicSearchResult[]
  >([]);
  const [workResults, setWorkResults] = useState<readonly WorkSearchResult[]>(
    [],
  );
  const [lifeResults, setLifeResults] = useState<readonly LifeSearchResult[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);

  // Guards against an earlier, slower response overwriting a later one.
  const requestIdRef = useRef(0);

  const trimmedQuery = query.trim();
  const isQueryable = trimmedQuery.length >= MIN_QUERY_LENGTH;

  // Derived, not synchronised: a query too short to search shows nothing,
  // without an effect having to clear the previous results.
  const visibleResults = isQueryable ? results : [];
  const visibleAcademics = isQueryable ? academicResults : [];
  const visibleWork = isQueryable ? workResults : [];
  const visibleLife = isQueryable ? lifeResults : [];
  const showSearching = isQueryable && isSearching;

  // Reset between openings so a previous search is not still on screen.
  // Adjusting state during render is React's documented pattern for
  // "prop changed, derived state must follow" and costs no extra pass.
  const [wasOpen, setWasOpen] = useState(isOpen);

  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);

    if (!isOpen) {
      setQuery("");
      setResults([]);
      setAcademicResults([]);
      setWorkResults([]);
      setLifeResults([]);
      setIsSearching(false);
    }
  }

  useEffect(() => {
    if (!isQueryable) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    // Every state write happens inside the timer/promise callbacks, never
    // synchronously in the effect body.
    const timer = setTimeout(() => {
      setIsSearching(true);

      // Every domain in parallel — one round-trip's latency, not four.
      void Promise.all([
        searchTasksCommand({ query: trimmedQuery, limit: 6 }),
        searchAcademicsCommand({ query: trimmedQuery, limit: 6 }),
        searchWorkCommand({ query: trimmedQuery, limit: 6 }),
        searchLifeCommand({ query: trimmedQuery, limit: 6 }),
      ]).then(([taskResult, academicResult, workResult, lifeResult]) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setIsSearching(false);
        setResults(taskResult.status === "success" ? taskResult.data : []);
        setAcademicResults(
          academicResult.status === "success" ? academicResult.data : [],
        );
        setWorkResults(workResult.status === "success" ? workResult.data : []);
        setLifeResults(lifeResult.status === "success" ? lifeResult.data : []);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmedQuery, isQueryable]);

  const run = useCallback(
    (action: () => void) => {
      onOpenChange(false);
      action();
    },
    [onOpenChange],
  );

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a surface or change the theme."
    >
      <CommandInput
        placeholder="Search tasks, or jump to…"
        value={query}
        onValueChange={setQuery}
      />

      <CommandList className="max-h-[22rem]">
        <CommandEmpty>
          {showSearching ? "Searching…" : "No matching command."}
        </CommandEmpty>

        {onCreateTask ? (
          <CommandGroup heading="Create">
            <CommandItem
              value="New task create capture todo"
              onSelect={() => run(onCreateTask)}
            >
              <Plus className="size-4 text-muted-foreground" aria-hidden />
              <span>New task</span>
              <span className="ml-auto text-label text-muted-foreground">
                c
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {visibleResults.length > 0 ? (
          <CommandGroup heading="Tasks">
            {visibleResults.map((task) => (
              <CommandItem
                key={task.id}
                // cmdk filters client-side too; keeping the raw title here
                // stops it hiding a result the server deliberately returned.
                value={`task-${task.id} ${task.title}`}
                onSelect={() => run(() => router.push("/tasks"))}
              >
                <ListTodo
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>

                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <DueIndicator
                    dueLabel={task.dueLabel}
                    dueTimeLabel={null}
                    overdueLabel={task.overdueLabel}
                    isOverdue={task.isOverdue}
                  />
                  <PriorityIndicator priority={task.priority} />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {NAV_GROUPS.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((item) => {
              const Icon = item.icon;

              return (
                <CommandItem
                  key={item.href}
                  // cmdk matches against this string, so the surface
                  // description makes items findable by intent as well as
                  // by name ("exam" finds Academics).
                  value={`${item.label} ${item.description}`}
                  onSelect={() => run(() => router.push(item.href))}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span>Go to {item.label}</span>

                  {item.phase > CURRENT_PHASE ? (
                    <span className="ml-auto text-label text-muted-foreground tabular-nums">
                      Phase {item.phase}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        {visibleAcademics.length > 0 ? (
          <CommandGroup heading="Academics">
            {visibleAcademics.map((entry) => (
              <CommandItem
                key={`${entry.kind}-${entry.id}`}
                value={`academic-${entry.id} ${entry.title}`}
                onSelect={() => run(() => router.push(entry.href as never))}
              >
                <GraduationCap
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="ml-auto shrink-0 text-label text-muted-foreground">
                  {entry.subtitle ?? ACADEMIC_KIND_LABELS[entry.kind]}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {visibleWork.length > 0 ? (
          <CommandGroup heading="Work">
            {visibleWork.map((entry) => {
              const Icon = entry.kind === "PROJECT" ? FolderKanban : Briefcase;

              return (
                <CommandItem
                  key={`${entry.kind}-${entry.id}`}
                  value={`work-${entry.id} ${entry.title}`}
                  onSelect={() => run(() => router.push(entry.href as never))}
                >
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="ml-auto shrink-0 text-label text-muted-foreground">
                    {entry.subtitle ?? WORK_KIND_LABELS[entry.kind]}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {visibleLife.length > 0 ? (
          <CommandGroup heading="Life">
            {visibleLife.map((entry) => {
              const Icon = entry.kind === "GOAL" ? Target : Activity;

              return (
                <CommandItem
                  key={`${entry.kind}-${entry.id}`}
                  value={`life-${entry.id} ${entry.title}`}
                  onSelect={() => run(() => router.push(entry.href as never))}
                >
                  <Icon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="ml-auto shrink-0 text-label text-muted-foreground">
                    {entry.subtitle}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Appearance">
          {THEME_COMMANDS.map((option) => {
            const Icon = option.icon;

            return (
              <CommandItem
                key={option.value}
                value={`Toggle theme ${option.label}`}
                onSelect={() => run(() => setTheme(option.value))}
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                <span>Theme: {option.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
