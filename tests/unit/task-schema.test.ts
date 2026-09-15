import { describe, expect, test } from "vitest";

import {
  bulkTaskActionSchema,
  createTaskSchema,
  MAX_BULK_TASKS,
  quickCreateTaskSchema,
  rescheduleTaskSchema,
  taskFiltersSchema,
  TITLE_MAX,
  updateTaskSchema,
} from "@/services/task/task.schema";

function issuePaths(
  schema: { safeParse: (v: unknown) => unknown },
  input: unknown,
) {
  const result = schema.safeParse(input) as
    | { success: true }
    | { success: false; error: { issues: { path: (string | number)[] }[] } };

  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("createTaskSchema", () => {
  test("accepts a title alone and applies defaults", () => {
    const result = createTaskSchema.safeParse({ title: "Finish DBMS report" });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.priority).toBe("MEDIUM");
      expect(result.data.category).toBe("PERSONAL");
      expect(result.data.energy).toBe("MEDIUM");
      expect(result.data.dueDate).toBeUndefined();
    }
  });

  test("requires a title", () => {
    expect(issuePaths(createTaskSchema, { title: "   " })).toContain("title");
    expect(issuePaths(createTaskSchema, {})).toContain("title");
  });

  test("trims the title and rejects an oversized one", () => {
    const result = createTaskSchema.safeParse({ title: "  Submit form  " });
    expect(result.success && result.data.title).toBe("Submit form");

    expect(
      issuePaths(createTaskSchema, { title: "a".repeat(TITLE_MAX + 1) }),
    ).toContain("title");
  });

  test("normalises an emptied optional field to undefined, not an empty string", () => {
    const result = createTaskSchema.safeParse({
      title: "Task",
      description: "   ",
      notes: "",
    });

    expect(result.success).toBe(true);

    if (result.success) {
      // Stored as NULL rather than "", so "has a description" stays truthful.
      expect(result.data.description).toBeUndefined();
      expect(result.data.notes).toBeUndefined();
    }
  });

  test("coerces an estimate submitted as a string and bounds it", () => {
    const result = createTaskSchema.safeParse({
      title: "Task",
      estimatedMinutes: "45",
    });

    expect(result.success && result.data.estimatedMinutes).toBe(45);

    expect(
      issuePaths(createTaskSchema, { title: "T", estimatedMinutes: 0 }),
    ).toContain("estimatedMinutes");
    expect(
      issuePaths(createTaskSchema, { title: "T", estimatedMinutes: 1441 }),
    ).toContain("estimatedMinutes");
  });

  test("accepts a local date, and a date with a time", () => {
    expect(
      createTaskSchema.safeParse({ title: "T", dueDate: "2026-09-15" }).success,
    ).toBe(true);

    expect(
      createTaskSchema.safeParse({
        title: "T",
        dueDate: "2026-09-15",
        dueTime: "17:30",
      }).success,
    ).toBe(true);
  });

  test("rejects a time without a date", () => {
    expect(
      issuePaths(createTaskSchema, { title: "T", dueTime: "17:30" }),
    ).toContain("dueDate");
  });

  test("rejects malformed and non-existent dates", () => {
    for (const dueDate of ["15-09-2026", "2026-9-15", "not-a-date"]) {
      expect(issuePaths(createTaskSchema, { title: "T", dueDate })).toContain(
        "dueDate",
      );
    }

    // 2026 is not a leap year, so 29 February does not exist.
    expect(
      issuePaths(createTaskSchema, { title: "T", dueDate: "2026-02-29" }),
    ).toContain("dueDate");
  });

  test("rejects an invalid clock time", () => {
    for (const dueTime of ["24:00", "12:60", "9:30", "noon"]) {
      expect(
        issuePaths(createTaskSchema, {
          title: "T",
          dueDate: "2026-09-15",
          dueTime,
        }),
      ).toContain("dueTime");
    }
  });

  test("rejects unknown enum values", () => {
    expect(
      issuePaths(createTaskSchema, { title: "T", priority: "CRITICAL" }),
    ).toContain("priority");
    expect(
      issuePaths(createTaskSchema, { title: "T", category: "SHOPPING" }),
    ).toContain("category");
    expect(
      issuePaths(createTaskSchema, { title: "T", energy: "EXTREME" }),
    ).toContain("energy");
  });
});

