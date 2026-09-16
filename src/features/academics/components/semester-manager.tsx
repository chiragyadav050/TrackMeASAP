"use client";

import { Archive, CheckCircle2, Plus, Trash2 } from "lucide-react";
import {
  useActionState,
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
import { Badge } from "@/components/ui/badge";
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
  archiveSemesterCommand,
  createSemesterAction,
  deleteSemesterCommand,
  setCurrentSemesterCommand,
} from "@/features/academics/actions";
import { SEMESTER_STATUSES } from "@/services/academics/academic.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { SemesterDto } from "@/types/academics";

const STATUS_LABELS: Record<(typeof SEMESTER_STATUSES)[number], string> = {
  UPCOMING: "Upcoming",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

type SemesterManagerProps = {
  readonly semesters: readonly SemesterDto[];
};

/**
 * Semester list and creation.
 *
 * "Set current" is the only action with a product rule behind it: exactly one
 * semester may be current, and the server enforces that in a transaction with
 * a database constraint behind it. The UI simply asks.
 */
export function SemesterManager({ semesters }: SemesterManagerProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-meta text-muted-foreground">
          One semester is current at a time. Everything academic hangs off it.
        </p>

        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="size-3.5" />
          New semester
        </Button>
      </div>

      {semesters.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={CheckCircle2}
            title="Start by creating your current semester."
            description="Give it a name, an academic year and the dates it runs."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                Create semester
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-surface">
          {semesters.map((semester) => (
            <li
              key={semester.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-meta font-medium">{semester.name}</span>
                  {semester.isCurrent ? (
                    <Badge variant="secondary">Current</Badge>
                  ) : null}
                  <Badge variant="outline">
                    {STATUS_LABELS[semester.status]}
                  </Badge>
                </div>
                <p className="text-label text-muted-foreground">
                  {semester.academicYear} · {formatDateOnly(semester.startDate)}{" "}
                  – {formatDateOnly(semester.endDate)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {!semester.isCurrent ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    // Named after its semester, like Archive below. The visible
                    // text is identical on every row, so without this a screen
                    // reader announces "Set current" N times with nothing to
                    // tell the rows apart.
                    aria-label={`Set ${semester.name} as current`}
                    onClick={() =>
                      run(
                        () =>
                          setCurrentSemesterCommand({
                            semesterId: semester.id,
                          }),
                        `${semester.name} is now current.`,
                      )
                    }
                  >
                    Set current
                  </Button>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Archive ${semester.name}`}
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () => archiveSemesterCommand({ semesterId: semester.id }),
                      `${semester.name} archived.`,
                    )
                  }
                >
                  <Archive className="size-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${semester.name}`}
                  className="text-danger"
                  disabled={isPending}
                  onClick={() => {
                    // Irreversible, and takes every subject with it.
                    const confirmed = window.confirm(
                      `Delete "${semester.name}" permanently? Its subjects, attendance, assignments and exams go too.`,
                    );

                    if (confirmed) {
                      run(
                        () =>
                          deleteSemesterCommand({ semesterId: semester.id }),
                        "Semester deleted.",
                      );
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <SemesterDialog isOpen={isDialogOpen} onOpenChange={setIsDialogOpen} />
    </div>
  );
}

function SemesterDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ semesterId: string }>,
    FormData
  >(createSemesterAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ActionState<{ semesterId: string }> | null>(null);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Semester created.");
      onOpenChange(false);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't create the semester.");
    }
  }, [state, onOpenChange]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const formError =
    state.status === "error" ? (fieldErrors?._form?.join(" ") ?? null) : null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New semester</DialogTitle>
          <DialogDescription>
            Name it however your institution does — &ldquo;Semester 6&rdquo;,
            &ldquo;Odd 2025&rdquo;, anything.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" errors={fieldErrors?.name}>
              <Input
                {...fieldAria("name", {
                  hasError: Boolean(fieldErrors?.name),
                })}
                name="name"
                placeholder="Semester 6"
                autoFocus
                required
              />
            </Field>

            <Field
              id="academicYear"
              label="Academic year"
              hint="Free text — spans two calendar years."
              errors={fieldErrors?.academicYear}
            >
              <Input
                {...fieldAria("academicYear", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.academicYear),
                })}
                name="academicYear"
                placeholder="2025-26"
                required
              />
            </Field>

            <Field
              id="startDate"
              label="Starts"
              errors={fieldErrors?.startDate}
            >
              <Input
                {...fieldAria("startDate", {
                  hasError: Boolean(fieldErrors?.startDate),
                })}
                type="date"
                name="startDate"
                className="h-9"
                required
              />
            </Field>

            <Field id="endDate" label="Ends" errors={fieldErrors?.endDate}>
              <Input
                {...fieldAria("endDate", {
                  hasError: Boolean(fieldErrors?.endDate),
                })}
                type="date"
                name="endDate"
                className="h-9"
                required
              />
            </Field>

            <Field
              id="status"
              label="Status"
              errors={fieldErrors?.status}
              className="sm:col-span-2"
            >
              <NativeSelect
                {...fieldAria("status", {
                  hasError: Boolean(fieldErrors?.status),
                })}
                name="status"
                defaultValue="ACTIVE"
              >
                {SEMESTER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <Field
            id="notes"
            label="Notes"
            hint="Optional."
            errors={fieldErrors?.notes}
          >
            <Textarea
              {...fieldAria("notes", {
                hasHint: true,
                hasError: Boolean(fieldErrors?.notes),
              })}
              name="notes"
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
              {isPending ? "Creating…" : "Create semester"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** DATE-ONLY values are read in UTC — see the note in academic-overview.tsx. */
function formatDateOnly(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}
