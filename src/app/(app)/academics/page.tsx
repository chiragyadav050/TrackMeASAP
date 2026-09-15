import type { Metadata } from "next";

import { AcademicOverview } from "@/features/academics/components/academic-overview";
import { requireProfileForPage } from "@/server/auth";
import { getAcademicOverview } from "@/services/academics/academic.query";

export const metadata: Metadata = {
  title: "Academics",
};

/**
 * "How is my semester going?"
 *
 * A Server Component: one assembled query, no client-side fetching, and every
 * date resolved in the profile's zone before it reaches the browser.
 */
export default async function AcademicsPage() {
  const profile = await requireProfileForPage();
  const view = await getAcademicOverview(profile);

  return <AcademicOverview view={view} />;
}
