/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  DueIndicator,
  PRIORITY_META,
  PriorityIndicator,
  StatusIndicator,
  SubtaskProgress,
} from "@/features/tasks/components/task-badges";
import { TASK_PRIORITIES } from "@/services/task/task.schema";

/**
 * These components carry the promise that STATUS IS NEVER COMMUNICATED BY
 * COLOUR ALONE. That is an accessibility guarantee, so it is asserted here
 * rather than left to a visual review — a future restyle that drops an icon
 * or a label should fail the build.
 *
 * They are pure presentation with no server imports, which is what makes them
 * mountable in a unit test at all.
 */

afterEach(cleanup);

describe("PriorityIndicator", () => {
  test("every priority is announced in text, not just coloured", () => {
    for (const priority of TASK_PRIORITIES) {
      const { unmount } = render(<PriorityIndicator priority={priority} />);

      expect(
        screen.getByText(`${PRIORITY_META[priority].label} priority`),
      ).toBeDefined();

      unmount();
    }
  });

  test("every priority renders a distinct icon", () => {
    // Four priorities must map to four different glyphs; if two ever collide,
    // colour becomes the only differentiator.
    const icons = new Set(
      TASK_PRIORITIES.map((priority) => PRIORITY_META[priority].icon),
    );

    expect(icons.size).toBe(TASK_PRIORITIES.length);
  });

  test("shows a visible label when asked", () => {
    render(<PriorityIndicator priority="URGENT" showLabel />);

    expect(screen.getByText("Urgent")).toBeDefined();
  });
});

describe("DueIndicator", () => {
  test("renders nothing without a due date", () => {
    const { container } = render(
      <DueIndicator
        dueLabel={null}
        dueTimeLabel={null}
        overdueLabel={null}
        isOverdue={false}
      />,
    );

    expect(container.textContent).toBe("");
  });

  test("shows the date, and the time when there is one", () => {
    render(
      <DueIndicator
        dueLabel="Today"
        dueTimeLabel="17:30"
        overdueLabel={null}
        isOverdue={false}
      />,
    );

    expect(screen.getByText("Today, 17:30")).toBeDefined();
  });

  test("states how overdue a task is in words", () => {
    render(
      <DueIndicator
        dueLabel="Yesterday"
        dueTimeLabel={null}
        overdueLabel="2 days overdue"
        isOverdue
      />,
    );

    // The warning is words, not merely a red tint.
    expect(screen.getByText("2 days overdue")).toBeDefined();
  });

  test("falls back to a generic word if no overdue label was computed", () => {
    render(
      <DueIndicator
        dueLabel="Yesterday"
        dueTimeLabel={null}
        overdueLabel={null}
        isOverdue
      />,
    );

    expect(screen.getByText("Overdue")).toBeDefined();
  });
});

describe("StatusIndicator", () => {
  test("labels the statuses that change how a row reads", () => {
    const { unmount } = render(<StatusIndicator status="IN_PROGRESS" />);
    expect(screen.getByText("In progress")).toBeDefined();
    unmount();

    render(<StatusIndicator status="BLOCKED" />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });

  test("stays silent for ordinary statuses", () => {
    const { container } = render(<StatusIndicator status="TODO" />);
    expect(container.textContent).toBe("");
  });
});

describe("SubtaskProgress", () => {
  test("renders nothing when a task has no checklist", () => {
    const { container } = render(<SubtaskProgress completed={0} total={0} />);
    expect(container.textContent).toBe("");
  });

  test("shows the count and an accessible progressbar", () => {
    render(<SubtaskProgress completed={3} total={5} />);

    expect(screen.getByText("3/5")).toBeDefined();

    const bar = screen.getByRole("progressbar", {
      name: "3 of 5 subtasks complete",
    });

    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  test("reports 100 when everything is done", () => {
    render(<SubtaskProgress completed={4} total={4} />);

    expect(
      screen
        .getByRole("progressbar", { name: "4 of 4 subtasks complete" })
        .getAttribute("aria-valuenow"),
    ).toBe("100");
  });
});
