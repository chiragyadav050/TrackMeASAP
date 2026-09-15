import type { Metadata } from "next";

import { InsightsBoard } from "@/features/intelligence/components/insights-board";
import { requireProfileForPage } from "@/server/auth";
import { buildIntelligenceReport } from "@/services/intelligence/intelligence.query";

export const metadata: Metadata = {
  title: "Insights",
};

/**
 * What Life OS has noticed.
 *
 * Computed, not generated — this page works identically with or without an AI
 * provider, and every claim it makes is shown alongside the numbers it came
 * from.
 */
export default async function InsightsPage() {
  const profile = await requireProfileForPage();
  const report = await buildIntelligenceReport(profile);

  return <InsightsBoard report={report} />;
}
