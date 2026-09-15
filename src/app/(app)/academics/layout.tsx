import type { ReactNode } from "react";

import { PageHeader } from "@/components/common/page-header";
import { AcademicNav } from "@/features/academics/components/academic-nav";

/**
 * The Academics shell.
 *
 * Holds the section navigation so every academic page shares it without
 * re-rendering it, and so the module reads as one product area rather than
 * eight loosely related pages.
 */
export default function AcademicsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Academics"
        description="Your semester, subjects, attendance, deadlines and exam preparation."
      />

      <AcademicNav />

      {children}
    </div>
  );
}
