import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { OverviewGrid } from "@/features/overview/overview-grid";
import { requireProfileForPage } from "@/server/auth";
import { getAcademicOverview } from "@/services/academics/academic.query";
import { getTodayView } from "@/services/task/task.query";
import { getProjectsSummary } from "@/services/work/work.query";
import { getLifeSummary } from "@/services/life/life.query";
import { getMoneySummary } from "@/services/life/money.query";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function OverviewPage() {
  const profile = await requireProfileForPage();

  // The same assembled views the Today and Academics pages use, so the three
  // surfaces can never disagree about what "today" means.
  const [view, academics, work, life, money] = await Promise.all([
    getTodayView(profile),
    getAcademicOverview(profile),
    getProjectsSummary(profile),
    getLifeSummary(profile),
    getMoneySummary(profile),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={view.dateLabel}
        title={`${view.greeting}, ${profile.displayName}.`}
        description="Everything Life OS knows about your day, in one place. Modules light up as each phase ships."
      />

      <OverviewGrid
        view={view}
        academics={academics}
        work={work}
        life={life}
        money={money}
      />
    </div>
  );
}
