"use client";

import { CalendarPlus, Check, Minus, UserCheck, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  calculateAttendanceCommand,
  clearAttendanceCommand,
  generateSessionsCommand,
  markAttendanceCommand,
} from "@/features/academics/actions";
import {
  AttendanceFigure,
  AttendanceRiskBadge,
  RISK_META,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import type { AttendanceSummary } from "@/services/academics/attendance.calculator";
import type { SubjectAttendanceDto } from "@/types/academics";

export type ClassSessionEntry = {
  readonly id: string;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectCode: string | null;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly status: string;
  readonly attendanceStatus: string | null;
};

type AttendanceBoardProps = {
  readonly subjects: readonly SubjectAttendanceDto[];
  readonly sessions: readonly ClassSessionEntry[];
  readonly hasSubjects: boolean;
};

/**
 * The attendance surface.
 *
 * Three things, in the order a student actually wants them: where they stand,
 * what they can mark, and a what-if calculator for the question they are
 * really asking ("can I skip tomorrow?").
 */
export function AttendanceBoard({
  subjects,
  sessions,
  hasSubjects,
}: AttendanceBoardProps) {
  const [isPending, startTransition] = useTransition();

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    successMessage?: string,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't save that.");
        return;
      }

      if (successMessage) {
        toast.success(successMessage);
      }
    });
  };

  if (!hasSubjects) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          size="page"
          icon={UserCheck}
          title="Add subjects to track attendance"
          description="Attendance is recorded per subject, against real class occurrences."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Where you stand"
          icon={UserCheck}
          className="lg:col-span-2"
          footer="Excused classes are excluded from the percentage entirely — they neither help nor hurt."
        >
          {subjects.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {subjects.map((subject) => (
                <li key={subject.subjectId} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-meta font-medium">
                        {subject.subjectName}
                      </p>
                      <AttendanceFigure
                        percentage={subject.percentage}
                        thresholdPercent={subject.thresholdPercent}
                        className="text-label"
                      />
                    </div>

                    <AttendanceRiskBadge risk={subject.risk} />
                  </div>

                  <p className="mt-1.5 text-label text-muted-foreground">
                    {buildAdvice(subject)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={UserCheck}
              title="No subjects in this semester"
              description="Add subjects to begin tracking attendance."
              className="flex-1"
            />
          )}
        </SectionCard>

        <AttendanceCalculator />
      </div>

      <SectionCard
        title="Recent and upcoming classes"
        icon={CalendarPlus}
        description="Mark attendance against a real class, not a timetable slot."
      >
        {sessions.length > 0 ? (
          <ul className="divide-y divide-border-subtle">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-meta">
                    {session.subjectCode ?? session.subjectName}
                  </p>
                  <p className="text-label text-muted-foreground">
                    {session.dateLabel} · {session.timeLabel}
                    {session.status === "CANCELLED" ? " · Cancelled" : ""}
                  </p>
                </div>

                {session.status === "CANCELLED" ? (
                  <span className="text-label text-muted-foreground">
                    No attendance recorded
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <MarkButton
                      label="Present"
                      icon={Check}
                      isActive={session.attendanceStatus === "PRESENT"}
                      activeClass="bg-success/15 text-success"
                      disabled={isPending}
                      onClick={() =>
                        run(() =>
                          markAttendanceCommand({
                            classSessionId: session.id,
                            status: "PRESENT",
                          }),
                        )
                      }
                    />
                    <MarkButton
                      label="Absent"
                      icon={X}
                      isActive={session.attendanceStatus === "ABSENT"}
                      activeClass="bg-danger/15 text-danger"
                      disabled={isPending}
                      onClick={() =>
                        run(() =>
                          markAttendanceCommand({
                            classSessionId: session.id,
                            status: "ABSENT",
                          }),
                        )
                      }
                    />
                    <MarkButton
                      label="Excused"
                      icon={Minus}
                      isActive={session.attendanceStatus === "EXCUSED"}
                      activeClass="bg-muted text-foreground"
                      disabled={isPending}
                      onClick={() =>
                        run(() =>
                          markAttendanceCommand({
                            classSessionId: session.id,
                            status: "EXCUSED",
                          }),
                        )
                      }
                    />

                    {session.attendanceStatus ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() =>
                          run(() =>
                            clearAttendanceCommand({
                              classSessionId: session.id,
                            }),
                          )
                        }
                      >
                        Clear
                      </Button>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={CalendarPlus}
            title="No classes yet"
            description="Build a timetable and generate class occurrences to start marking attendance."
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  const today = new Date();
                  const from = today.toISOString().slice(0, 10);
                  const to = new Date(
                    today.getTime() + 60 * 24 * 60 * 60 * 1000,
                  )
                    .toISOString()
                    .slice(0, 10);

                  run(
                    () =>
                      generateSessionsCommand({
                        fromDate: from,
                        toDate: to,
                      }),
                    "Classes generated from your timetable.",
                  );
                }}
              >
                Generate from timetable
              </Button>
            }
            className="flex-1"
          />
        )}
      </SectionCard>
    </div>
  );
}

