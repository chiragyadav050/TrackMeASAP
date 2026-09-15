import type { Metadata } from "next";

import {
  AcademicCalendar,
  type AcademicEvent,
} from "@/features/academics/components/academic-calendar";
import {
  formatInTimeZone,
  formatMinutesAsTime,
  localDateKey,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import { db } from "@/server/db";
import { resolveActiveSemester } from "@/services/academics/semester.service";
import {
  listClassSessions,
  listSchedules,
} from "@/services/academics/timetable.service";

export const metadata: Metadata = {
  title: "Academic calendar",
};

/**
 * The internal academic calendar.
 *
 * Classes, assignment deadlines, assessments and exams are queried separately
 * — they are genuinely different entities with different rules — and unified
 * only for display, each row keeping a link back to its source record.
 *
 * No external calendar integration: Google Calendar arrives in Phase 6.
 */
export default async function AcademicCalendarPage() {
  const profile = await requireProfileForPage();
  const now = new Date();
  const { timeZone, locale } = profile;

  const from = startOfLocalDay(now, timeZone);
  const to = startOfLocalDayOffset(now, timeZone, 21);

  const active = await resolveActiveSemester(profile.id);

  if (!active) {
    return <AcademicCalendar events={[]} timetable={[]} />;
  }

  const [classes, assignments, assessments, exams, schedules] =
    await Promise.all([
      listClassSessions(profile.id, {
        semesterId: active.id,
        from,
        to,
        take: 150,
      }),
      db.assignment.findMany({
        where: {
          profileId: profile.id,
          archivedAt: null,
          status: { not: "CANCELLED" },
          dueAt: { gte: from, lt: to },
        },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: { dueAt: "asc" },
      }),
      db.assessment.findMany({
        where: {
          profileId: profile.id,
          status: { not: "CANCELLED" },
          scheduledAt: { gte: from, lt: to },
        },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: { scheduledAt: "asc" },
      }),
      db.exam.findMany({
        where: {
          profileId: profile.id,
          status: { not: "CANCELLED" },
          startAt: { gte: from, lt: to },
        },
        include: { subject: { select: { name: true, code: true } } },
        orderBy: { startAt: "asc" },
      }),
      listSchedules(profile.id, { semesterId: active.id }),
    ]);

  const dayLabel = (date: Date) =>
    formatInTimeZone(
      date,
      timeZone,
      { weekday: "long", day: "numeric", month: "long" },
      locale,
    );

  const timeLabel = (date: Date) =>
    formatInTimeZone(
      date,
      timeZone,
      { hour: "numeric", minute: "2-digit" },
      locale,
    );

  const events: AcademicEvent[] = [
    ...classes.map((session) => ({
      id: session.id,
      kind: "CLASS" as const,
      title: session.subject.name,
      subtitle: session.room,
      dayKey: localDateKey(session.startAt, timeZone),
      dayLabel: dayLabel(session.startAt),
      timeLabel: timeLabel(session.startAt),
      href: `/academics/subjects/${session.subjectId}`,
      isPast: session.startAt.getTime() < now.getTime(),
      isCancelled: session.status === "CANCELLED",
    })),

    ...assignments.map((assignment) => ({
      id: assignment.id,
      kind: "ASSIGNMENT" as const,
      title: assignment.title,
      subtitle: assignment.subject.code ?? assignment.subject.name,
      dayKey: localDateKey(assignment.dueAt!, timeZone),
      dayLabel: dayLabel(assignment.dueAt!),
      // All-day deadlines have no meaningful clock time to show.
      timeLabel: assignment.isAllDay ? null : timeLabel(assignment.dueAt!),
      href: "/academics/assignments",
      isPast: assignment.dueAt!.getTime() < now.getTime(),
      isCancelled: false,
    })),

    ...assessments.map((assessment) => ({
      id: assessment.id,
      kind: "ASSESSMENT" as const,
      title: assessment.title,
      subtitle: assessment.subject.code ?? assessment.subject.name,
      dayKey: localDateKey(assessment.scheduledAt!, timeZone),
      dayLabel: dayLabel(assessment.scheduledAt!),
      timeLabel: timeLabel(assessment.scheduledAt!),
      href: null,
      isPast: assessment.scheduledAt!.getTime() < now.getTime(),
      isCancelled: false,
    })),

    ...exams.map((exam) => ({
      id: exam.id,
      kind: "EXAM" as const,
      title: exam.title,
      subtitle: exam.subject?.code ?? exam.subject?.name ?? null,
      dayKey: localDateKey(exam.startAt!, timeZone),
      dayLabel: dayLabel(exam.startAt!),
      timeLabel: timeLabel(exam.startAt!),
      href: `/academics/exams/${exam.id}`,
      isPast: exam.startAt!.getTime() < now.getTime(),
      isCancelled: false,
    })),
  ].sort((a, b) => a.dayKey.localeCompare(b.dayKey));

  return (
    <AcademicCalendar
      events={events}
      timetable={schedules.map((schedule) => ({
        id: schedule.id,
        dayOfWeek: schedule.dayOfWeek,
        subjectName: schedule.subject.name,
        subjectCode: schedule.subject.code,
        timeLabel: `${formatMinutesAsTime(schedule.startMinute)}–${formatMinutesAsTime(schedule.endMinute)}`,
        room: schedule.room,
        sessionType: schedule.sessionType,
      }))}
    />
  );
}
