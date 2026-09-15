import {
  Bell,
  BookOpen,
  CalendarDays,
  FileClock,
  GraduationCap,
  ListTodo,
  type LucideIcon,
} from "lucide-react";

import type { CalendarSource } from "@/types/schedule";

/**
 * Calendar source indicators.
 *
 * Same accessibility rule as every other badge set: MEANING NEVER RESTS ON
 * COLOUR. Each source carries an icon AND a written label, so a greyscale
 * screenshot still says whether a block is a class or a personal event.
 */
export const SOURCE_META: Readonly<
  Record<CalendarSource, { label: string; icon: LucideIcon; className: string }>
> = {
  EVENT: {
    label: "Event",
    icon: CalendarDays,
    className: "text-accent",
  },
  CLASS: {
    label: "Class",
    icon: BookOpen,
    className: "text-muted-foreground",
  },
  ASSIGNMENT: {
    label: "Assignment due",
    icon: FileClock,
    className: "text-warning",
  },
  EXAM: {
    label: "Exam",
    icon: GraduationCap,
    className: "text-danger",
  },
  TASK: {
    label: "Task due",
    icon: ListTodo,
    className: "text-muted-foreground",
  },
};

export const REMINDER_ICON: LucideIcon = Bell;

export const RECURRENCE_LABELS: Readonly<Record<string, string>> = {
  NONE: "Once",
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  YEARLY: "Every year",
  WEEKDAYS: "Chosen days",
};

export const NOTIFICATION_KIND_LABELS: Readonly<Record<string, string>> = {
  REMINDER: "Reminder",
  DEADLINE: "Deadline",
  ATTENDANCE: "Attendance",
  HABIT: "Habit",
  PROJECT: "Project",
  FINANCE: "Finance",
  SYSTEM: "System",
  PROACTIVE: "Life OS noticed",
};
