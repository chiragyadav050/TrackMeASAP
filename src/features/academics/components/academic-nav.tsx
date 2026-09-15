"use client";

import {
  CalendarDays,
  ClipboardList,
  FileText,
  GraduationCap,
  LayoutGrid,
  Library,
  Timer,
  UserCheck,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Section navigation WITHIN Academics.
 *
 * Deliberately not new sidebar entries: Academics is one product area, and
 * promoting eight sub-pages to the top level would bury the rest of Life OS.
 * A horizontal rail keeps the whole module one click away without competing
 * with the primary navigation.
 */

type AcademicSection = {
  readonly href: Route;
  readonly label: string;
  readonly icon: typeof LayoutGrid;
  /** Overview must match exactly, or every sub-page would highlight it too. */
  readonly exact?: boolean;
};

const ACADEMIC_SECTIONS: readonly AcademicSection[] = [
  { href: "/academics", label: "Overview", icon: LayoutGrid, exact: true },
  { href: "/academics/semesters", label: "Semester", icon: GraduationCap },
  { href: "/academics/subjects", label: "Subjects", icon: Library },
  { href: "/academics/assignments", label: "Assignments", icon: ClipboardList },
  { href: "/academics/exams", label: "Exams", icon: FileText },
  { href: "/academics/attendance", label: "Attendance", icon: UserCheck },
  { href: "/academics/study", label: "Study", icon: Timer },
  { href: "/academics/calendar", label: "Calendar", icon: CalendarDays },
];

export function AcademicNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Academics sections"
      // Scrolls horizontally on narrow screens rather than wrapping into a
      // stack that pushes the page content below the fold.
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border-subtle px-1 pb-2"
    >
      {ACADEMIC_SECTIONS.map((section) => {
        const Icon = section.icon;

        const isActive = section.exact
          ? pathname === section.href
          : pathname === section.href ||
            pathname.startsWith(`${section.href}/`);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-meta transition-colors",
              isActive
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
