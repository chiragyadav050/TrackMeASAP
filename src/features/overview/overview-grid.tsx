import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FolderKanban,
  Wallet,
  GraduationCap,
  Inbox,
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { phaseLabel } from "@/config/phases";
import { cn } from "@/lib/utils";
import {
  AttendanceFigure,
  AttendanceRiskBadge,
  PreparationFigure,
} from "@/features/academics/components/academic-badges";
import { formatStudyDuration } from "@/services/academics/academic.derive";
import type { AcademicOverviewDto } from "@/types/academics";
import type { TodayViewDto } from "@/types/task";
import { HealthBadge } from "@/features/work/components/work-badges";
import type { ProjectsSummaryDto } from "@/types/work";
import { MoodBadge, StreakBadge } from "@/features/life/components/life-badges";
import type { LifeSummaryDto } from "@/services/life/life.query";
import type { MoneySummaryDto } from "@/types/life";

type OverviewGridProps = {
  readonly view: TodayViewDto;
  readonly academics: AcademicOverviewDto;
  readonly work: ProjectsSummaryDto;
  readonly life: LifeSummaryDto;
  readonly money: MoneySummaryDto;
};

/**
 * The Overview dashboard.
 *
 * Phase 2 made the task tiles real; Phase 3 did the same for the academic
 * ones and Phase 4 for work. Habits and Goals remain honest placeholders
 * naming the phase that fills them — inventing figures would be worse than an
 * empty panel.
 *
 * Widgets are independent components reading independent slices, so a future
 * module plugs in by adding a tile rather than rewriting the grid.
 */
