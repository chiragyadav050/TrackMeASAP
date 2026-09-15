"use client";

import { Library, Plus } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSubjectAction } from "@/features/academics/actions";
import {
  AttendanceFigure,
  AttendanceRiskBadge,
} from "@/features/academics/components/academic-badges";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { SubjectAttendanceDto } from "@/types/academics";

export type SubjectListEntry = {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly facultyName: string | null;
  readonly credits: number | null;
  readonly attendance: SubjectAttendanceDto | null;
  readonly openAssignments: number;
};

type SubjectManagerProps = {
  readonly subjects: readonly SubjectListEntry[];
  readonly semesters: readonly { id: string; name: string }[];
  readonly currentSemesterId: string | null;
};

/**
 * The subject list.
 *
 * Each row leads with the name and code — colour is a secondary cue only, so
 * a subject is always identifiable without it.
 */
export function SubjectManager({
  subjects,
  semesters,
  currentSemesterId,
}: SubjectManagerProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (semesters.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={Library}
          title="Create a semester first"
          description="Subjects belong to a semester, so there needs to be one to add them to."
          action={
            <Button
              size="sm"
              render={<Link href="/academics/semesters">Go to semesters</Link>}
            />
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-meta text-muted-foreground">
          {subjects.length} {subjects.length === 1 ? "subject" : "subjects"} in
          this semester.
        </p>

        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="size-3.5" />
          Add subject
        </Button>
      </div>

      {subjects.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={Library}
            title="Add your subjects to begin tracking academics."
            description="Attendance, assignments and exams all hang off a subject."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                Add subject
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <Link
                href={`/academics/subjects/${subject.id}` as never}
                className="block h-full rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-meta font-medium">
                      {subject.name}
                    </p>
                    <p className="text-label text-muted-foreground">
                      {[
                        subject.code,
                        subject.credits ? `${subject.credits} credits` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No code"}
                    </p>
                  </div>

                  {subject.attendance ? (
                    <AttendanceRiskBadge
                      risk={subject.attendance.risk}
                      showLabel={false}
                    />
                  ) : null}
                </div>

                {subject.facultyName ? (
                  <p className="mt-2 truncate text-label text-muted-foreground">
                    {subject.facultyName}
                  </p>
                ) : null}

                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-2.5">
                  {subject.attendance ? (
                    <AttendanceFigure
                      percentage={subject.attendance.percentage}
                      thresholdPercent={subject.attendance.thresholdPercent}
                      className="text-label"
                    />
                  ) : (
                    <span className="text-label text-muted-foreground">
                      No attendance data
                    </span>
                  )}

                  <span className="text-label text-muted-foreground tabular-nums">
                    {subject.openAssignments} open
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SubjectDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        semesters={semesters}
        currentSemesterId={currentSemesterId}
      />
    </div>
  );
}

function SubjectDialog({
  isOpen,
  onOpenChange,
  semesters,
  currentSemesterId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  semesters: readonly { id: string; name: string }[];
  currentSemesterId: string | null;
}) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ subjectId: string }>,
    FormData
  >(createSubjectAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ActionState<{ subjectId: string }> | null>(null);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Subject added.");
      onOpenChange(false);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't add the subject.");
    }
  }, [state, onOpenChange]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add subject</DialogTitle>
          <DialogDescription>
            The attendance threshold is per subject — labs and theory papers
            often differ.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="name"
              label="Subject name"
              errors={fieldErrors?.name}
              className="sm:col-span-2"
            >
              <Input
                {...fieldAria("name", { hasError: Boolean(fieldErrors?.name) })}
                name="name"
                placeholder="Cloud Computing"
                autoFocus
                required
              />
            </Field>

            <Field id="code" label="Code" errors={fieldErrors?.code}>
              <Input
                {...fieldAria("code", { hasError: Boolean(fieldErrors?.code) })}
                name="code"
                placeholder="CC-301"
              />
            </Field>

            <Field id="credits" label="Credits" errors={fieldErrors?.credits}>
              <Input
                {...fieldAria("credits", {
                  hasError: Boolean(fieldErrors?.credits),
                })}
                type="number"
                name="credits"
                min={0}
                max={50}
                className="h-9"
              />
            </Field>

            <Field
              id="facultyName"
              label="Faculty"
              errors={fieldErrors?.facultyName}
            >
              <Input
                {...fieldAria("facultyName", {
                  hasError: Boolean(fieldErrors?.facultyName),
                })}
                name="facultyName"
                placeholder="Prof. Rao"
              />
            </Field>

            <Field
              id="attendanceThreshold"
              label="Attendance required"
              hint="Percent."
              errors={fieldErrors?.attendanceThreshold}
            >
              <Input
                {...fieldAria("attendanceThreshold", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.attendanceThreshold),
                })}
                type="number"
                name="attendanceThreshold"
                min={0}
                max={100}
                defaultValue={75}
                className="h-9"
              />
            </Field>

            <Field
              id="semesterId"
              label="Semester"
              errors={fieldErrors?.semesterId}
              className="sm:col-span-2"
            >
              <NativeSelect
                {...fieldAria("semesterId", {
                  hasError: Boolean(fieldErrors?.semesterId),
                })}
                name="semesterId"
                defaultValue={currentSemesterId ?? semesters[0]?.id}
              >
                {semesters.map((semester) => (
                  <option key={semester.id} value={semester.id}>
                    {semester.name}
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
              {isPending ? "Adding…" : "Add subject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
