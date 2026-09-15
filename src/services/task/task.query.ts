import "server-only";

import type { Prisma, Profile, Task } from "@/generated/prisma/client";
import {
  endOfLocalDay,
  formatInTimeZone,
  greetingFor,
  localDateKey,
  localDayDifference,
  localTimeKey,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  buildTaskLabels,
  isOverdue,
  isTerminal,
} from "@/services/task/task.derive";
import {
  rankTasks,
  selectNextBestAction,
} from "@/services/task/task.prioritization";
import type { TaskFilters } from "@/services/task/task.schema";
import type {
  NextBestActionDto,
  TaskDetailDto,
  TaskDto,
  TaskStatisticsDto,
  TodayViewDto,
} from "@/types/task";

/**
 * Task reads.
 *
 * Like the mutation service, every query here is scoped by a `profileId` that
 * came from the Clerk session. There is no unscoped `findMany` in this file.
 *
 * All date-derived labels are produced HERE, in the profile's zone, and sent
 * to the client as finished strings — see the note on `TaskDto`.
 */

/** The helper bundle the pure prioritisation module is called with. */
const TIME_HELPERS = { endOfLocalDay, localDayDifference } as const;

/**
 * "Not finished with" — the status filter behind every active view.
 *
 * Declared once with Prisma's own type rather than inline `as const` objects:
 * a readonly tuple is not assignable to Prisma's mutable `notIn`, and having
 * a single definition means the four places that need it cannot drift.
 */
const ACTIVE_STATUS: Prisma.EnumTaskStatusFilter = {
  notIn: ["COMPLETED", "CANCELLED"],
};

type TaskWithCounts = Task & {
  readonly subtasks?: { id: string; isCompleted: boolean }[];
  readonly _count?: { subtasks: number };
};

const SUBTASK_COUNT_SELECT = {
  subtasks: { select: { id: true, isCompleted: true } },
} satisfies Prisma.TaskInclude;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export function toTaskDto(
  task: TaskWithCounts,
  now: Date,
  timeZone: string,
  locale: string,
): TaskDto {
  const subtasks = task.subtasks ?? [];
  const labels = buildTaskLabels(task, now, timeZone, locale, endOfLocalDay);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    category: task.category,
    energy: task.energy,
    dueAt: task.dueAt,
    isAllDay: task.isAllDay,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    isCompleted: task.status === "COMPLETED",
    completedAt: task.completedAt,
    isArchived: task.archivedAt !== null,
    isOverdue: isOverdue(task, now, timeZone, endOfLocalDay),
    overdueLabel: labels.overdueLabel,
    dueLabel: labels.dueLabel,
    dueTimeLabel: labels.dueTimeLabel,
    estimateLabel: labels.estimateLabel,
    dueDateInput: task.dueAt ? localDateKey(task.dueAt, timeZone) : null,
    dueTimeInput:
      task.dueAt && !task.isAllDay ? localTimeKey(task.dueAt, timeZone) : null,
    subtaskTotal: subtasks.length,
    subtaskCompleted: subtasks.filter((subtask) => subtask.isCompleted).length,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/**
 * Translates the UI's filters into a Prisma WHERE clause.
 *
 * Exported for unit testing: the date filters are the part most likely to go
 * subtly wrong, and asserting the generated clause is cheaper and clearer
 * than round-tripping every case through the database.
 */
export function buildTaskWhere(
  profileId: string,
  filters: TaskFilters,
  now: Date,
  timeZone: string,
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { profileId };

  // --- Status ------------------------------------------------------------
  // Archived rows leave every view except the explicit "Archived" one.
  if (filters.status === "ARCHIVED") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
  }

  if (filters.status === "ACTIVE") {
    where.status = { notIn: ["COMPLETED", "CANCELLED"] };
  } else if (filters.status === "COMPLETED") {
    where.status = "COMPLETED";
  } else if (filters.status === "OVERDUE") {
    // Overdue is derived, so it is expressed as a query rather than read from
    // a column: active, dated, and past its deadline. All-day tasks are only
    // late once their whole local day has elapsed.
    where.status = { notIn: ["COMPLETED", "CANCELLED"] };
    where.OR = [
      { isAllDay: false, dueAt: { lt: now } },
      { isAllDay: true, dueAt: { lt: startOfLocalDay(now, timeZone) } },
    ];
  }

  // --- Explicit date filter ---------------------------------------------
  const dateClause = buildDateClause(filters.date, now, timeZone);

  if (dateClause) {
    // Combine with AND so a date filter never silently replaces the OR the
    // OVERDUE status filter may already have installed.
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), dateClause];
  }

  if (filters.priority) {
    where.priority = filters.priority;
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          { notes: { contains: filters.search, mode: "insensitive" } },
        ],
      },
    ];
  }

  return where;
}

