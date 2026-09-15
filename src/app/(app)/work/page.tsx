import type { Metadata } from "next";

import { WorkOverview } from "@/features/work/components/work-overview";
import { requireProfileForPage } from "@/server/auth";
import { getWorkOverview } from "@/services/work/work.query";

export const metadata: Metadata = {
  title: "Work",
};

/**
 * "What is going on with my work?"
 *
 * A Server Component: one assembled query, no client-side fetching, and every
 * date resolved in the profile's zone before it reaches the browser.
 */
export default async function WorkPage() {
  const profile = await requireProfileForPage();
  const view = await getWorkOverview(profile);

  return <WorkOverview view={view} />;
}
