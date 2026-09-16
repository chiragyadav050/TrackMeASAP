import {
  ClipboardList,
  FileText,
  StickyNote,
  Timer,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import {
  AttendanceFigure,
  AttendanceRiskBadge,
  AssignmentStatusBadge,
  EXAM_TYPE_LABELS,
  PreparationFigure,
  RISK_META,
  SubmissionBadge,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import { formatStudyDuration } from "@/services/academics/academic.derive";
import type { AttendanceSummary } from "@/services/academics/attendance.calculator";
import type { AssignmentDto, ExamDto } from "@/types/academics";

export type SubjectDetailView = {
  readonly subject: {
    readonly id: string;
    readonly name: string;
    readonly code: string | null;
    readonly facultyName: string | null;
    readonly credits: number | null;
    readonly notes: string | null;
  };
  readonly attendance: AttendanceSummary;
  readonly assignments: readonly AssignmentDto[];
  readonly exams: readonly ExamDto[];
  readonly studyWeekMinutes: number;
  readonly studyTotalMinutes: number;
  readonly notes: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly updatedAt: Date;
  }[];
  readonly openTaskCount: number;
};

/**
 * The subject page.
 *
 * One screen rather than tabs: everything a student needs about a subject
 * fits, and tabbing would hide the attendance figure — the number they most
 * often came to check — behind a click.
 *
 * All the business logic is computed server-side; this renders it.
 */
export function SubjectDetail({ view }: { view: SubjectDetailView }) {
  const { subject, attendance } = view;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title font-semibold tracking-tight">
              {subject.name}
            </h2>
            <p className="text-meta text-muted-foreground">
              {[
                subject.code,
                subject.credits ? `${subject.credits} credits` : null,
                subject.facultyName,
              ]
                .filter(Boolean)
                .join(" · ") || "No details recorded"}
            </p>
          </div>

          <AttendanceRiskBadge risk={attendance.risk} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AttendancePanel attendance={attendance} subjectId={subject.id} />

        <SectionCard title="Study" icon={Timer}>
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-label text-muted-foreground">This week</p>
              <p className="text-title font-semibold tabular-nums">
                {view.studyWeekMinutes === 0
                  ? "—"
                  : formatStudyDuration(view.studyWeekMinutes)}
              </p>
            </div>
            <div className="border-t border-border-subtle pt-3">
              <p className="text-label text-muted-foreground">All time</p>
              <p className="text-meta font-medium tabular-nums">
                {view.studyTotalMinutes === 0
                  ? "Nothing logged yet"
                  : formatStudyDuration(view.studyTotalMinutes)}
              </p>
            </div>
            <div className="border-t border-border-subtle pt-3">
              <p className="text-label text-muted-foreground">Open tasks</p>
              <p className="text-meta font-medium tabular-nums">
                {view.openTaskCount}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Assignments"
          icon={ClipboardList}
          badge={String(view.assignments.length)}
          className="lg:col-span-2"
          footer={
            <Link
              href="/academics/assignments"
              className="transition-colors hover:text-foreground"
            >
              All assignments
            </Link>
          }
        >
          {view.assignments.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.assignments.map((assignment) => (
                <li key={assignment.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-meta">{assignment.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <AssignmentStatusBadge status={assignment.status} />
                        <SubmissionBadge status={assignment.submissionStatus} />
                        {assignment.marksPercent !== null ? (
                          <span className="text-label text-muted-foreground tabular-nums">
                            {assignment.marksObtained}/{assignment.maxMarks}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {assignment.dueLabel ? (
                      <span
                        className={cn(
                          "shrink-0 text-label tabular-nums",
                          assignment.isOverdue
                            ? "text-danger"
                            : "text-muted-foreground",
                        )}
                      >
                        {assignment.dueLabel}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="No assignments yet"
              description="Assignments for this subject will appear here."
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard title="Exams" icon={FileText}>
          {view.exams.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.exams.map((exam) => (
                <li key={exam.id} className="space-y-1 px-4 py-2.5">
                  <Link
                    href={`/academics/exams/${exam.id}` as never}
                    className="block truncate text-meta transition-colors hover:text-brand-text"
                  >
                    {exam.title}
                  </Link>
                  <p className="text-label text-muted-foreground">
                    {EXAM_TYPE_LABELS[exam.type]}
                    {exam.dateLabel ? ` · ${exam.dateLabel}` : ""}
                  </p>
                  <PreparationFigure
                    percentage={exam.preparationPercent}
                    completedTopics={exam.completedTopics}
                    totalTopics={exam.totalTopics}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={FileText}
              title="No exams"
              description="No exams recorded for this subject."
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Notes"
          icon={StickyNote}
          className="lg:col-span-3"
          badge={String(view.notes.length)}
        >
          {view.notes.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.notes.map((note) => (
                <li key={note.id} className="px-4 py-3">
                  <p className="text-meta font-medium">{note.title}</p>
                  <p className="mt-1 text-meta whitespace-pre-wrap text-muted-foreground">
                    {note.body}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={StickyNote}
              title="No notes"
              description="Lightweight notes for this subject will appear here."
              className="flex-1"
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/**
 * The attendance panel — the number students actually come here for.
 *
 * Shows the raw counts, the percentage against the requirement, and the ONE
 * actionable sentence: how many more can be missed, or how many must be
 * attended. Both come from the tested calculator, never from arithmetic done
 * here.
 */
function AttendancePanel({
  attendance,
  subjectId,
}: {
  attendance: AttendanceSummary;
  subjectId: string;
}) {
  return (
    <SectionCard
      title="Attendance"
      icon={UserCheck}
      footer={
        <Link
          href={`/academics/attendance?subject=${subjectId}` as never}
          className="transition-colors hover:text-foreground"
        >
          Mark attendance
        </Link>
      }
    >
      <div className="space-y-3 px-4 py-4">
        <AttendanceFigure
          percentage={attendance.percentage}
          thresholdPercent={attendance.thresholdPercent}
          className="text-title"
        />

        <dl className="grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
          <div>
            <dt className="text-label text-muted-foreground">Present</dt>
            <dd className="text-meta font-medium tabular-nums">
              {attendance.counts.present}
            </dd>
          </div>
          <div>
            <dt className="text-label text-muted-foreground">Absent</dt>
            <dd className="text-meta font-medium tabular-nums">
              {attendance.counts.absent}
            </dd>
          </div>
          <div>
            <dt className="text-label text-muted-foreground">Excused</dt>
            <dd
              className="text-meta font-medium tabular-nums"
              title="Excused classes are excluded from the percentage entirely."
            >
              {attendance.counts.excused}
            </dd>
          </div>
        </dl>

        <p className="border-t border-border-subtle pt-3 text-meta">
          {buildAdvice(attendance)}
        </p>

        <p className="text-label text-muted-foreground">
          {RISK_META[attendance.risk].description}
        </p>
      </div>
    </SectionCard>
  );
}

/**
 * The single actionable sentence.
 *
 * Every branch is driven by the calculator's output — there is no arithmetic
 * in this function, only phrasing.
 */
function buildAdvice(attendance: AttendanceSummary): string {
  if (attendance.percentage === null) {
    return "No classes marked yet, so there is nothing to calculate.";
  }

  if (attendance.meetsThreshold) {
    if (attendance.canMiss === null || attendance.canMiss === 0) {
      return `You are at the ${attendance.thresholdPercent}% line — missing even one more class drops you below it.`;
    }

    return `You can miss ${attendance.canMiss} more ${
      attendance.canMiss === 1 ? "class" : "classes"
    } and stay at or above ${attendance.thresholdPercent}%.`;
  }

  if (attendance.mustAttend === null) {
    return `${attendance.thresholdPercent}% is no longer reachable from here.`;
  }

  return `You need to attend the next ${attendance.mustAttend} ${
    attendance.mustAttend === 1 ? "class" : "classes"
  } to reach ${attendance.thresholdPercent}%.`;
}
