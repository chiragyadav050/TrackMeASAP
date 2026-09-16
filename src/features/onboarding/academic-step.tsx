"use client";

import { ArrowRight, Plus, X } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/form/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUpAcademicsCommand } from "@/features/academics/actions";

/**
 * The last onboarding step: the semester everything academic hangs off.
 *
 * WHY IT IS HERE AT ALL. Subjects, exams, attendance and assignments all
 * require a semester, so a brand-new account could reach the dashboard and
 * find half the product refusing to work — including the assistant, which had
 * to answer "create a semester under Academics first". Asking once, here,
 * removes that wall before the user ever hits it.
 *
 * GENUINELY SKIPPABLE, and skipping is not failure. Plenty of people want the
 * tasks and habits side and no coursework at all, and forcing a semester on
 * them would mean inventing dates they do not have.
 */

/** A sensible academic year label like "2025-26" for the current date. */
function currentAcademicYear(now: Date): string {
  const year = now.getFullYear();
  // Academic years are usually written from the year the term started, and
  // most start after mid-year.
  const start = now.getMonth() >= 5 ? year : year - 1;

  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type AcademicStepProps = {
  readonly onDone: () => void;
};

export function AcademicStep({ onDone }: AcademicStepProps) {
  const now = new Date();

  const [name, setName] = useState("");
  const [academicYear, setAcademicYear] = useState(currentAcademicYear(now));
  const [startDate, setStartDate] = useState(isoDate(now));
  const [endDate, setEndDate] = useState(() => {
    const end = new Date(now);
    // A term is roughly five months; a guess the user can correct beats an
    // empty required field.
    end.setMonth(end.getMonth() + 5);
    return isoDate(end);
  });

  const [subjects, setSubjects] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const addSubject = (): void => {
    const value = draft.trim();

    if (!value) {
      return;
    }

    // Case-insensitive, because "Maths" and "maths" are one subject.
    const exists = subjects.some(
      (subject) => subject.toLowerCase() === value.toLowerCase(),
    );

    if (!exists) {
      setSubjects([...subjects, value]);
    }

    setDraft("");
  };

  const save = async (): Promise<void> => {
    if (!name.trim()) {
      setError("Give the semester a name, or skip this step.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const result = await setUpAcademicsCommand({
      name: name.trim(),
      academicYear: academicYear.trim(),
      startDate,
      endDate,
      subjects: [...subjects],
    });

    if (result.status === "success") {
      onDone();
      return;
    }

    // Reported, never swallowed — a silent failure here would drop the user on
    // a dashboard that looks set up and is not.
    setError(
      result.status === "error"
        ? result.message
        : "Couldn't save your semester. Try again.",
    );
    setIsSaving(false);
  };

  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h2 className="text-heading font-semibold tracking-tight">
          Set up your semester
        </h2>
        <p className="text-meta text-muted-foreground">
          Attendance, exams and assignments all live inside a semester. This
          takes ten seconds — or skip it if you are not studying right now.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field
          id="semesterName"
          label="Semester name"
          hint="However you refer to it."
          className="sm:col-span-2"
        >
          <Input
            id="semesterName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Semester 5"
            maxLength={80}
            autoFocus
          />
        </Field>

        <Field id="academicYear" label="Academic year">
          <Input
            id="academicYear"
            value={academicYear}
            onChange={(event) => setAcademicYear(event.target.value)}
            maxLength={20}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="startDate" label="Starts">
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>

          <Field id="endDate" label="Ends">
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
        </div>

        <Field
          id="subjectDraft"
          label="Subjects"
          hint="Add a few now; you can add more any time."
          className="sm:col-span-2"
        >
          <div className="flex gap-2">
            <Input
              id="subjectDraft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter adds a subject rather than submitting, which would
                // save the form with the typed name silently discarded.
                if (event.key === "Enter") {
                  event.preventDefault();
                  addSubject();
                }
              }}
              placeholder="Data Structures"
              maxLength={120}
            />

            <Button
              type="button"
              variant="outline"
              onClick={addSubject}
              disabled={!draft.trim()}
              aria-label="Add subject"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </Field>

        {subjects.length > 0 ? (
          <ul className="flex flex-wrap gap-2 sm:col-span-2">
            {subjects.map((subject) => (
              <li key={subject}>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-3 text-label">
                  {subject}
                  <button
                    type="button"
                    onClick={() =>
                      setSubjects(subjects.filter((one) => one !== subject))
                    }
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Remove ${subject}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="lg"
          onClick={() => void save()}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : "Finish setup"}
          {isSaving ? null : (
            <ArrowRight data-icon="inline-end" className="size-4" />
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          onClick={onDone}
          disabled={isSaving}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
}
