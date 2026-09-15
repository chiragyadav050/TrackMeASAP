"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Single-key navigation and capture shortcuts.
 *
 * THE HARD PART IS NOT FIRING WHILE SOMEBODY IS TYPING. A bare `c` shortcut
 * that hijacks the letter inside a text field is worse than no shortcut, so
 * every event is checked against the focused element first — inputs,
 * textareas, selects, anything `contenteditable`, and any modifier
 * combination (which belongs to the browser or the OS).
 *
 * ⌘K is deliberately absent: the command palette owns it (Phase 1) and two
 * listeners for one chord is how double-toggles happen.
 */

export type TaskShortcutHandlers = {
  /** `c` — capture a new task. */
  readonly onCreateTask?: () => void;
  /** `?` — show the shortcut reference. */
  readonly onShowHelp?: () => void;
};

/** True when the keystroke belongs to whatever the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;

  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useTaskShortcuts(handlers: TaskShortcutHandlers = {}): void {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      switch (event.key) {
        case "c":
          if (handlers.onCreateTask) {
            event.preventDefault();
            handlers.onCreateTask();
          }
          break;

        case "t":
          event.preventDefault();
          router.push("/today");
          break;

        case "g":
          event.preventDefault();
          router.push("/tasks");
          break;

        case "?":
          if (handlers.onShowHelp) {
            event.preventDefault();
            handlers.onShowHelp();
          }
          break;

        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers, router]);
}

/** The reference rendered by the shortcuts dialog and documented in the README. */
export const KEYBOARD_SHORTCUTS = [
  { keys: ["c"], description: "Capture a new task" },
  { keys: ["t"], description: "Go to Today" },
  { keys: ["g"], description: "Go to Tasks" },
  { keys: ["⌘", "K"], description: "Open the command palette" },
  { keys: ["⌘", "↵"], description: "Add details while capturing" },
  { keys: ["?"], description: "Show this reference" },
  { keys: ["Esc"], description: "Dismiss a dialog or clear capture" },
] as const;
