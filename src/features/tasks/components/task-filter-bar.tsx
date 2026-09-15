"use client";

import { ListFilter, Search, X } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { NativeSelect } from "@/components/form/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CATEGORY_LABELS,
  PRIORITY_META,
} from "@/features/tasks/components/task-badges";
import {
  TASK_CATEGORIES,
  TASK_DATE_FILTERS,
  TASK_PRIORITIES,
  TASK_SORTS,
  TASK_STATUS_FILTERS,
  type TaskFilters,
} from "@/services/task/task.schema";

const STATUS_LABELS: Record<(typeof TASK_STATUS_FILTERS)[number], string> = {
  ALL: "All",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
  ARCHIVED: "Archived",
};

const DATE_LABELS: Record<(typeof TASK_DATE_FILTERS)[number], string> = {
  ANY: "Any date",
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  THIS_WEEK: "This week",
  OVERDUE: "Overdue",
  NO_DEADLINE: "No deadline",
};

const SORT_LABELS: Record<(typeof TASK_SORTS)[number], string> = {
  SMART: "Smart order",
  DUE_DATE: "Due date",
  PRIORITY: "Priority",
  ESTIMATE: "Estimate",
  RECENTLY_CREATED: "Recently created",
  RECENTLY_UPDATED: "Recently updated",
  MANUAL: "Manual order",
};

const SEARCH_DEBOUNCE_MS = 250;

type TaskFilterBarProps = {
  readonly filters: TaskFilters;
  readonly resultCount: number;
};

/**
 * Filters, sort and search.
 *
 * State lives in the URL, not in component state. That makes a filtered view
 * shareable, survivable across a refresh, and navigable with the browser's
 * back button — and it means the server component can read the filters
 * directly and do the querying, instead of shipping the whole task list to
 * the client to filter there.
 */
export function TaskFilterBar({ filters, resultCount }: TaskFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [searchDraft, setSearchDraft] = useState(filters.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * `typedRoutes` verifies static hrefs, and a query string assembled at
   * runtime cannot be one. The PATH is a checked route; only the search
   * params vary, so the assertion is confined to this single helper rather
   * than sprinkled across every call site.
   */
  const toHref = useCallback(
    (params: URLSearchParams): Route => {
      const query = params.toString();
      return (query === "" ? pathname : `${pathname}?${query}`) as Route;
    },
    [pathname],
  );

  const applyParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === null || value === "" || value === "ANY") {
        params.delete(key);
      } else {
        params.set(key, value);
      }

      startTransition(() => {
        router.replace(toHref(params), { scroll: false });
      });
    },
    [router, searchParams, toHref],
  );

  // Debounced so typing does not fire a query per keystroke.
  const onSearchChange = (value: string) => {
    setSearchDraft(value);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      applyParam("search", value.trim() === "" ? null : value.trim());
    }, SEARCH_DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    [],
  );

  const activeFilterCount = [
    filters.status !== "ACTIVE",
    filters.priority !== undefined,
    filters.category !== undefined,
    filters.date !== "ANY",
  ].filter(Boolean).length;

  const clearAll = () => {
    setSearchDraft("");
    startTransition(() => {
      router.replace(toHref(new URLSearchParams()), { scroll: false });
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={searchDraft}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="h-8 pl-8"
        />
      </div>

      {/* Status is the most-used control, so it stays visible rather than
          being buried in the filter popover. */}
      <NativeSelect
        value={filters.status}
        onChange={(event) => applyParam("status", event.target.value)}
        aria-label="Filter by status"
        className="h-8 w-auto min-w-28 text-meta"
      >
        {TASK_STATUS_FILTERS.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </NativeSelect>

      {/* On mobile the remaining filters collapse into a popover so the bar
          never wraps into an unusable stack. */}
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5">
              <ListFilter className="size-3.5" />
              Filters
              {activeFilterCount > 0 ? (
                <Badge variant="secondary" className="ml-0.5 tabular-nums">
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
          }
        />

        <PopoverContent align="start" className="w-64 space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="filter-priority"
              className="text-label-caps text-muted-foreground"
            >
              Priority
            </label>
            <NativeSelect
              id="filter-priority"
              value={filters.priority ?? ""}
              onChange={(event) =>
                applyParam("priority", event.target.value || null)
              }
            >
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_META[priority].label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="filter-category"
              className="text-label-caps text-muted-foreground"
            >
              Category
            </label>
            <NativeSelect
              id="filter-category"
              value={filters.category ?? ""}
              onChange={(event) =>
                applyParam("category", event.target.value || null)
              }
            >
              <option value="">Any category</option>
              {TASK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="filter-date"
              className="text-label-caps text-muted-foreground"
            >
              Due
            </label>
            <NativeSelect
              id="filter-date"
              value={filters.date}
              onChange={(event) => applyParam("date", event.target.value)}
            >
              {TASK_DATE_FILTERS.map((date) => (
                <option key={date} value={date}>
                  {DATE_LABELS[date]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </PopoverContent>
      </Popover>

      <NativeSelect
        value={filters.sort}
        onChange={(event) => applyParam("sort", event.target.value)}
        aria-label="Sort tasks"
        className="h-8 w-auto min-w-36 text-meta"
      >
        {TASK_SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </NativeSelect>

      {activeFilterCount > 0 || searchDraft !== "" ? (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          <X className="size-3.5" />
          Clear
        </Button>
      ) : null}

      <span
        className="ml-auto text-label text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {isPending
          ? "Filtering…"
          : `${resultCount} ${resultCount === 1 ? "task" : "tasks"}`}
      </span>
    </div>
  );
}
