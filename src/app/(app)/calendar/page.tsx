import type { Metadata } from "next";

import { CalendarBoard } from "@/features/schedule/components/calendar-board";
import { localDateKey } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import {
  getCalendarView,
  listReminders,
} from "@/services/schedule/calendar.query";
import { calendarRangeSchema } from "@/services/schedule/schedule.schema";

export const metadata: Metadata = {
  title: "Calendar",
};

/**
 * The unified timeline.
 *
 * View and anchor date arrive as search params and are parsed with the SAME
 * Zod schema the actions use, so a hand-edited URL falls back to defaults
 * rather than reaching the query layer unvalidated.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  const now = new Date();
  const todayKey = localDateKey(now, profile.timeZone);

  const parsed = calendarRangeSchema.safeParse({
    date: params.date,
    view: params.view,
  });

  const range = parsed.success ? parsed.data : calendarRangeSchema.parse({});
  const anchorKey = range.date ?? todayKey;

  const [view, reminders] = await Promise.all([
    getCalendarView(profile, anchorKey, range.view, now),
    listReminders(profile, {}, now),
  ]);

  return (
    <CalendarBoard view={view} reminders={reminders} todayKey={todayKey} />
  );
}
