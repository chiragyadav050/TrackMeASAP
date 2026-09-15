import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ExamDetail } from "@/features/academics/components/exam-detail";
import { requireProfileForPage } from "@/server/auth";
import { getExamDetail } from "@/services/academics/academic.query";

export const metadata: Metadata = {
  title: "Exam",
};

export default async function ExamPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const profile = await requireProfileForPage();
  const { examId } = await params;

  // Scoped by profile inside the query — a foreign id 404s rather than
  // confirming it exists.
  const detail = await getExamDetail(profile, examId);

  if (!detail) {
    notFound();
  }

  return <ExamDetail exam={detail.exam} topics={detail.topics} />;
}
