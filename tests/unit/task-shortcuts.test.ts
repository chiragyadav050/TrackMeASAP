/**
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";

import {
  KEYBOARD_SHORTCUTS,
  isTypingTarget,
} from "@/features/tasks/use-task-shortcuts";

/**
 * The single-key shortcuts are only safe because of `isTypingTarget`. A bare
 * `c` that fires while the user is writing a task title is worse than having
 * no shortcut at all, so the guard is tested directly rather than left to an
 * E2E run to discover.
 */

function element(tag: string, attributes: Record<string, string> = {}) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  return node;
}

describe("isTypingTarget", () => {
  test("treats form fields as typing targets", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isTypingTarget(element(tag)), tag).toBe(true);
    }
  });

  test("treats contenteditable as a typing target", () => {
    const node = element("div");
    node.contentEditable = "true";

    // jsdom does not implement isContentEditable from the attribute alone,
    // so it is set explicitly to mirror what a real browser reports.
    Object.defineProperty(node, "isContentEditable", { value: true });

    expect(isTypingTarget(node)).toBe(true);
  });

  test("does not treat ordinary elements as typing targets", () => {
    for (const tag of ["div", "button", "a", "li", "span"]) {
      expect(isTypingTarget(element(tag)), tag).toBe(false);
    }
  });

  test("handles a null or non-element target", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document)).toBe(false);
  });
});

describe("KEYBOARD_SHORTCUTS", () => {
  test("documents every shortcut the hook implements", () => {
    const documented = KEYBOARD_SHORTCUTS.flatMap((shortcut) => shortcut.keys);

    for (const key of ["c", "t", "g", "?"]) {
      expect(documented, key).toContain(key);
    }
  });

  test("has a description for each entry", () => {
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcut.description.length).toBeGreaterThan(0);
      expect(shortcut.keys.length).toBeGreaterThan(0);
    }
  });

  test("does not claim a shortcut twice", () => {
    const combos = KEYBOARD_SHORTCUTS.map((shortcut) =>
      shortcut.keys.join("+"),
    );

    expect(new Set(combos).size).toBe(combos.length);
  });
});
