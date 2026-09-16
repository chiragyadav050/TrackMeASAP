/**
 * The first-run tour, as data.
 *
 * Separated from the component so the copy can be read and changed without
 * touching focus management or positioning logic — and so a step that points
 * at something which no longer exists is a one-line fix.
 *
 * Each step names a `target` that must appear as `data-tour="<target>"` in the
 * DOM. A step whose target is missing is SKIPPED rather than rendered against
 * nothing: the sidebar is hidden below `lg`, so on a phone several of these
 * genuinely are not on screen.
 */

export type TourStep = {
  /** Matches a `data-tour` attribute. */
  readonly target: string;
  readonly title: string;
  readonly body: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: "today",
    title: "Start here each morning",
    body: "Today is the one screen that answers 'what now'. Tasks due, classes, reminders — in the order they happen.",
  },
  {
    target: "quick-capture",
    title: "Capture without thinking",
    body: "Type a task and press Enter. No form, no category. Sort it out later — the point is to get it out of your head.",
  },
  {
    target: "academics",
    title: "Coursework lives here",
    body: "Subjects, attendance, assignments and exams. Attendance tells you how many classes you can still miss, not just a percentage.",
  },
  {
    target: "ai",
    title: "Ask instead of clicking",
    body: '"What\'s due this week?" or "add a Physics exam on Friday". It reads your real data and will tell you plainly when it cannot do something.',
  },
  {
    target: "command-palette",
    title: "Jump anywhere",
    body: "Press ⌘K — or Ctrl+K — to search everything and move between screens without touching the sidebar.",
  },
];
