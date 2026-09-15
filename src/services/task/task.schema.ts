import { z } from "zod";

import { MINUTES_PER_DAY } from "@/lib/time";

/**
 * Task input schemas.
 *
 * Isomorphic: the same schema validates the form in the browser for fast
 * feedback, and again on the server, which is the check that counts.
 */

export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const TASK_CATEGORIES = [
  "PERSONAL",
  "COLLEGE",
  "WORK",
  "PROJECT",
  "OTHER",
] as const;

export const ENERGY_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

export const taskStatusSchema = z.enum(TASK_STATUSES);
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const energyLevelSchema = z.enum(ENERGY_LEVELS);

/** A day's work is a generous ceiling for a single task estimate. */
const MAX_ESTIMATE_MINUTES = MINUTES_PER_DAY;

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const NOTES_MAX = 5000;

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the task a title.")
  .max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`);

/**
 * Optional free text.
 *
 * Empty strings are normalised to `undefined` so a cleared textarea stores
 * NULL rather than `""` — otherwise "has a description" becomes true for a
 * field the user just emptied.
 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const estimatedMinutesSchema = z.coerce
  .number()
  .int("Use whole minutes.")
  .min(1, "An estimate must be at least a minute.")
  .max(MAX_ESTIMATE_MINUTES, "Estimates cap at 24 hours.")
  .optional();

/**
 * A calendar day in the user's own zone, as `YYYY-MM-DD`.
 *
 * The client never sends an absolute instant for a due date. It sends the day
 * (and optionally the clock time) the user actually picked, and the server
 * converts to UTC using the profile's zone. Sending an instant would bake the
 * *browser's* zone into the value, which is wrong the moment the user travels
 * or sets a different zone in Settings.
 */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, "That date does not exist.");

/** `HH:mm` on a 24-hour clock, in the user's zone. */
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time.");

/**
 * Due date as the user expressed it.
 *
 * `dueTime` absent means an all-day task — due *that day*, not at 00:00. The
 * distinction matters: without it, a task due "Friday" is reported overdue
 * from one minute past midnight on Friday.
 */
const dueSchema = z
  .object({
    dueDate: localDateSchema.optional(),
    dueTime: localTimeSchema.optional(),
  })
  .refine((value) => !(value.dueTime && !value.dueDate), {
    message: "Pick a date to go with the time.",
    path: ["dueDate"],
  });

export const createTaskSchema = z
  .object({
    title: titleSchema,
    description: optionalText(DESCRIPTION_MAX, "description"),
    notes: optionalText(NOTES_MAX, "notes"),
    priority: taskPrioritySchema.default("MEDIUM"),
    category: taskCategorySchema.default("PERSONAL"),
    energy: energyLevelSchema.default("MEDIUM"),
    estimatedMinutes: estimatedMinutesSchema,
  })
  .and(dueSchema);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Quick capture: a title and nothing else. */
export const quickCreateTaskSchema = z.object({
  title: titleSchema,
});

export type QuickCreateTaskInput = z.infer<typeof quickCreateTaskSchema>;

export const updateTaskSchema = z
  .object({
    taskId: z.string().min(1),
    title: titleSchema.optional(),
    description: optionalText(DESCRIPTION_MAX, "description"),
    notes: optionalText(NOTES_MAX, "notes"),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    category: taskCategorySchema.optional(),
    energy: energyLevelSchema.optional(),
    estimatedMinutes: estimatedMinutesSchema,
    actualMinutes: estimatedMinutesSchema,
    /** `true` clears the due date entirely. */
    clearDue: z.boolean().optional(),
  })
  .and(dueSchema);

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskIdSchema = z.object({
  taskId: z.string().min(1, "Missing task."),
});

export const setTaskCompletionSchema = z.object({
  taskId: z.string().min(1),
  isCompleted: z.boolean(),
});

/** Named shortcuts offered by the reschedule menu. */
export const RESCHEDULE_PRESETS = [
  "TODAY",
  "TOMORROW",
  "THIS_WEEKEND",
  "NEXT_WEEK",
  "CLEAR",
] as const;

export const reschedulePresetSchema = z.enum(RESCHEDULE_PRESETS);

export const rescheduleTaskSchema = z
  .object({
    taskId: z.string().min(1),
    preset: reschedulePresetSchema.optional(),
    dueDate: localDateSchema.optional(),
    dueTime: localTimeSchema.optional(),
  })
  .refine((value) => Boolean(value.preset) !== Boolean(value.dueDate), {
    message: "Choose either a preset or a specific date.",
    path: ["preset"],
  });

export type RescheduleTaskInput = z.infer<typeof rescheduleTaskSchema>;

// --- Subtasks --------------------------------------------------------------

export const createSubtaskSchema = z.object({
  taskId: z.string().min(1),
  title: titleSchema,
});

export const subtaskIdSchema = z.object({
  subtaskId: z.string().min(1),
});

export const setSubtaskCompletionSchema = z.object({
  subtaskId: z.string().min(1),
  isCompleted: z.boolean(),
});

export const updateSubtaskSchema = z.object({
  subtaskId: z.string().min(1),
  title: titleSchema,
});

export const reorderSubtasksSchema = z.object({
  taskId: z.string().min(1),
  /** Subtask ids in their new order. Must be the complete set for the task. */
  orderedIds: z.array(z.string().min(1)).min(1, "Nothing to reorder."),
});

// --- Bulk ------------------------------------------------------------------

/** Bounded so one request cannot be turned into an unbounded write. */
export const MAX_BULK_TASKS = 100;

const bulkIdsSchema = z
  .array(z.string().min(1))
  .min(1, "Select at least one task.")
  .max(MAX_BULK_TASKS, `Select at most ${MAX_BULK_TASKS} tasks.`);

export const bulkTaskActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("COMPLETE"), taskIds: bulkIdsSchema }),
  z.object({ action: z.literal("REOPEN"), taskIds: bulkIdsSchema }),
  z.object({ action: z.literal("ARCHIVE"), taskIds: bulkIdsSchema }),
  z.object({
    action: z.literal("SET_PRIORITY"),
    taskIds: bulkIdsSchema,
    priority: taskPrioritySchema,
  }),
  z.object({
    action: z.literal("RESCHEDULE"),
    taskIds: bulkIdsSchema,
    preset: reschedulePresetSchema,
  }),
]);

export type BulkTaskActionInput = z.infer<typeof bulkTaskActionSchema>;

// --- Querying --------------------------------------------------------------

export const TASK_STATUS_FILTERS = [
  "ALL",
  "ACTIVE",
  "COMPLETED",
  "OVERDUE",
  "ARCHIVED",
] as const;

export const TASK_DATE_FILTERS = [
  "ANY",
  "TODAY",
  "TOMORROW",
  "THIS_WEEK",
  "OVERDUE",
  "NO_DEADLINE",
] as const;

export const TASK_SORTS = [
  "SMART",
  "DUE_DATE",
  "PRIORITY",
  "ESTIMATE",
  "RECENTLY_CREATED",
  "RECENTLY_UPDATED",
  "MANUAL",
] as const;

export const taskFiltersSchema = z.object({
  status: z.enum(TASK_STATUS_FILTERS).default("ACTIVE"),
  priority: taskPrioritySchema.optional(),
  category: taskCategorySchema.optional(),
  date: z.enum(TASK_DATE_FILTERS).default("ANY"),
  sort: z.enum(TASK_SORTS).default("SMART"),
  search: z.string().trim().max(200).optional(),
});

export type TaskFilters = z.infer<typeof taskFiltersSchema>;

export const searchTasksSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
