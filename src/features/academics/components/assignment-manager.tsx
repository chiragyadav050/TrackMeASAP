"use client";

import {
  ClipboardList,
  ExternalLink,
  ListPlus,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createAssignmentAction,
  createTaskFromAssignmentCommand,
  setAssignmentStatusCommand,
  setSubmissionCommand,
} from "@/features/academics/actions";
import {
  AssignmentStatusBadge,
  SubmissionBadge,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_VIEWS,
  SUBMISSION_STATUSES,
  type AssignmentFilters,
} from "@/services/academics/academic.schema";
import { TASK_PRIORITIES } from "@/services/task/task.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { AssignmentDto } from "@/types/academics";

const VIEW_LABELS: Record<(typeof ASSIGNMENT_VIEWS)[number], string> = {
  ALL: "All",
  OPEN: "Open",
  DUE_TODAY: "Due today",
  DUE_THIS_WEEK: "Due this week",
  UPCOMING: "Upcoming",
  OVERDUE: "Overdue",
  COMPLETED: "Completed",
  SUBMITTED: "Submitted",
  GRADED: "Graded",
  ARCHIVED: "Archived",
};

const STATUS_LABELS: Record<(typeof ASSIGNMENT_STATUSES)[number], string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const SUBMISSION_LABELS: Record<(typeof SUBMISSION_STATUSES)[number], string> =
  {
    NOT_SUBMITTED: "Not submitted",
    SUBMITTED: "Submitted",
    LATE: "Submitted late",
    ACCEPTED: "Accepted",
  };

type AssignmentManagerProps = {
  readonly assignments: readonly AssignmentDto[];
  readonly filters: AssignmentFilters;
  readonly subjects: readonly {
    id: string;
    name: string;
    code: string | null;
  }[];
};