function buildDateClause(
  date: TaskFilters["date"],
  now: Date,
  timeZone: string,
): Prisma.TaskWhereInput | null {
  if (date === "ANY") {
    return null;
  }

  if (date === "NO_DEADLINE") {
    return { dueAt: null };
  }

  if (date === "OVERDUE") {
    return {
      status: { notIn: ["COMPLETED", "CANCELLED"] },
      OR: [
        { isAllDay: false, dueAt: { lt: now } },
        { isAllDay: true, dueAt: { lt: startOfLocalDay(now, timeZone) } },
      ],
    };
  }

  // Half-open ranges over local-day boundaries, so nothing is double-counted
  // and nothing falls between two windows.
  const dayStart = startOfLocalDay(now, timeZone);

  if (date === "TODAY") {
    return {
      dueAt: { gte: dayStart, lt: startOfLocalDayOffset(now, timeZone, 1) },
    };
  }

  if (date === "TOMORROW") {
    return {
      dueAt: {
        gte: startOfLocalDayOffset(now, timeZone, 1),
        lt: startOfLocalDayOffset(now, timeZone, 2),
      },
    };
  }

  // THIS_WEEK — today through the next seven local days.
  return {
    dueAt: { gte: dayStart, lt: startOfLocalDayOffset(now, timeZone, 7) },
  };
}

function buildOrderBy(
  sort: TaskFilters["sort"],
): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case "DUE_DATE":
      // Undated tasks sort last rather than first.
      return [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];

    case "PRIORITY":
      // The enum is declared LOW→URGENT, so descending gives URGENT first.
      return [
        { priority: "desc" },
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ];

    case "ESTIMATE":
      return [
        { estimatedMinutes: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ];

    case "RECENTLY_CREATED":
      return [{ createdAt: "desc" }];

    case "RECENTLY_UPDATED":
      return [{ updatedAt: "desc" }];

    case "MANUAL":
      return [{ position: "asc" }, { createdAt: "desc" }];

    case "SMART":
    default:
      // SMART is ranked in application code by the prioritisation engine;
      // this is only a stable base ordering for it to re-sort.
      return [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }];
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Cap on a single list read, so a large account cannot stall a page. */
const LIST_LIMIT = 200;

export async function listTasks(
  profile: Profile,
  filters: TaskFilters,
  now: Date = new Date(),
): Promise<readonly TaskDto[]> {
  const rows = await db.task.findMany({
    where: buildTaskWhere(profile.id, filters, now, profile.timeZone),
    orderBy: buildOrderBy(filters.sort),
    include: SUBTASK_COUNT_SELECT,
    take: LIST_LIMIT,
  });

  const dtos = rows.map((task) =>
    toTaskDto(task, now, profile.timeZone, profile.locale),
  );

  if (filters.sort !== "SMART") {
    return dtos;
  }

  return applySmartOrder(rows, dtos, now, profile.timeZone);
}

/**
 * Re-orders an already-fetched page using the prioritisation engine.
 *
 * The engine needs the whole set at once, so this runs after the query rather
 * than as an ORDER BY. Terminal tasks (completed, cancelled) are appended
 * unranked — they are history, and scoring them would only shuffle them.
 */
function applySmartOrder(
  rows: readonly Task[],
  dtos: readonly TaskDto[],
  now: Date,
  timeZone: string,
): readonly TaskDto[] {
  const byId = new Map(dtos.map((dto) => [dto.id, dto]));

  const actionable = rows.filter((task) => !isTerminal(task));
  const settled = rows.filter((task) => isTerminal(task));

  const orderedIds = [
    ...rankTasks(actionable, now, timeZone, TIME_HELPERS).map(
      (entry) => entry.task.id,
    ),
    ...settled.map((task) => task.id),
  ];

  return orderedIds
    .map((id) => byId.get(id))
    .filter((dto): dto is TaskDto => dto !== undefined);
}

export async function getTaskDetail(
  profile: Profile,
  taskId: string,
  now: Date = new Date(),
): Promise<TaskDetailDto | null> {
  const task = await db.task.findFirst({
    where: { id: taskId, profileId: profile.id },
    include: {
      subtasks: {
        orderBy: { position: "asc" },
      },
    },
  });

  if (!task) {
    return null;
  }

  return {
    ...toTaskDto(
      { ...task, subtasks: task.subtasks },
      now,
      profile.timeZone,
      profile.locale,
    ),
    subtasks: task.subtasks.map((subtask) => ({
      id: subtask.id,
      taskId: subtask.taskId,
      title: subtask.title,
      isCompleted: subtask.isCompleted,
      position: subtask.position,
    })),
  };
}

