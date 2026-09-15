import { z } from "zod";

import { localDateSchema, localTimeSchema } from "@/services/task/task.schema";

/**
 * Work and project input schemas.
 *
 * Reuses `localDateSchema` / `localTimeSchema` from the task module so the
 * client never sends an absolute instant for a user-chosen date — the server
 * converts using the PROFILE's zone, as everywhere else in Life OS.
 */

export const WORKSPACE_TYPES = [
  "PERSONAL",
  "FREELANCE",
  "BUSINESS",
  "SAAS",
  "CONTENT",
  "RESEARCH",
  "OTHER",
] as const;

export const PROJECT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export const MILESTONE_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
] as const;

const idSchema = z.string().min(1, "Missing reference.");

const shortText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `Keep ${label.toLowerCase()} under ${max} characters.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const workspaceFields = z.object({
  name: shortText(80, "Workspace name"),
  description: optionalText(2000),
  type: z.enum(WORKSPACE_TYPES).default("PERSONAL"),
  icon: optionalText(40),
});

export const createWorkspaceSchema = workspaceFields;

export const updateWorkspaceSchema = workspaceFields
  .partial()
  .extend({ workspaceId: idSchema });

export const workspaceIdSchema = z.object({ workspaceId: idSchema });

export const archiveWorkspaceSchema = z.object({
  workspaceId: idSchema,
  isArchived: z.boolean(),
});

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

const projectFields = z.object({
  workspaceId: idSchema,
  name: shortText(120, "Project name"),
  description: optionalText(4000),
  status: z.enum(PROJECT_STATUSES).default("PLANNED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  startDate: localDateSchema.optional(),
  targetEndDate: localDateSchema.optional(),
  targetEndTime: localTimeSchema.optional(),
});

/** A project that ends before it starts is not a typo worth accepting. */
const orderedProjectDates = (
  value: { startDate?: string; targetEndDate?: string },
  ctx: z.RefinementCtx,
): void => {
  if (
    value.startDate &&
    value.targetEndDate &&
    value.targetEndDate < value.startDate
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["targetEndDate"],
      message: "The project must end after it starts.",
    });
  }
};

export const createProjectSchema =
  projectFields.superRefine(orderedProjectDates);

export const updateProjectSchema = projectFields
  .partial()
  .extend({ projectId: idSchema, clearTargetEnd: z.boolean().optional() })
  .superRefine(orderedProjectDates);

export const projectIdSchema = z.object({ projectId: idSchema });

export const setProjectStatusSchema = z.object({
  projectId: idSchema,
  status: z.enum(PROJECT_STATUSES),
});

export const archiveProjectSchema = z.object({
  projectId: idSchema,
  isArchived: z.boolean(),
});

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

export const createMilestoneSchema = z.object({
  projectId: idSchema,
  title: shortText(200, "Milestone title"),
  description: optionalText(2000),
  dueDate: localDateSchema.optional(),
});

export const updateMilestoneSchema = z.object({
  milestoneId: idSchema,
  title: shortText(200, "Milestone title").optional(),
  description: optionalText(2000),
  dueDate: localDateSchema.optional(),
  clearDue: z.boolean().optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
});

export const milestoneIdSchema = z.object({ milestoneId: idSchema });

export const setMilestoneStatusSchema = z.object({
  milestoneId: idSchema,
  status: z.enum(MILESTONE_STATUSES),
});

export const reorderMilestonesSchema = z.object({
  projectId: idSchema,
  orderedIds: z.array(idSchema).min(1, "Nothing to reorder."),
});

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

export const createBlockerSchema = z.object({
  projectId: idSchema,
  reason: shortText(500, "Blocker reason"),
});

export const resolveBlockerSchema = z.object({
  blockerId: idSchema,
  resolutionNote: optionalText(500),
});

export const blockerIdSchema = z.object({ blockerId: idSchema });

// ---------------------------------------------------------------------------
// Task ↔ project
// ---------------------------------------------------------------------------

export const linkTaskToProjectSchema = z.object({
  taskId: idSchema,
  /** `null` unlinks without deleting either record. */
  projectId: z.string().nullable(),
});

export const createProjectTaskSchema = z.object({
  projectId: idSchema,
  title: shortText(200, "Title"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: localDateSchema.optional(),
  dueTime: localTimeSchema.optional(),
  estimatedMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

export const PROJECT_VIEWS = [
  "ACTIVE",
  "ALL",
  "PLANNED",
  "BLOCKED",
  "COMPLETED",
  "ARCHIVED",
] as const;

export const projectFiltersSchema = z.object({
  view: z.enum(PROJECT_VIEWS).default("ACTIVE"),
  workspaceId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  sort: z
    .enum(["TARGET_DATE", "PRIORITY", "RECENTLY_UPDATED", "NAME"])
    .default("TARGET_DATE"),
  search: z.string().trim().max(200).optional(),
});

export const searchWorkSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(20).default(6),
});

export type ProjectFilters = z.infer<typeof projectFiltersSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