export function AssignmentManager({
  assignments,
  filters,
  subjects,
}: AssignmentManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * `typedRoutes` cannot verify a query string assembled at runtime, so the
   * assertion is confined to this one helper — the same pattern as the task
   * filter bar.
   */
  const toHref = useCallback(
    (params: URLSearchParams): Route => {
      const query = params.toString();
      return (query === "" ? pathname : `${pathname}?${query}`) as Route;
    },
    [pathname],
  );

  const applyParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    startTransition(() => {
      router.replace(toHref(params), { scroll: false });
    });
  };

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    successMessage: string,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't save your changes.");
        return;
      }

      toast.success(successMessage);
    });
  };

  if (subjects.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={ClipboardList}
          title="Add a subject first"
          description="Assignments belong to a subject."
          action={
            <Button
              size="sm"
              render={<Link href="/academics/subjects">Go to subjects</Link>}
            />
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={filters.view}
          onChange={(event) => applyParam("view", event.target.value)}
          aria-label="Filter assignments"
          className="h-8 w-auto min-w-32 text-meta"
        >
          {ASSIGNMENT_VIEWS.map((view) => (
            <option key={view} value={view}>
              {VIEW_LABELS[view]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          value={filters.subjectId ?? ""}
          onChange={(event) =>
            applyParam("subjectId", event.target.value || null)
          }
          aria-label="Filter by subject"
          className="h-8 w-auto min-w-32 text-meta"
        >
          <option value="">All subjects</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.code ?? subject.name}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          value={filters.sort}
          onChange={(event) => applyParam("sort", event.target.value)}
          aria-label="Sort assignments"
          className="h-8 w-auto min-w-32 text-meta"
        >
          <option value="DUE_DATE">Due date</option>
          <option value="PRIORITY">Priority</option>
          <option value="SUBJECT">Subject</option>
          <option value="RECENTLY_CREATED">Recently created</option>
        </NativeSelect>

        <span
          className="ml-auto text-label text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {isPending ? "Filtering…" : `${assignments.length}`}
        </span>

        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="size-3.5" />
          New assignment
        </Button>
      </div>

      {assignments.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={ClipboardList}
            title="Nothing here"
            description="No assignments match this view."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                New assignment
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-surface">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="group flex items-start gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-meta font-medium">
                  {assignment.title}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-label text-muted-foreground">
                    {assignment.subjectCode ?? assignment.subjectName}
                  </span>

                  {/* Work status and submission are shown SIDE BY SIDE — they
                      are independent facts and collapsing them in the UI
                      would undo the point of separating them. */}
                  <AssignmentStatusBadge status={assignment.status} />
                  <SubmissionBadge status={assignment.submissionStatus} />

                  {assignment.marksPercent !== null ? (
                    <span className="text-label text-muted-foreground tabular-nums">
                      {assignment.marksObtained}/{assignment.maxMarks}
                    </span>
                  ) : null}

                  {assignment.taskId ? (
                    <span className="inline-flex items-center gap-1 text-label text-brand-text">
                      <ListPlus className="size-3" aria-hidden />
                      Task linked
                    </span>
                  ) : null}
                </div>
              </div>

              {assignment.dueLabel ? (
                <span
                  className={cn(
                    "shrink-0 text-label tabular-nums",
                    assignment.isOverdue
                      ? "font-medium text-danger"
                      : "text-muted-foreground",
                  )}
                >
                  {assignment.isOverdue ? "Overdue · " : ""}
                  {assignment.dueLabel}
                </span>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
                      aria-label={`Actions for ${assignment.title}`}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  }
                />

                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Work status</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {ASSIGNMENT_STATUSES.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          onClick={() =>
                            run(
                              () =>
                                setAssignmentStatusCommand({
                                  assignmentId: assignment.id,
                                  status,
                                }),
                              `Marked ${STATUS_LABELS[status].toLowerCase()}.`,
                            )
                          }
                        >
                          {STATUS_LABELS[status]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Submission</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {SUBMISSION_STATUSES.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          onClick={() =>
                            run(
                              () =>
                                setSubmissionCommand({
                                  assignmentId: assignment.id,
                                  submissionStatus: status,
                                }),
                              `Submission: ${SUBMISSION_LABELS[status].toLowerCase()}.`,
                            )
                          }
                        >
                          {SUBMISSION_LABELS[status]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    disabled={assignment.taskId !== null}
                    onClick={() =>
                      run(
                        () =>
                          createTaskFromAssignmentCommand({
                            assignmentId: assignment.id,
                          }),
                        "Task created — it will appear on Today.",
                      )
                    }
                  >
                    <ListPlus className="size-4 text-muted-foreground" />
                    {assignment.taskId ? "Task already linked" : "Create task"}
                  </DropdownMenuItem>

                  {assignment.submissionUrl ? (
                    <DropdownMenuItem
                      render={
                        <a
                          href={assignment.submissionUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <ExternalLink className="size-4 text-muted-foreground" />
                          Open submission
                        </a>
                      }
                    />
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <AssignmentDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        subjects={subjects}
      />
    </div>
  );
}

function AssignmentDialog({
  isOpen,
  onOpenChange,
  subjects,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: readonly { id: string; name: string; code: string | null }[];
}) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ assignmentId: string }>,
    FormData
  >(createAssignmentAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ActionState<{ assignmentId: string }> | null>(
    null,
  );

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Assignment created.");
      onOpenChange(false);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't create the assignment.");
    }
  }, [state, onOpenChange]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New assignment</DialogTitle>
          <DialogDescription>
            Optionally create a linked task so it shows up on Today alongside
            everything else.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="title" label="Title" errors={fieldErrors?.title}>
            <Input
              {...fieldAria("title", { hasError: Boolean(fieldErrors?.title) })}
              name="title"
              autoFocus
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="subjectId"
              label="Subject"
              errors={fieldErrors?.subjectId}
            >
              <NativeSelect
                {...fieldAria("subjectId", {
                  hasError: Boolean(fieldErrors?.subjectId),
                })}
                name="subjectId"
              >
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code ? `${subject.code} — ` : ""}
                    {subject.name}
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
                defaultValue="MEDIUM"
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority.charAt(0) + priority.slice(1).toLowerCase()}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="dueDate"
              label="Due date"
              hint="Leave the time blank for an all-day deadline."
              errors={fieldErrors?.dueDate}
            >
              <Input
                {...fieldAria("dueDate", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.dueDate),
                })}
                type="date"
                name="dueDate"
                className="h-9"
              />
            </Field>

            <Field id="dueTime" label="Time" errors={fieldErrors?.dueTime}>
              <Input
                {...fieldAria("dueTime", {
                  hasError: Boolean(fieldErrors?.dueTime),
                })}
                type="time"
                name="dueTime"
                className="h-9"
              />
            </Field>

            <Field
              id="estimatedMinutes"
              label="Estimate"
              hint="Minutes."
              errors={fieldErrors?.estimatedMinutes}
            >
              <Input
                {...fieldAria("estimatedMinutes", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.estimatedMinutes),
                })}
                type="number"
                name="estimatedMinutes"
                min={1}
                max={1440}
                step={15}
                className="h-9"
              />
            </Field>

            <Field id="maxMarks" label="Out of" errors={fieldErrors?.maxMarks}>
              <Input
                {...fieldAria("maxMarks", {
                  hasError: Boolean(fieldErrors?.maxMarks),
                })}
                type="number"
                name="maxMarks"
                min={1}
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
              rows={2}
            />
          </Field>

          <label className="flex items-center gap-2 text-meta">
            <input
              type="checkbox"
              name="createTask"
              value="true"
              defaultChecked
              className="size-4 accent-primary"
            />
            Also create a task, so it appears on Today
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create assignment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
