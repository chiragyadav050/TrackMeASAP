"use client";

import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
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
import { createExamAction } from "@/features/academics/actions";
import {
  EXAM_TYPE_LABELS,
  PreparationFigure,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import {
  EXAM_TYPES,
  EXAM_VIEWS,
  type ExamFilters,
} from "@/services/academics/academic.schema";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { ExamDto } from "@/types/academics";

const VIEW_LABELS: Record<(typeof EXAM_VIEWS)[number], string> = {
  UPCOMING: "Upcoming",
  COMPLETED: "Completed",
  ALL: "All",
};

type ExamManagerProps = {
  readonly exams: readonly ExamDto[];
  readonly filters: ExamFilters;
  readonly subjects: readonly {
    id: string;
    name: string;
    code: string | null;
  }[];
  readonly semesterId: string | null;
};

export function ExamManager({
  exams,
  filters,
  subjects,
  semesterId,
}: ExamManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const applyParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value === null || value === "") {
      params.delete(key);
    } else {
      params.set(key, value);
    }

    const query = params.toString();

    startTransition(() => {
      router.replace(
        (query === "" ? pathname : `${pathname}?${query}`) as Route,
        { scroll: false },
      );
    });
  };

  if (!semesterId) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={FileText}
          title="Create a semester first"
          description="Exams belong to a semester."
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
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          value={filters.view}
          onChange={(event) => applyParam("view", event.target.value)}
          aria-label="Filter exams"
          className="h-8 w-auto min-w-28 text-meta"
        >
          {EXAM_VIEWS.map((view) => (
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
          value={filters.type ?? ""}
          onChange={(event) => applyParam("type", event.target.value || null)}
          aria-label="Filter by exam type"
          className="h-8 w-auto min-w-32 text-meta"
        >
          <option value="">All types</option>
          {EXAM_TYPES.map((type) => (
            <option key={type} value={type}>
              {EXAM_TYPE_LABELS[type]}
            </option>
          ))}
        </NativeSelect>

        <span
          className="ml-auto text-label text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {isPending ? "Filtering…" : `${exams.length}`}
        </span>

        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="size-3.5" />
          New exam
        </Button>
      </div>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={FileText}
            title="No upcoming exams."
            description="Add an exam and break its syllabus into topics to track preparation."
            action={
              <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                New exam
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {exams.map((exam) => (
            <li key={exam.id}>
              <Link
                href={`/academics/exams/${exam.id}` as never}
                className="block h-full rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-meta font-medium">
                      {exam.title}
                    </p>
                    <p className="text-label text-muted-foreground">
                      {EXAM_TYPE_LABELS[exam.type]}
                      {exam.subjectCode ? ` · ${exam.subjectCode}` : ""}
                    </p>
                  </div>

                  {exam.status !== "UPCOMING" ? (
                    <Badge variant="outline">{exam.status.toLowerCase()}</Badge>
                  ) : exam.daysRemaining !== null ? (
                    <Badge
                      variant={
                        exam.daysRemaining <= 7 ? "default" : "secondary"
                      }
                      className="tabular-nums"
                    >
                      {exam.daysRemaining === 0
                        ? "Today"
                        : exam.daysRemaining < 0
                          ? "Passed"
                          : `${exam.daysRemaining}d`}
                    </Badge>
                  ) : null}
                </div>

                <dl className="mt-3 space-y-1 text-label">
                  {exam.dateLabel ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">When</dt>
                      <dd className="tabular-nums">
                        {exam.dateLabel}
                        {exam.timeLabel ? `, ${exam.timeLabel}` : ""}
                      </dd>
                    </div>
                  ) : null}

                  {exam.location ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Where</dt>
                      <dd className="truncate">{exam.location}</dd>
                    </div>
                  ) : null}

                  {exam.marksPercent !== null ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Result</dt>
                      <dd className="tabular-nums">
                        {exam.marksObtained}/{exam.maxMarks}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <div
                  className={cn("mt-3 border-t border-border-subtle pt-2.5")}
                >
                  <PreparationFigure
                    percentage={exam.preparationPercent}
                    completedTopics={exam.completedTopics}
                    totalTopics={exam.totalTopics}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ExamDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        subjects={subjects}
        semesterId={semesterId}
      />
    </div>
  );
}

function ExamDialog({
  isOpen,
  onOpenChange,
  subjects,
  semesterId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: readonly { id: string; name: string; code: string | null }[];
  semesterId: string;
}) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ examId: string }>,
    FormData
  >(createExamAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<ActionState<{ examId: string }> | null>(null);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Exam created.");
      onOpenChange(false);
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't create the exam.");
    }
  }, [state, onOpenChange]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New exam</DialogTitle>
          <DialogDescription>
            Add topics afterwards to track preparation.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="semesterId" value={semesterId} />

          {fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field id="title" label="Title" errors={fieldErrors?.title}>
            <Input
              {...fieldAria("title", { hasError: Boolean(fieldErrors?.title) })}
              name="title"
              placeholder="DBMS Midterm"
              autoFocus
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="type" label="Type" errors={fieldErrors?.type}>
              <NativeSelect
                {...fieldAria("type", { hasError: Boolean(fieldErrors?.type) })}
                name="type"
                defaultValue="MIDTERM"
              >
                {EXAM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EXAM_TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="subjectId"
              label="Subject"
              hint="Optional — backlog papers may have none."
              errors={fieldErrors?.subjectId}
            >
              <NativeSelect
                {...fieldAria("subjectId", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.subjectId),
                })}
                name="subjectId"
                defaultValue=""
              >
                <option value="">No subject</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code ? `${subject.code} — ` : ""}
                    {subject.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field id="date" label="Date" errors={fieldErrors?.date}>
              <Input
                {...fieldAria("date", { hasError: Boolean(fieldErrors?.date) })}
                type="date"
                name="date"
                className="h-9"
              />
            </Field>

            <Field id="time" label="Time" errors={fieldErrors?.time}>
              <Input
                {...fieldAria("time", { hasError: Boolean(fieldErrors?.time) })}
                type="time"
                name="time"
                className="h-9"
              />
            </Field>

            <Field
              id="durationMinutes"
              label="Duration"
              hint="Minutes."
              errors={fieldErrors?.durationMinutes}
            >
              <Input
                {...fieldAria("durationMinutes", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.durationMinutes),
                })}
                type="number"
                name="durationMinutes"
                min={1}
                max={1440}
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

            <Field
              id="location"
              label="Location"
              errors={fieldErrors?.location}
              className="sm:col-span-2"
            >
              <Input
                {...fieldAria("location", {
                  hasError: Boolean(fieldErrors?.location),
                })}
                name="location"
                placeholder="Hall 3"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create exam"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
