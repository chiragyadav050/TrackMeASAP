"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createProjectAction,
  updateProjectAction,
} from "@/features/work/actions";
import { PROJECT_STATUS_LABELS } from "@/features/work/components/work-badges";
import { PRIORITY_META } from "@/features/tasks/components/task-badges";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { ProjectDto, WorkspaceDto } from "@/types/work";

/** Statuses a user picks directly. ARCHIVED is reached by archiving. */
const SELECTABLE_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;

type ProjectDialogProps = {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workspaces: readonly WorkspaceDto[];
  readonly defaultWorkspaceId?: string;
  /** Present when editing; absent when creating. */
  readonly project?: ProjectDto;
};

/**
 * Create and edit a project.
 *
 * Dates are posted as plain `YYYY-MM-DD` strings and converted on the server
 * using the PROFILE's zone. The browser's own zone is never consulted — a
 * student travelling home for the holidays must not see their deadlines move.
 */
export function ProjectDialog({
  isOpen,
  onOpenChange,
  workspaces,
  defaultWorkspaceId,
  project,
}: ProjectDialogProps) {
  const router = useRouter();
  const isEditing = project !== undefined;

  // Both actions resolve to the same shape, so one hook serves create and
  // edit rather than two code paths that could drift.
  type ProjectActionState = ActionState<{ projectId: string }>;

  const [state, formAction, isPending] = useActionState<
    ProjectActionState,
    FormData
  >(isEditing ? updateProjectAction : createProjectAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ProjectActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success(isEditing ? "Project updated." : "Project created.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(
        state.message ??
          (isEditing
            ? "Couldn't update the project."
            : "Couldn't create the project."),
      );
    }
  }, [state, onOpenChange, isEditing, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit project" : "New project"}
          </DialogTitle>
          <DialogDescription>
            A project is an effort with more than one step and an end in sight.
            Everything else belongs in Tasks.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {isEditing ? (
            <input type="hidden" name="projectId" value={project.id} />
          ) : null}

          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="name" label="Project name" errors={fieldErrors?.name}>
            <Input
              {...fieldAria("name", { hasError: Boolean(fieldErrors?.name) })}
              name="name"
              defaultValue={project?.name}
              placeholder="Client portfolio site"
              autoFocus
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="workspaceId"
              label="Workspace"
              errors={fieldErrors?.workspaceId}
            >
              <NativeSelect
                {...fieldAria("workspaceId", {
                  hasError: Boolean(fieldErrors?.workspaceId),
                })}
                name="workspaceId"
                defaultValue={
                  project?.workspaceId ??
                  defaultWorkspaceId ??
                  workspaces[0]?.id
                }
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="priority"
              label="Priority"
              errors={fieldErrors?.priority}
            >
              <NativeSelect
                {...fieldAria("priority", {
                  hasError: Boolean(fieldErrors?.priority),
                })}
                name="priority"
                defaultValue={project?.priority ?? "MEDIUM"}
              >
                {Object.entries(PRIORITY_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field id="status" label="Status" errors={fieldErrors?.status}>
              <NativeSelect
                {...fieldAria("status", {
                  hasError: Boolean(fieldErrors?.status),
                })}
                name="status"
                defaultValue={project?.status ?? "PLANNED"}
              >
                {SELECTABLE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_STATUS_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="startDate"
              label="Start date"
              hint="Optional."
              errors={fieldErrors?.startDate}
            >
              <Input
                {...fieldAria("startDate", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.startDate),
                })}
                type="date"
                name="startDate"
                defaultValue={project?.startDateInput ?? undefined}
                className="h-9"
              />
            </Field>

            <Field
              id="targetEndDate"
              label="Target end date"
              hint="Optional."
              errors={fieldErrors?.targetEndDate}
              className="sm:col-span-2"
            >
              <Input
                {...fieldAria("targetEndDate", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.targetEndDate),
                })}
                type="date"
                name="targetEndDate"
                defaultValue={project?.targetEndDateInput ?? undefined}
                className="h-9"
              />
            </Field>
          </div>

          <Field
            id="description"
            label="Description"
            hint="Optional."
            errors={fieldErrors?.description}
          >
            <Textarea
              {...fieldAria("description", {
                hasHint: true,
                hasError: Boolean(fieldErrors?.description),
              })}
              name="description"
              defaultValue={project?.description ?? ""}
              rows={3}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? isEditing
                  ? "Saving…"
                  : "Creating…"
                : isEditing
                  ? "Save changes"
                  : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
