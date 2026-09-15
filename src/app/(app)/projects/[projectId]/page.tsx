import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProjectDetail } from "@/features/work/components/project-detail";
import { requireProfileForPage } from "@/server/auth";
import {
  getProjectDetail,
  listWorkspacesWithCounts,
} from "@/services/work/work.query";

export const metadata: Metadata = {
  title: "Project",
};

/**
 * One project.
 *
 * `getProjectDetail` scopes on `profileId`, so another user's id resolves to
 * `null` and lands on the ordinary 404 — indistinguishable from an id that
 * never existed, which is the point.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const profile = await requireProfileForPage();
  const { projectId } = await params;

  const [detail, workspaces] = await Promise.all([
    getProjectDetail(profile, projectId),
    listWorkspacesWithCounts(profile, true),
  ]);

  if (!detail) {
    notFound();
  }

  return <ProjectDetail detail={detail} workspaces={workspaces} />;
}
