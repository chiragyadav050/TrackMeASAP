"use client";

import { Timer, TrendingUp } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { logStudySessionAction } from "@/features/academics/actions";
import { formatStudyDuration } from "@/services/academics/academic.derive";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";

export type StudyBoardView = {
  readonly todayMinutes: number;
  readonly weekMinutes: number;
  readonly activeDays: number;
  readonly bySubject: readonly {
    subjectId: string;
    subjectName: string;
    minutes: number;
  }[];
  readonly recent: readonly {
    id: string;
    subjectName: string;
    topicTitle: string | null;
    dateLabel: string;
    durationMinutes: number;
    focusRating: number | null;
  }[];
  readonly subjects: readonly {
    id: string;
    name: string;
    code: string | null;
  }[];
};

/**
 * The study surface.
 *
 * Sessions are logged after the fact rather than timed live — there is no
 * background job to close an abandoned timer, and a stopwatch left running
 * overnight produces worse data than an honest estimate.
 */
export function StudyBoard({ view }: { view: StudyBoardView }) {
  const maxMinutes = Math.max(
    1,
    ...view.bySubject.map((entry) => entry.minutes),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Today"
            value={
              view.todayMinutes === 0
                ? "—"
                : formatStudyDuration(view.todayMinutes)
            }
          />
          <StatCard
            label="This week"
            value={
              view.weekMinutes === 0
                ? "—"
                : formatStudyDuration(view.weekMinutes)
            }
          />
          <StatCard
            label="Days studied"
            value={`${view.activeDays} / 7`}
            hint="Consistency counts days, not sessions."
          />
        </div>

        <SectionCard
          title="By subject"
          icon={TrendingUp}
          description="Last seven days."
        >
          {view.bySubject.length > 0 ? (
            <ul className="space-y-2 px-4 py-4">
              {view.bySubject.map((entry) => (
                <li key={entry.subjectId} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-meta">
                      {entry.subjectName}
                    </span>
                    <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                      {formatStudyDuration(entry.minutes)}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-valuenow={entry.minutes}
                    aria-valuemin={0}
                    aria-valuemax={maxMinutes}
                    aria-label={`${entry.subjectName}: ${formatStudyDuration(entry.minutes)}`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${(entry.minutes / maxMinutes) * 100}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="Nothing logged this week"
              description="Study time by subject will appear here."
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard title="Recent sessions" icon={Timer}>
          {view.recent.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.recent.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-meta">{session.subjectName}</p>
                    <p className="text-label text-muted-foreground">
                      {session.dateLabel}
                      {session.topicTitle ? ` · ${session.topicTitle}` : ""}
                      {session.focusRating
                        ? ` · focus ${session.focusRating}/5`
                        : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                    {formatStudyDuration(session.durationMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Timer}
              title="Your study history will appear here once you log a session."
              description="Log one on the right — it takes a few seconds."
              className="flex-1"
            />
          )}
        </SectionCard>
      </div>

      <LogStudyForm subjects={view.subjects} />
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-label-caps text-muted-foreground">{label}</p>
      <p className="mt-1 text-title font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-label text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function LogStudyForm({
  subjects,
}: {
  subjects: readonly { id: string; name: string; code: string | null }[];
}) {
  const [state, formAction, isPending] = useActionState<
    ActionState<{ studySessionId: string }>,
    FormData
  >(logStudySessionAction, IDLE_ACTION_STATE);

  const formRef = useRef<HTMLFormElement>(null);
  const lastHandled = useRef<ActionState<{ studySessionId: string }> | null>(
    null,
  );

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Study session logged.");
      formRef.current?.reset();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't log that session.");
    }
  }, [state]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  if (subjects.length === 0) {
    return (
      <SectionCard title="Log study" icon={Timer}>
        <EmptyState
          icon={Timer}
          title="No subjects yet"
          description="Add a subject before logging study time."
          className="flex-1"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Log study"
      icon={Timer}
      description="Record time after the fact."
    >
      <form
        ref={formRef}
        action={formAction}
        className="space-y-3 px-4 py-4"
        noValidate
      >
        <Field id="subjectId" label="Subject" errors={fieldErrors?.subjectId}>
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
          id="durationMinutes"
          label="Minutes"
          errors={fieldErrors?.durationMinutes}
        >
          <Input
            {...fieldAria("durationMinutes", {
              hasError: Boolean(fieldErrors?.durationMinutes),
            })}
            type="number"
            name="durationMinutes"
            min={1}
            max={1440}
            step={5}
            defaultValue={45}
            className="h-9"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            id="date"
            label="Date"
            hint="Defaults to today."
            errors={fieldErrors?.date}
          >
            <Input
              {...fieldAria("date", {
                hasHint: true,
                hasError: Boolean(fieldErrors?.date),
              })}
              type="date"
              name="date"
              className="h-9"
            />
          </Field>

          <Field
            id="focusRating"
            label="Focus"
            hint="1–5, optional."
            errors={fieldErrors?.focusRating}
          >
            <Input
              {...fieldAria("focusRating", {
                hasHint: true,
                hasError: Boolean(fieldErrors?.focusRating),
              })}
              type="number"
              name="focusRating"
              min={1}
              max={5}
              className="h-9"
            />
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

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Logging…" : "Log session"}
        </Button>
      </form>
    </SectionCard>
  );
}