/** Fast title/description search for the command palette. */
export async function searchTasks(
  profile: Profile,
  query: string,
  limit: number,
  now: Date = new Date(),
): Promise<readonly TaskDto[]> {
  const rows = await db.task.findMany({
    where: {
      profileId: profile.id,
      archivedAt: null,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: SUBTASK_COUNT_SELECT,
    take: limit,
  });

  return rows.map((task) =>
    toTaskDto(task, now, profile.timeZone, profile.locale),
  );
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Counts for Today and the dashboard.
 *
 * Computed from the source of truth on every request rather than stored.
 * A cached count is a count that can be wrong, and at this data volume the
 * four indexed counts below are far cheaper than the machinery needed to keep
 * a materialised figure honest.
 */
export async function getTaskStatistics(
  profile: Profile,
  now: Date = new Date(),
): Promise<TaskStatisticsDto> {
  const timeZone = profile.timeZone;
  const dayStart = startOfLocalDay(now, timeZone);
  const dayEnd = startOfLocalDayOffset(now, timeZone, 1);

  const base = { profileId: profile.id, archivedAt: null };

  const [activeCount, dueTodayTotal, completedToday, overdueCount] =
    await Promise.all([
      db.task.count({ where: { ...base, status: ACTIVE_STATUS } }),

      // Everything scheduled for today, done or not — the denominator.
      db.task.count({
        where: { ...base, dueAt: { gte: dayStart, lt: dayEnd } },
      }),

      // Completed during today's local day, whatever it was due.
      db.task.count({
        where: {
          ...base,
          status: "COMPLETED",
          completedAt: { gte: dayStart, lt: dayEnd },
        },
      }),

      db.task.count({
        where: {
          ...base,
          status: ACTIVE_STATUS,
          OR: [
            { isAllDay: false, dueAt: { lt: now } },
            { isAllDay: true, dueAt: { lt: dayStart } },
          ],
        },
      }),
    ]);

  return {
    activeCount,
    dueTodayTotal,
    completedToday,
    overdueCount,
    todayCompletionPercent: computeCompletionPercent(
      completedToday,
      dueTodayTotal,
    ),
  };
}

/**
 * Today's completion percentage.
 *
 * The denominator is everything due today; the numerator is what was
 * completed today. Completing something that was NOT due today can therefore
 * push the numerator above the denominator, so the result is clamped to 100
 * rather than reporting "140% complete".
 */
export function computeCompletionPercent(
  completed: number,
  total: number,
): number {
  if (total <= 0) {
    return completed > 0 ? 100 : 0;
  }

  return Math.min(100, Math.round((completed / total) * 100));
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/** How far ahead the "Upcoming" section looks. */
const UPCOMING_DAYS = 7;
const UPCOMING_LIMIT = 8;

/**
 * Everything the Today page needs, in one round-trip.
 *
 * Assembled server-side so the page is a single await and the client receives
 * finished view models — no second fetch, no client-side date maths.
 */
export async function getTodayView(
  profile: Profile,
  now: Date = new Date(),
): Promise<TodayViewDto> {
  const timeZone = profile.timeZone;
  const dayStart = startOfLocalDay(now, timeZone);
  const dayEnd = startOfLocalDayOffset(now, timeZone, 1);
  const horizon = startOfLocalDayOffset(now, timeZone, UPCOMING_DAYS + 1);

  const base = { profileId: profile.id, archivedAt: null };

  const [
    dueTodayRows,
    completedTodayRows,
    overdueRows,
    upcomingRows,
    statistics,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        ...base,
        status: ACTIVE_STATUS,
        dueAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      include: SUBTASK_COUNT_SELECT,
    }),

    db.task.findMany({
      where: {
        ...base,
        status: "COMPLETED",
        completedAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { completedAt: "desc" },
      include: SUBTASK_COUNT_SELECT,
    }),

    db.task.findMany({
      where: {
        ...base,
        status: ACTIVE_STATUS,
        OR: [
          { isAllDay: false, dueAt: { lt: now } },
          { isAllDay: true, dueAt: { lt: dayStart } },
        ],
      },
      orderBy: { dueAt: "asc" },
      include: SUBTASK_COUNT_SELECT,
    }),

    db.task.findMany({
      where: {
        ...base,
        status: ACTIVE_STATUS,
        dueAt: { gte: dayEnd, lt: horizon },
      },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      include: SUBTASK_COUNT_SELECT,
      take: UPCOMING_LIMIT,
    }),

    getTaskStatistics(profile, now),
  ]);

  const toDto = (task: TaskWithCounts) =>
    toTaskDto(task, now, timeZone, profile.locale);

  // The recommendation considers everything actionable — not just today's —
  // because a high-priority item due tomorrow can legitimately outrank a
  // trivial one due today.
  const candidates = await db.task.findMany({
    where: { ...base, status: ACTIVE_STATUS },
    take: 200,
  });

  const best = selectNextBestAction(candidates, now, timeZone, TIME_HELPERS);

  const nextBestAction: NextBestActionDto | null = best
    ? {
        task: toDto(
          (await db.task.findFirst({
            where: { id: best.task.id, profileId: profile.id },
            include: SUBTASK_COUNT_SELECT,
          })) ?? best.task,
        ),
        reasons: best.reasons,
      }
    : null;

  return {
    greeting: greetingFor(now, timeZone),
    dateLabel: formatInTimeZone(
      now,
      timeZone,
      { weekday: "long", day: "numeric", month: "long" },
      profile.locale,
    ),
    timeZone,
    nextBestAction,
    dueToday: dueTodayRows.map(toDto),
    completedToday: completedTodayRows.map(toDto),
    overdue: overdueRows.map(toDto),
    upcoming: upcomingRows.map(toDto),
    statistics,
  };
}