function MarkButton({
  label,
  icon: Icon,
  isActive,
  activeClass,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Check;
  isActive: boolean;
  activeClass: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      // Both a label and an icon, and `aria-pressed` for the current state —
      // the marking never depends on colour alone.
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(isActive && activeClass)}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}

/**
 * The what-if calculator.
 *
 * Calls the SAME server function the dashboards use, rather than duplicating
 * the arithmetic in the browser. A separate client-side formula would
 * eventually disagree with the real one, and the disagreement would be
 * invisible.
 */
function AttendanceCalculator() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<AttendanceSummary | null>(null);

  const [present, setPresent] = useState("41");
  const [absent, setAbsent] = useState("9");
  const [threshold, setThreshold] = useState("75");

  const calculate = () => {
    startTransition(async () => {
      const response = await calculateAttendanceCommand({
        present: Number(present) || 0,
        absent: Number(absent) || 0,
        excused: 0,
        thresholdPercent: Number(threshold) || 0,
      });

      if (response.status !== "success") {
        toast.error("Couldn't calculate that.");
        return;
      }

      setResult(response.data);
    });
  };

  return (
    <SectionCard title="Calculator" icon={UserCheck} description="What if?">
      <div className="space-y-3 px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-label text-muted-foreground">Attended</span>
            <Input
              type="number"
              min={0}
              value={present}
              onChange={(event) => setPresent(event.target.value)}
              className="h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-label text-muted-foreground">Missed</span>
            <Input
              type="number"
              min={0}
              value={absent}
              onChange={(event) => setAbsent(event.target.value)}
              className="h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-label text-muted-foreground">Required</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              className="h-8"
            />
          </label>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={calculate}
          disabled={isPending}
        >
          {isPending ? "Calculating…" : "Calculate"}
        </Button>

        {result ? (
          <div className="space-y-1.5 border-t border-border-subtle pt-3">
            <AttendanceFigure
              percentage={result.percentage}
              thresholdPercent={result.thresholdPercent}
            />
            <p className="text-meta">{buildAdviceFromSummary(result)}</p>
            <p className="text-label text-muted-foreground">
              {RISK_META[result.risk].description}
            </p>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function buildAdvice(subject: SubjectAttendanceDto): string {
  if (subject.percentage === null) {
    return "No classes marked yet.";
  }

  if (subject.percentage >= subject.thresholdPercent) {
    if (subject.canMiss === null || subject.canMiss === 0) {
      return `At the line — one more absence drops you below ${subject.thresholdPercent}%.`;
    }
    return `You can miss ${subject.canMiss} more ${subject.canMiss === 1 ? "class" : "classes"}.`;
  }

  if (subject.mustAttend === null) {
    return `${subject.thresholdPercent}% is no longer reachable.`;
  }

  return `Attend the next ${subject.mustAttend} ${subject.mustAttend === 1 ? "class" : "classes"} to reach ${subject.thresholdPercent}%.`;
}

function buildAdviceFromSummary(summary: AttendanceSummary): string {
  return buildAdvice({
    subjectId: "",
    subjectName: "",
    subjectCode: null,
    percentage: summary.percentage,
    thresholdPercent: summary.thresholdPercent,
    risk: summary.risk,
    canMiss: summary.canMiss,
    mustAttend: summary.mustAttend,
  });
}
