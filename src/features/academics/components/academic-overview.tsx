import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FileText,
  GraduationCap,
  Library,
  Sparkles,
  Timer,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { QuickSetupButton } from "@/features/academics/components/quick-setup-button";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AttendanceFigure,
  AttendanceRiskBadge,
  EXAM_TYPE_LABELS,
  PreparationFigure,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import { formatStudyDuration } from "@/services/academics/academic.derive";
import type { AcademicOverviewDto } from "@/types/academics";

/**
 * The Academics overview — "how is this semester going?".
 *
 * Every figure comes from the database. Where there is no data the tile says
 * so; nothing here is invented to make the page look populated.
 */
export function AcademicOverview({ view }: { view: AcademicOverviewDto }) {
  if (!view.semester) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={GraduationCap}
          title="Start by creating your current semester."
          description="Everything academic — subjects, attendance, assignments and exams — hangs off a semester."
          action={<QuickSetupButton />}
        />
      </div>
    );
  }

  const { semester, attendance } = view;

  const assignmentPercent =
    view.assignmentsTotal === 0
      ? null
      : Math.round((view.assignmentsCompleted / view.assignmentsTotal) * 100);

  return (
    <div className="space-y-4">
      {/* Semester banner. Progress is elapsed calendar time, which is a fact,
          not a judgement about how much work is done. */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-title font-semibold tracking-tight">
                {semester.name}
              </h2>
              {semester.isCurrent ? (
                <Badge variant="secondary">Current</Badge>
              ) : null}
            </div>
            <p className="text-meta text-muted-foreground">
              {semester.academicYear} · {formatDateOnly(semester.startDate)} –{" "}
              {formatDateOnly(semester.endDate)}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            render={<Link href="/academics/semesters">Manage</Link>}
          />
        </div>

        {semester.progressPercent !== null ? (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-label">
              <span className="text-muted-foreground">Semester elapsed</span>
              <span className="tabular-nums">
                {Math.round(semester.progressPercent)}%
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={Math.round(semester.progressPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Semester elapsed"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${semester.progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={Library}
          label="Subjects"
          value={String(view.subjectCount)}
          href="/academics/subjects"
        />

        <StatTile
          icon={UserCheck}
          label="Attendance"
          value={
            attendance?.percentage === null || attendance === null
              ? "—"
              : `${Math.round(attendance.percentage * 10) / 10}%`
          }
          hint={
            attendance === null || attendance.percentage === null
              ? "No classes marked"
              : undefined
          }
          href="/academics/attendance"
          accent={
            attendance && attendance.percentage !== null
              ? attendance.percentage >= attendance.thresholdPercent
                ? undefined
                : "danger"
              : undefined
          }
        />

        <StatTile
          icon={ClipboardList}
          label="Assignments"
          value={
            view.assignmentsTotal === 0
              ? "—"
              : `${view.assignmentsCompleted} / ${view.assignmentsTotal}`
          }
          hint={
            assignmentPercent === null
              ? "None yet"
              : `${assignmentPercent}% complete`
          }
          href="/academics/assignments"
        />

        <StatTile
          icon={Timer}
          label="Study this week"
          value={
            view.studyWeekMinutes === 0
              ? "—"
              : formatStudyDuration(view.studyWeekMinutes)
          }
          hint={
            view.studyTodayMinutes > 0
              ? `${formatStudyDuration(view.studyTodayMinutes)} today`
              : "Nothing logged today"
          }
          href="/academics/study"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="What needs attention"
          icon={Sparkles}
          description="Ranked by deadline, exam proximity and attendance risk."
          className="lg:col-span-2"
          footer="Deterministic ranking — no AI involved."
        >
          {view.priorities.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.priorities.map((item) => (
                <li key={item.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-meta">{item.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {item.subjectName ? (
                          <span className="text-label text-muted-foreground">
                            {item.subjectName}
                          </span>
                        ) : null}
                        {item.reasons.map((reason) => (
                          <span
                            key={reason}
                            className={cn(
                              "rounded border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-label",
                              item.isOverdue
                                ? "text-danger"
                                : "text-muted-foreground",
                            )}
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>

                    {item.dueLabel ? (
                      <span
                        className={cn(
                          "shrink-0 text-label tabular-nums",
                          item.isOverdue
                            ? "text-danger"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.dueLabel}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="Nothing pressing"
              description="No overdue work, no imminent exams, no attendance warnings."
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Attendance by subject"
          icon={UserCheck}
          footer={
            <Link
              href="/academics/attendance"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Open attendance
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
        >
          {view.attendanceBySubject.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.attendanceBySubject.map((entry) => (
                <li
                  key={entry.subjectId}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-meta">{entry.subjectName}</p>
                    <AttendanceFigure
                      percentage={entry.percentage}
                      thresholdPercent={entry.thresholdPercent}
                      className="text-label"
                    />
                  </div>
                  <AttendanceRiskBadge risk={entry.risk} showLabel={false} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Library}
              title="No subjects yet"
              description="Add your subjects to begin tracking academics."
              action={
                <Button
                  size="sm"
                  render={<Link href="/academics/subjects">Add subjects</Link>}
                />
              }
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Upcoming assignments"
          icon={ClipboardList}
          className="lg:col-span-2"
        >
          {view.upcomingAssignments.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.upcomingAssignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-meta">{assignment.title}</p>
                    <p className="text-label text-muted-foreground">
                      {assignment.subjectCode ?? assignment.subjectName}
                    </p>
                  </div>
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
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Nothing due"
              description="No assignments in the next two weeks."
              className="flex-1"
            />
          )}
        </SectionCard>

        <SectionCard title="Upcoming exams" icon={FileText}>
          {view.upcomingExams.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {view.upcomingExams.map((exam) => (
                <li key={exam.id} className="space-y-1 px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-meta">{exam.title}</p>
                      <p className="text-label text-muted-foreground">
                        {EXAM_TYPE_LABELS[exam.type]}
                        {exam.subjectCode ? ` · ${exam.subjectCode}` : ""}
                      </p>
                    </div>
                    {exam.daysRemaining !== null ? (
                      <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                        {exam.daysRemaining === 0
                          ? "Today"
                          : `${exam.daysRemaining}d`}
                      </span>
                    ) : null}
                  </div>
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
              icon={CalendarClock}
              title="No upcoming exams"
              description="Exams you add will appear here with preparation progress."
              className="flex-1"
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  href,
  accent,
}: {
  icon: typeof Library;
  label: string;
  value: string;
  hint?: string;
  href: string;
  accent?: "danger";
}) {
  return (
    <Link
      href={href as never}
      className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="text-label-caps flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </div>
      <p
        className={cn(
          "mt-1.5 text-title font-semibold tabular-nums",
          accent === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-label text-muted-foreground">{hint}</p> : null}
    </Link>
  );
}

/**
 * Renders a DATE-ONLY value.
 *
 * Read in UTC on purpose: `@db.Date` columns carry no zone, and converting
 * them would shift "1 January" into December for anyone west of Greenwich.
 */
function formatDateOnly(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}