describe("quickCreateTaskSchema", () => {
  test("accepts a bare title", () => {
    expect(quickCreateTaskSchema.safeParse({ title: "Buy milk" }).success).toBe(
      true,
    );
  });

  test("rejects an empty capture", () => {
    expect(quickCreateTaskSchema.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  test("requires a task id", () => {
    expect(issuePaths(updateTaskSchema, { title: "New" })).toContain("taskId");
  });

  test("allows a partial update", () => {
    expect(
      updateTaskSchema.safeParse({ taskId: "t1", priority: "HIGH" }).success,
    ).toBe(true);
  });

  test("supports explicitly clearing the due date", () => {
    const result = updateTaskSchema.safeParse({ taskId: "t1", clearDue: true });

    expect(result.success && result.data.clearDue).toBe(true);
  });
});

describe("rescheduleTaskSchema", () => {
  test("accepts a preset", () => {
    expect(
      rescheduleTaskSchema.safeParse({ taskId: "t1", preset: "TOMORROW" })
        .success,
    ).toBe(true);
  });

  test("accepts a specific date", () => {
    expect(
      rescheduleTaskSchema.safeParse({ taskId: "t1", dueDate: "2026-09-20" })
        .success,
    ).toBe(true);
  });

  test("rejects both a preset and a date, and rejects neither", () => {
    expect(
      rescheduleTaskSchema.safeParse({
        taskId: "t1",
        preset: "TODAY",
        dueDate: "2026-09-20",
      }).success,
    ).toBe(false);

    expect(rescheduleTaskSchema.safeParse({ taskId: "t1" }).success).toBe(
      false,
    );
  });

  test("rejects an unknown preset", () => {
    expect(
      rescheduleTaskSchema.safeParse({ taskId: "t1", preset: "SOMEDAY" })
        .success,
    ).toBe(false);
  });
});

describe("bulkTaskActionSchema", () => {
  test("accepts each supported action", () => {
    expect(
      bulkTaskActionSchema.safeParse({ action: "COMPLETE", taskIds: ["a"] })
        .success,
    ).toBe(true);

    expect(
      bulkTaskActionSchema.safeParse({
        action: "SET_PRIORITY",
        taskIds: ["a"],
        priority: "HIGH",
      }).success,
    ).toBe(true);

    expect(
      bulkTaskActionSchema.safeParse({
        action: "RESCHEDULE",
        taskIds: ["a"],
        preset: "NEXT_WEEK",
      }).success,
    ).toBe(true);
  });

  test("requires the discriminant's own fields", () => {
    // SET_PRIORITY without a priority must not fall through as a no-op.
    expect(
      bulkTaskActionSchema.safeParse({ action: "SET_PRIORITY", taskIds: ["a"] })
        .success,
    ).toBe(false);
  });

  test("requires at least one id and bounds the batch", () => {
    expect(
      bulkTaskActionSchema.safeParse({ action: "ARCHIVE", taskIds: [] })
        .success,
    ).toBe(false);

    // An unbounded batch would turn one request into an unbounded write.
    expect(
      bulkTaskActionSchema.safeParse({
        action: "ARCHIVE",
        taskIds: Array.from({ length: MAX_BULK_TASKS + 1 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("taskFiltersSchema", () => {
  test("defaults to the active, smart-sorted view", () => {
    const result = taskFiltersSchema.safeParse({});

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.status).toBe("ACTIVE");
      expect(result.data.date).toBe("ANY");
      expect(result.data.sort).toBe("SMART");
    }
  });

  test("rejects unknown filter and sort values", () => {
    expect(taskFiltersSchema.safeParse({ status: "SOMEDAY" }).success).toBe(
      false,
    );
    expect(taskFiltersSchema.safeParse({ sort: "RANDOM" }).success).toBe(false);
    expect(taskFiltersSchema.safeParse({ date: "LAST_YEAR" }).success).toBe(
      false,
    );
  });

  test("trims a search term and bounds its length", () => {
    const result = taskFiltersSchema.safeParse({ search: "  dbms  " });
    expect(result.success && result.data.search).toBe("dbms");

    expect(
      taskFiltersSchema.safeParse({ search: "a".repeat(201) }).success,
    ).toBe(false);
  });
});
