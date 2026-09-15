import type { Metadata } from "next";

import { StudyBoard } from "@/features/academics/components/study-board";
import { formatInTimeZone } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import {
  listStudySessions,
  getStudySummary,
} from "@/services/academics/study.service";
import {
  listSubjects,
  resolveActiveSemester,
} from "@/services/academics/semester.service";

export const metadata: Metadata = {
  title: "Study",
};

export default async function StudyPage() {
  const profile = await requireProfileForPage();
  const now = new Date();

  const active = await resolveActiveSemester(profile.id);

  const [summary, recent, subjects] = await Promise.all([
    getStudySummary(profile.id, profile.timeZone, now),
    listStudySessions(profile.id, { take: 12 }),
    listSubjects(profile.id, active ? { semesterId: active.id } : {}),
  ]);

  return (
    <StudyBoard
      view={{
        todayMinutes: summary.todayMinutes,
        weekMinutes: summary.weekMinutes,
        activeDays: summary.activeDays,
        bySubject: summary.bySubject,
        recent: recent.map((session) => ({
          id: session.id,
          subjectName: session.subject.name,
          topicTitle: session.topic?.title ?? null,
          dateLabel: formatInTimeZone(
            session.startedAt,
            profile.timeZone,
            { weekday: "short", day: "numeric", month: "short" },
            profile.locale,
          ),
          durationMinutes: session.durationMinutes,
          focusRating: session.focusRating,
        })),
        subjects: subjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          code: subject.code,
        })),
      }}
    />
  );
}
