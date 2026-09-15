import type { Metadata } from "next";

import { AttendanceBoard } from "@/features/academics/components/attendance-board";
import { formatInTimeZone, startOfLocalDayOffset } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import { getSemesterAttendance } from "@/services/academics/attendance.service";
import { resolveActiveSemester } from "@/services/academics/semester.service";
import { listClassSessions } from "@/services/academics/timetable.service";

export const metadata: Metadata = {
  title: "Attendance",
};

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;
  const now = new Date();

  const subjectFilter =
    typeof params.subject === "string" ? params.subject : undefined;

  const active = await resolveActiveSemester(profile.id);

  if (!active) {
    return <AttendanceBoard subjects={[]} sessions={[]} hasSubjects={false} />;
  }

  // A fortnight either side of today — enough to mark what was missed and
  // plan ahead, without loading a semester of rows into the page.
  const [attendance, sessions] = await Promise.all([
    getSemesterAttendance(profile.id, active.id, now),
    listClassSessions(profile.id, {
      semesterId: active.id,
      subjectId: subjectFilter,
      from: startOfLocalDayOffset(now, profile.timeZone, -14),
      to: startOfLocalDayOffset(now, profile.timeZone, 14),
      take: 100,
    }),
  ]);

  return (
    <AttendanceBoard
      hasSubjects={attendance.length > 0}
      subjects={attendance.map((entry) => ({
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        subjectCode: entry.subjectCode,
        percentage: entry.summary.percentage,
        thresholdPercent: entry.summary.thresholdPercent,
        risk: entry.summary.risk,
        canMiss: entry.summary.canMiss,
        mustAttend: entry.summary.mustAttend,
      }))}
      sessions={sessions.map((session) => ({
        id: session.id,
        subjectId: session.subject.id,
        subjectName: session.subject.name,
        subjectCode: session.subject.code,
        // Labels are produced here, in the profile's zone — the client never
        // formats a date.
        dateLabel: formatInTimeZone(
          session.startAt,
          profile.timeZone,
          { weekday: "short", day: "numeric", month: "short" },
          profile.locale,
        ),
        timeLabel: formatInTimeZone(
          session.startAt,
          profile.timeZone,
          { hour: "numeric", minute: "2-digit" },
          profile.locale,
        ),
        status: session.status,
        attendanceStatus: session.attendance?.status ?? null,
      }))}
    />
  );
}
