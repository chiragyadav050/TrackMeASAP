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
  createWorkspaceAction,
  updateWorkspaceAction,
} from "@/features/work/actions";
import { WORKSPACE_TYPE_LABELS } from "@/features/work/components/work-badges";
import { WORKSPACE_TYPES } from "@/services/work/work.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { WorkspaceDto } from "@/types/work";

/**
 * Create and edit a workspace.
 *
 * The type is not decoration — Phase 10's workload analysis reads it to tell
 * paid work apart from personal projects, so the copy explains the choice
 * rather than presenting it as a label.
 */
export function WorkspaceDialog({
  isOpen,
  onOpenChange,
  workspace,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  workspace?: WorkspaceDto;
}) {
  const router = useRouter();
  const isEditing = workspace !== undefined;

  type WorkspaceActionState = ActionState<{ workspaceId: string }>;

  const [state, formAction, isPending] = useActionState<
    WorkspaceActionState,
    FormData
  >(
    isEditing ? updateWorkspaceAction : createWorkspaceAction,
    IDLE_ACTION_STATE,
  );

  const lastHandled = useRef<WorkspaceActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success(isEditing ? "Workspace updated." : "Workspace created.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't save the workspace.");
    }
  }, [state, onOpenChange, isEditing, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit workspace" : "New workspace"}
          </DialogTitle>
          <DialogDescription>
            One context you keep separate in your head — freelance work, a
            business, personal side projects.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {isEditing ? (
            <input type="hidden" name="workspaceId" value={workspace.id} />
          ) : null}

          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="name" label="Name" errors={fieldErrors?.name}>
            <Input
              {...fieldAria("name", { hasError: Boolean(fieldErrors?.name) })}
              name="name"
              defaultValue={workspace?.name}
              placeholder="Freelance"
              autoFocus
              required
            />
          </Field>

          <Field id="type" label="Type" errors={fieldErrors?.type}>
            <NativeSelect
              {...fieldAria("type", { hasError: Boolean(fieldErrors?.type) })}
              name="type"
              defaultValue={workspace?.type ?? "PERSONAL"}
            >
              {WORKSPACE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {WORKSPACE_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>

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
              defaultValue={workspace?.description ?? ""}
              rows={2}
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
              {isPending ? "Saving…" : isEditing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