export function OverviewGrid({
  view,
  academics,
  work,
  life,
  money,
}: OverviewGridProps) {
  const { statistics } = view;
  const hasTasks = statistics.activeCount > 0 || statistics.completedToday > 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SectionCard
        title="Today"
        icon={Inbox}
        description="What needs to happen in the next few hours."
        className="lg:col-span-2 lg:row-span-2"
        footer={
          hasTasks ? (
            <Link
              href="/today"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Open Today
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          ) : undefined
        }
      >
        {view.dueToday.length > 0 || view.overdue.length > 0 ? (
          <div className="divide-y divide-border-subtle">
            {view.overdue.slice(0, 3).map((task) => (
              <OverviewTaskRow key={task.id} task={task} />
            ))}
            {view.dueToday.slice(0, 5).map((task) => (
              <OverviewTaskRow key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <EmptyState
            size="page"
            icon={Inbox}
            title={hasTasks ? "Nothing due today" : "No tasks yet"}
            description={
              hasTasks
                ? "Nothing is scheduled for today. Upcoming work is on the Today page."
                : "Your daily command center will appear here."
            }
            action={
              <Button
                size="sm"
                variant={hasTasks ? "outline" : "default"}
                render={<Link href="/tasks">Go to Tasks</Link>}
              />
            }
            className="flex-1"
          />
        )}
      </SectionCard>

      <SectionCard title="Progress" icon={CheckCircle2} description="Today.">
        <div className="space-y-3 px-4 py-4">
          {statistics.dueTodayTotal === 0 && statistics.completedToday === 0 ? (
            <p className="text-meta text-muted-foreground">
              Nothing was scheduled for today.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-title font-semibold tabular-nums">
                  {statistics.todayCompletionPercent}%
                </span>
                <span className="text-meta text-muted-foreground tabular-nums">
                  {statistics.completedToday} of {statistics.dueTodayTotal}
                </span>
              </div>

              <div
                className="h-1.5 overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuenow={statistics.todayCompletionPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${statistics.todayCompletionPercent}% of today's tasks complete`}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500",
                    statistics.todayCompletionPercent === 100
                      ? "bg-success"
                      : "bg-primary",
                  )}
                  style={{
                    width: `${statistics.todayCompletionPercent}%`,
                  }}
                />
              </div>
            </>
          )}

          <dl className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
            <div>
              <dt className="text-label text-muted-foreground">Active</dt>
              <dd className="text-meta font-medium tabular-nums">
                {statistics.activeCount}
              </dd>
            </div>
            <div>
              <dt className="text-label text-muted-foreground">Overdue</dt>
              <dd
                className={cn(
                  "flex items-center gap-1 text-meta font-medium tabular-nums",
                  statistics.overdueCount > 0 && "text-danger",
                )}
              >
                {statistics.overdueCount > 0 ? (
                  <AlertTriangle className="size-3.5" aria-hidden />
                ) : null}
                {statistics.overdueCount}
              </dd>
            </div>
          </dl>
        </div>
      </SectionCard>

      <SectionCard
        title="Upcoming"
        icon={CalendarClock}
        description="The next seven days."
      >
        {view.upcoming.length > 0 ? (
          <ul className="divide-y divide-border-subtle">
            {view.upcoming.slice(0, 5).map((task) => (
              <li
                key={task.id}
                className="flex items-start gap-3 px-4 py-2 text-meta"
              >
                <span className="w-16 shrink-0 text-label text-muted-foreground">
                  {task.dueLabel}
                </span>
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            description="No deadlines in the next week."
            className="flex-1"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Academic progress"
        icon={GraduationCap}
        description={
          academics.semester
            ? `${academics.semester.name} · ${academics.subjectCount} subjects`
            : "Subjects, assessments and attendance at a glance."
        }
        footer={
          academics.semester ? (
            <Link
              href="/academics"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Open Academics
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          ) : undefined
        }
      >
        {academics.semester ? (
          <div className="space-y-3 px-4 py-4">
            <div>
              <p className="text-label text-muted-foreground">Attendance</p>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <AttendanceFigure
                  percentage={academics.attendance?.percentage ?? null}
                  thresholdPercent={
                    academics.attendance?.thresholdPercent ?? 75
                  }
                />
                {academics.attendance ? (
                  <AttendanceRiskBadge
                    risk={academics.attendance.risk}
                    showLabel={false}
                  />
                ) : null}
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
              <div>
                <dt className="text-label text-muted-foreground">
                  Assignments
                </dt>
                <dd className="text-meta font-medium tabular-nums">
                  {academics.assignmentsTotal === 0
                    ? "—"
                    : `${academics.assignmentsCompleted} / ${academics.assignmentsTotal}`}
                </dd>
              </div>
              <div>
                <dt className="text-label text-muted-foreground">
                  Study this week
                </dt>
                <dd className="text-meta font-medium tabular-nums">
                  {academics.studyWeekMinutes === 0
                    ? "—"
                    : formatStudyDuration(academics.studyWeekMinutes)}
                </dd>
              </div>
            </dl>

            {academics.upcomingExams.length > 0 ? (
              <div className="border-t border-border-subtle pt-3">
                <p className="text-label text-muted-foreground">Next exam</p>
                <p className="mt-0.5 truncate text-meta">
                  {academics.upcomingExams[0]?.title}
                  {academics.upcomingExams[0]?.daysRemaining !== null ? (
                    <span className="text-label text-muted-foreground">
                      {" "}
                      · {academics.upcomingExams[0]?.daysRemaining}d
                    </span>
                  ) : null}
                </p>
                <div className="mt-1">
                  <PreparationFigure
                    percentage={
                      academics.upcomingExams[0]?.preparationPercent ?? null
                    }
                    completedTopics={
                      academics.upcomingExams[0]?.completedTopics ?? 0
                    }
                    totalTopics={academics.upcomingExams[0]?.totalTopics ?? 0}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={GraduationCap}
            title="No semester yet"
            description="Create a semester and add your subjects to begin tracking academics."
            action={
              <Button
                size="sm"
                render={<Link href="/academics">Set up academics</Link>}
              />
            }
            className="flex-1"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Projects"
        icon={FolderKanban}
        description={
          work.activeCount === 0
            ? "Long-running efforts with milestones and blockers."
            : `${work.activeCount} active${work.blockedCount > 0 ? ` · ${work.blockedCount} blocked` : ""}`
        }
        footer={
          work.activeCount > 0 ? (
            <Link href="/work" className="underline-offset-4 hover:underline">
              Open Work →
            </Link>
          ) : undefined
        }
      >
        {work.projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No active projects"
            description="Create a workspace and a project, and their health will show up here."
            action={
              <Button
                size="sm"
                render={<Link href="/work">Set up work</Link>}
              />
            }
            className="flex-1"
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {work.projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}` as never}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-meta">
                    {project.name}
                  </span>
                  <HealthBadge
                    health={project.health}
                    showLabel={false}
                    className="shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Goals"
        icon={Target}
        description={
          life.activeGoalCount === 0
            ? "The outcomes everything else is for."
            : `${life.activeGoalCount} active`
        }
        footer={
          life.activeGoalCount > 0 ? (
            <Link href="/goals" className="underline-offset-4 hover:underline">
              Open Goals →
            </Link>
          ) : undefined
        }
      >
        {life.activeGoalCount === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals set"
            description="A goal can be measured or broken into milestones. Life OS only reports progress it can compute."
            action={
              <Button
                size="sm"
                render={<Link href="/goals">Set a goal</Link>}
              />
            }
            className="flex-1"
          />
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-1 px-4 py-6 text-center">
            <p className="text-title font-semibold tabular-nums">
              {life.activeGoalCount}
            </p>
            <p className="text-label text-muted-foreground">
              {life.activeGoalCount === 1 ? "active goal" : "active goals"}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Habits"
        icon={Activity}
        description={
          life.habits.dueTodayCount === 0
            ? "The small repeated things that compound."
            : `${life.habits.doneTodayCount} of ${life.habits.dueTodayCount} done today`
        }
        footer={
          life.habits.habits.length > 0 ? (
            <Link href="/habits" className="underline-offset-4 hover:underline">
              Open Habits →
            </Link>
          ) : undefined
        }
      >
        {life.habits.habits.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No habits tracked"
            description="Streaks are computed from what you actually log — nothing is assumed."
            action={
              <Button
                size="sm"
                render={<Link href="/habits">Add a habit</Link>}
              />
            }
            className="flex-1"
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {life.habits.habits.slice(0, 5).map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-meta">
                  {habit.name}
                </span>
                {habit.todayStatus === "DONE" ? (
                  <span className="shrink-0 text-label text-success">Done</span>
                ) : (
                  <StreakBadge
                    days={habit.currentStreak}
                    className="shrink-0"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="This month"
        icon={Wallet}
        description={
          money.entryCount === 0
            ? "Where the money goes."
            : `${money.entryCount} ${money.entryCount === 1 ? "entry" : "entries"}`
        }
        footer={
          money.entryCount > 0 ? (
            <Link
              href="/finance"
              className="underline-offset-4 hover:underline"
            >
              Open Finance →
            </Link>
          ) : undefined
        }
      >
        {money.entryCount === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nothing recorded"
            description="Totals here are sums of entries you type. Nothing is estimated."
            action={
              <Button
                size="sm"
                render={<Link href="/finance">Add an entry</Link>}
              />
            }
            className="flex-1"
          />
        ) : (
          <dl className="flex flex-1 flex-col justify-center gap-2 px-4 py-5">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-label text-muted-foreground">Spent</dt>
              <dd className="text-meta font-medium tabular-nums">
                {money.expenseLabel}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-label text-muted-foreground">Net</dt>
              <dd
                className={cn(
                  "text-meta font-medium tabular-nums",
                  money.netMinor < 0 ? "text-danger" : "text-success",
                )}
              >
                {money.netLabel}
              </dd>
            </div>
            {life.checkIn?.mood ? (
              <div className="flex items-baseline justify-between gap-2 border-t border-border-subtle pt-2">
                <dt className="text-label text-muted-foreground">Mood today</dt>
                <dd>
                  <MoodBadge mood={life.checkIn.mood} />
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </SectionCard>

      <SectionCard
        title="AI assistant"
        icon={Sparkles}
        badge="Phase 8"
        description="Context-aware help across everything above."
        className="lg:col-span-3"
        footer="No model is connected and nothing on this page is generated."
      >
        <div className="flex flex-col items-start gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-pretty text-muted-foreground">
            Your AI Life Assistant will be connected in Phase 8. It will read
            your real tasks, coursework and calendar — and act on them with your
            confirmation.
          </p>

          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            render={
              <Link href="/ai">
                {phaseLabel(8)}
                <ArrowRight data-icon="inline-end" className="size-3.5" />
              </Link>
            }
          />
        </div>
      </SectionCard>
    </div>
  );
}

/** A read-only task line. The dashboard links to Tasks rather than mutating. */
function OverviewTaskRow({ task }: { task: TodayViewDto["dueToday"][number] }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          task.isOverdue ? "bg-danger" : "bg-muted-foreground/40",
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-meta">{task.title}</p>

        {task.isOverdue ? (
          <p className="text-label text-danger">
            {task.overdueLabel ?? "Overdue"}
          </p>
        ) : task.dueTimeLabel ? (
          <p className="text-label text-muted-foreground">
            {task.dueTimeLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
