/**
 * The delivery roadmap, as data.
 *
 * Placeholder surfaces read from here so that "coming in Phase N" copy is
 * accurate everywhere and updating the plan is a one-line change. Mirrors
 * docs/ROADMAP.md.
 */

export type PhaseId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Phase = {
  readonly id: PhaseId;
  readonly name: string;
  readonly summary: string;
};

export const PHASES: readonly Phase[] = [
  {
    id: 1,
    name: "Foundation",
    summary:
      "App shell, authentication, database, design system, theming and command palette.",
  },
  {
    id: 2,
    name: "Tasks + Today",
    summary:
      "Task capture, scheduling and the daily Today view that drives the day.",
  },
  {
    id: 3,
    name: "Academics",
    summary:
      "Subjects, assignments, exams, tests and attendance tracking for college.",
  },
  {
    id: 4,
    name: "Work + Projects",
    summary: "Project workspaces, milestones and work tracking.",
  },
  {
    id: 5,
    name: "Habits + Goals + Life",
    summary: "Habit streaks, goal trees, health basics and weekend planning.",
  },
  {
    id: 6,
    name: "Reminders + Calendar",
    summary: "A unified calendar and a reliable reminder engine.",
  },
  {
    id: 7,
    name: "Telegram",
    summary: "Capture and review from anywhere via a Telegram bot.",
  },
  {
    id: 8,
    name: "Gemini AI Agent",
    summary:
      "An AI assistant with tool calling, structured outputs and long-term memory.",
  },
  {
    id: 9,
    name: "AI Planning",
    summary: "Automated day, week and revision planning built from your data.",
  },
  {
    id: 10,
    name: "Proactive Life Intelligence",
    summary:
      "Life OS notices drift, risk and opportunity before you have to ask.",
  },
] as const;

const PHASE_BY_ID = new Map<PhaseId, Phase>(
  PHASES.map((phase) => [phase.id, phase]),
);

/**
 * The highest phase that has shipped.
 *
 * Read by the sidebar footer and by the command palette, which greys out any
 * surface whose phase exceeds it. With all ten shipped, nothing is greyed.
 */
export const CURRENT_PHASE: PhaseId = 10;

export function getPhase(id: PhaseId): Phase {
  const phase = PHASE_BY_ID.get(id);

  if (!phase) {
    // Unreachable for valid PhaseId values; guards against a future edit that
    // adds an id to the union without adding it to PHASES.
    throw new Error(`Unknown phase id: ${id}`);
  }

  return phase;
}

/** Human-readable label used by placeholder surfaces, e.g. "Phase 3 — Academics". */
export function phaseLabel(id: PhaseId): string {
  const phase = getPhase(id);
  return `Phase ${phase.id} — ${phase.name}`;
}
