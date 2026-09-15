import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { TodayWorkspace } from "@/features/today/today-workspace";
import { requireProfileForPage } from "@/server/auth";
import { getTodayAcademics } from "@/services/academics/academic.query";
import { getTodayView } from "@/services/task/task.query";
import { getProjectsSummary } from "@/services/work/work.query";
import { getLifeSummary } from "@/services/life/life.query";

export const metadata: Metadata = {
  title: "Today",
};

/**
 * The daily command center.
 *
 * Answers one question: what should I be doing today?
 *
 * Everything — the greeting, the date, which tasks count as "today", what is
 * overdue — is resolved in the PROFILE's time zone by `getTodayView`, never
 * the server's. That is what makes the page correct for a user in Kolkata
 * running on a UTC host.
 */
export default async function TodayPage() {
  const profile = await requireProfileForPage();

  // Both slices in parallel — the academic queries are narrow and indexed, so
  // adding them must not double the page's latency.
  const [view, academics, work, life] = await Promise.all([
    getTodayView(profile),
    getTodayAcademics(profile),
    getProjectsSummary(profile),
    getLifeSummary(profile),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={view.dateLabel}
        title={`${view.greeting}, ${profile.displayName}.`}
        description={buildSummary(view.statistics)}
      />

      <TodayWorkspace
        view={view}
        academics={academics}
        work={work}
        life={life}
      />
    </div>
  );
}

/** One honest sentence about the state of the day. */
function buildSummary(statistics: {
  dueTodayTotal: number;
  completedToday: number;
  overdueCount: number;
  activeCount: number;
}): string {
  if (statistics.activeCount === 0) {
    return "Nothing on your plate. Capture something below when it comes up.";
  }

  const parts: string[] = [];

  if (statistics.dueTodayTotal > 0) {
    parts.push(
      `${statistics.completedToday} of ${statistics.dueTodayTotal} due today done`,
    );
  } else if (statistics.completedToday > 0) {
    parts.push(`${statistics.completedToday} completed today`);
  }

  if (statistics.overdueCount > 0) {
    parts.push(`${statistics.overdueCount} overdue`);
  }

  if (parts.length === 0) {
    return `${statistics.activeCount} active ${
      statistics.activeCount === 1 ? "task" : "tasks"
    }, nothing due today.`;
  }

  return `${parts.join(" · ")}.`;
}
