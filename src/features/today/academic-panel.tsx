import {
  AlertTriangle,
  BookOpen,
  ClipboardList,
  FileText,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

import { SectionCard } from "@/components/common/section-card";
import { cn } from "@/lib/utils";
import type {
  AcademicPriorityDto,
  AssignmentDto,
  ExamDto,
} from "@/types/academics";

export type TodayAcademics = {
  readonly dueToday: readonly AssignmentDto[];
  readonly overdue: readonly AssignmentDto[];
  readonly nextExam: ExamDto | null;
  readonly attendanceWarnings: readonly {
    subjectId: string;
    subjectName: string;
    percentage: number | null;
    thresholdPercent: number;
    risk: string;
    mustAttend: number | null;
  }[];
  readonly topPriority: AcademicPriorityDto | null;
};

/**
 * The academic slice of Today.
 *
 * Renders NOTHING when there is nothing academic to say — an empty "Academics"
 * card on a day with no coursework is noise, and Today's job is to be scanned
 * in seconds.
 *
 * Every figure is deterministic. No AI generates any of this copy.
 */
export function AcademicPanel({ academics }: { academics: TodayAcademics }) {
  const hasAnything =
    academics.dueToday.length > 0 ||
    academics.overdue.length > 0 ||
    academics.nextExam !== null ||
    academics.attendanceWarnings.length > 0;

  if (!hasAnything) {
    return null;
  }

  return (
    <SectionCard
      title="Academics"
      icon={BookOpen}
      description="Coursework, exams and attendance that need you today."
      footer={
        <Link
          href="/academics"
          className="transition-colors hover:text-foreground"
        >
          Open Academics
        </Link>
      }
    >
      <div className="divide-y divide-border-subtle">
        {academics.attendanceWarnings.length > 0 ? (
          <div className="px-4 py-3">
            <p className="text-label-caps flex items-center gap-1.5 text-danger">
              <AlertTriangle className="size-3.5" aria-hidden />
              Attendance
            </p>

            <ul className="mt-1.5 space-y-1">
              {academics.attendanceWarnings.map((warning) => (
                <li key={warning.subjectId} className="text-meta">
                  <Link
                    href={`/academics/subjects/${warning.subjectId}` as never}
                    className="transition-colors hover:text-brand-text"
                  >
                    {warning.subjectName}
                  </Link>{" "}
                  <span className="text-label text-muted-foreground">
                    {warning.percentage === null
                      ? "no data"
                      : `${Math.round(warning.percentage * 10) / 10}% of ${warning.thresholdPercent}%`}
                    {warning.mustAttend !== null && warning.mustAttend > 0
                      ? ` · attend the next ${warning.mustAttend}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {academics.overdue.length > 0 ? (
          <AssignmentGroup
            label="Overdue"
            icon={ClipboardList}
            tone="danger"
            assignments={academics.overdue}
          />
        ) : null}

        {academics.dueToday.length > 0 ? (
          <AssignmentGroup
            label="Due today"
            icon={ClipboardList}
            assignments={academics.dueToday}
          />
        ) : null}

        {academics.nextExam ? (
          <div className="px-4 py-3">
            <p className="text-label-caps flex items-center gap-1.5 text-muted-foreground">
              <FileText className="size-3.5" aria-hidden />
              Next exam
            </p>

            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <Link
                href={`/academics/exams/${academics.nextExam.id}` as never}
                className="min-w-0 truncate text-meta transition-colors hover:text-brand-text"
              >
                {academics.nextExam.title}
              </Link>

              <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                {academics.nextExam.daysRemaining === 0
                  ? "Today"
                  : academics.nextExam.daysRemaining === 1
                    ? "Tomorrow"
                    : `${academics.nextExam.daysRemaining} days`}
              </span>
            </div>

            <p className="mt-0.5 text-label text-muted-foreground">
              {academics.nextExam.preparationPercent === null
                ? "Preparation tracking not started"
                : `${Math.round(academics.nextExam.preparationPercent)}% prepared · ${academics.nextExam.completedTopics}/${academics.nextExam.totalTopics} topics`}
            </p>
          </div>
        ) : null}

        {academics.topPriority ? (
          <div className="px-4 py-3">
            <p className="text-label-caps flex items-center gap-1.5 text-muted-foreground">
              <UserCheck className="size-3.5" aria-hidden />
              Suggested focus
            </p>

            <p className="mt-1.5 text-meta">{academics.topPriority.title}</p>

            {academics.topPriority.reasons.length > 0 ? (
              <p className="mt-0.5 text-label text-muted-foreground">
                {academics.topPriority.reasons.join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function AssignmentGroup({
  label,
  icon: Icon,
  assignments,
  tone,
}: {
  label: string;
  icon: typeof ClipboardList;
  assignments: readonly AssignmentDto[];
  tone?: "danger";
}) {
  return (
    <div className="px-4 py-3">
      <p
        className={cn(
          "text-label-caps flex items-center gap-1.5",
          tone === "danger" ? "text-danger" : "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>

      <ul className="mt-1.5 space-y-1">
        {assignments.map((assignment) => (
          <li
            key={assignment.id}
            className="flex items-baseline justify-between gap-3 text-meta"
          >
            <span className="min-w-0 truncate">{assignment.title}</span>
            <span className="shrink-0 text-label text-muted-foreground">
              {assignment.subjectCode ?? assignment.subjectName}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
