import {
  Activity,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  Compass,
  FolderKanban,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  Settings,
  Sparkles,
  Sun,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Route } from "next";

import type { PhaseId } from "@/config/phases";

/**
 * The single source of truth for application navigation.
 *
 * The sidebar, the mobile navigation, the breadcrumb trail and the command
 * palette all derive from this list, so adding a surface in a future phase is
 * a one-entry change rather than four parallel edits.
 *
 * Note on Server/Client boundaries: `icon` holds a component reference, which
 * cannot be serialised across the RSC boundary. Client components must import
 * this module directly instead of receiving nav items as props.
 */

export type NavItem = {
  readonly href: Route;
  readonly label: string;
  /** One line explaining what the surface is for. Used by placeholders. */
  readonly description: string;
  readonly icon: LucideIcon;
  /** The roadmap phase that makes this surface functional. */
  readonly phase: PhaseId;
};

export type NavGroup = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "command",
    label: "Command",
    items: [
      {
        href: "/overview",
        label: "Overview",
        description:
          "The single screen that tells you where your life stands right now.",
        icon: LayoutDashboard,
        phase: 1,
      },
      {
        href: "/today",
        label: "Today",
        description:
          "A focused, time-aware plan for the next few hours — not an endless list.",
        icon: Sun,
        phase: 2,
      },
      {
        href: "/plan",
        label: "Plan",
        description:
          "A schedule built from your real calendar and your real tasks.",
        icon: CalendarCheck,
        phase: 9,
      },
      {
        href: "/calendar",
        label: "Calendar",
        description:
          "Classes, deadlines, work blocks and reminders on one timeline.",
        icon: CalendarDays,
        phase: 6,
      },
    ],
  },
  {
    id: "execution",
    label: "Execution",
    items: [
      {
        href: "/tasks",
        label: "Tasks",
        description:
          "Capture anything in a second, then let Life OS decide when it happens.",
        icon: ListTodo,
        phase: 2,
      },
      {
        href: "/academics",
        label: "Academics",
        description:
          "Subjects, assignments, exams, tests and attendance in one place.",
        icon: GraduationCap,
        phase: 3,
      },
      {
        href: "/work",
        label: "Work",
        description: "Track work commitments alongside everything else.",
        icon: Briefcase,
        phase: 4,
      },
      {
        href: "/projects",
        label: "Projects",
        description:
          "Long-running efforts with milestones, notes and real momentum.",
        icon: FolderKanban,
        phase: 4,
      },
    ],
  },
  {
    id: "life",
    label: "Life",
    items: [
      {
        href: "/goals",
        label: "Goals",
        description: "The outcomes everything else is for.",
        icon: Target,
        phase: 5,
      },
      {
        href: "/habits",
        label: "Habits",
        description: "The small repeated things that compound over a semester.",
        icon: Activity,
        phase: 5,
      },
      {
        href: "/health",
        label: "Health",
        description:
          "Sleep, movement and energy — the inputs to everything else.",
        icon: HeartPulse,
        phase: 5,
      },
      {
        href: "/finance",
        label: "Finance",
        description: "Where the money goes, without a spreadsheet.",
        icon: Wallet,
        phase: 5,
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        href: "/insights",
        label: "Insights",
        description:
          "What Life OS has noticed, with the numbers behind each observation.",
        icon: Lightbulb,
        phase: 10,
      },
      {
        href: "/ai",
        label: "AI",
        description:
          "An assistant with context on your actual calendar, coursework and goals.",
        icon: Sparkles,
        phase: 8,
      },
      {
        href: "/settings",
        label: "Settings",
        description: "Profile, schedule preferences and appearance.",
        icon: Settings,
        phase: 1,
      },
    ],
  },
] as const;

/** Flat view of every navigable surface, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

/** Icon used for breadcrumb roots and the app mark. */
export const APP_ICON: LucideIcon = Compass;

/**
 * Resolves the nav item that owns a pathname. Matches the longest `href`
 * prefix so future nested routes (e.g. `/academics/subjects/123`) still
 * highlight and label correctly.
 */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

export function isNavItemActive(pathname: string, item: NavItem): boolean {
  return findNavItem(pathname)?.href === item.href;
}
