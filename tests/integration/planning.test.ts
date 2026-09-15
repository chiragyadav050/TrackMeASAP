import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  buildPlanForDay,
  buildWeekendPlan,
  getExamMode,
  getProcrastinationSignals,
  getRecoveryPlan,
  getWeeklyReview,
} from "@/services/planning/planning.query";
import { createEvent } from "@/services/schedule/calendar.service";
import { createTask, rescheduleTask } from "@/services/task/task.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Planning against a real database.
 *
 * The scheduling arithmetic is unit-tested in `planning-derive.test.ts`; these
 * tests prove the query layer feeds it real free time, real tasks and real
 * reschedule history — and that the whole surface works with NO MODEL
 * CONFIGURED, which is the point of building it this way.
 */

let profile: Profile;
let other: Profile;

/** 2026-09-15, 08:00 in Kolkata (a Tuesday) — before working hours start. */
const NOW = instantFromLocalTime(2026, 9, 15, 8 * 60, TEST_TIME_ZONE);
const TODAY = "2026-09-15";

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
  other = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const addTask = (overrides: Record<string, unknown> = {}) =>
  createTask(profile.id, profile.timeZone, {
    title: "[TEST] Work on the report",
    priority: "MEDIUM",
    category: "PERSONAL",
    energy: "MEDIUM",
    dueDate: TODAY,
    ...overrides,
  } as never);

describe("the daily plan", () => {
  test("an empty day is reported as empty, not padded", async () => {
    const plan = await buildPlanForDay(profile, TODAY, NOW);

    expect(plan.isEmpty).toBe(true);
    expect(plan.blocks).toHaveLength(0);
    // No invented blocks, no sample schedule.
    expect(plan.unplanned).toHaveLength(0);
  });

  test("schedules a real task into real free time", async () => {
    await addTask({ estimatedMinutes: 60 });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]?.title).toBe("[TEST] Work on the report");
    // The default profile works 09:00–17:00.
    expect(plan.blocks[0]?.timeLabel).toBe("09:00–10:00");
    expect(plan.availableMinutes).toBe(480);
  });

  test("never books over an existing commitment", async () => {
    await createEvent(profile.id, profile.timeZone, {
      title: "[TEST] Lecture",
      kind: "CLASS",
      startDate: TODAY,
      startTime: "09:00",
      endTime: "12:00",
      isAllDay: false,
      isBusy: true,
    } as never);

    await addTask({ estimatedMinutes: 60 });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    // Free time starts after the lecture.
    expect(plan.availableMinutes).toBe(300);
    expect(plan.blocks[0]?.timeLabel).toBe("12:00–13:00");
  });

  test("a fully booked day plans nothing and says why", async () => {
    await createEvent(profile.id, profile.timeZone, {
      title: "[TEST] All day workshop",
      kind: "WORK",
      startDate: TODAY,
      startTime: "09:00",
      endTime: "17:00",
      isAllDay: false,
      isBusy: true,
    } as never);

    await addTask({ estimatedMinutes: 60 });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    expect(plan.blocks).toHaveLength(0);
    expect(plan.unplanned).toHaveLength(1);
    expect(plan.unplanned[0]?.reason).toContain("no free time");
  });

  test("a deadline does not consume planning time", async () => {
    // A due date is a moment, not a block — so the day stays fully available.
    await addTask({ estimatedMinutes: 60, dueTime: "15:00" });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    expect(plan.availableMinutes).toBe(480);
    expect(plan.blocks).toHaveLength(1);
  });

  test("overdue work is scheduled first and says so", async () => {
    await addTask({
      title: "[TEST] Overdue thing",
      dueDate: "2026-09-10",
      estimatedMinutes: 30,
    });
    await addTask({ title: "[TEST] Due today", estimatedMinutes: 30 });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    expect(plan.blocks[0]?.title).toBe("[TEST] Overdue thing");
    expect(plan.blocks[0]?.reasons).toContain("Already overdue");
  });

  test("HIGH-energy work is placed with a stated reason", async () => {
    await addTask({ energy: "HIGH", estimatedMinutes: 60 });

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    // The default study window is 19:00–22:00, outside working hours, so the
    // honest reason is that no peak time was free.
    expect(plan.blocks[0]?.reasons.join(" ")).toContain("Demanding work");
  });

  test("workload is assessed against real capacity", async () => {
    for (let index = 0; index < 12; index += 1) {
      await addTask({
        title: `[TEST] Task ${index}`,
        estimatedMinutes: 60,
      });
    }

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    // 12 hours of work into an 8-hour day.
    expect(plan.workload.verdict).toBe("OVERCOMMITTED");
    expect(plan.unplanned.length).toBeGreaterThan(0);
  });

  test("completed tasks are not scheduled", async () => {
    const task = await addTask({ estimatedMinutes: 60 });

    await db.task.update({
      where: { id: task.id },
      data: { status: "COMPLETED", completedAt: NOW },
    });

    expect((await buildPlanForDay(profile, TODAY, NOW)).blocks).toHaveLength(0);
  });

  test("another user's tasks and events never appear", async () => {
    await createTask(other.id, other.timeZone, {
      title: "[TEST] Their task",
      priority: "URGENT",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: TODAY,
    } as never);

    await createEvent(other.id, other.timeZone, {
      title: "[TEST] Their meeting",
      kind: "WORK",
      startDate: TODAY,
      startTime: "09:00",
      endTime: "17:00",
      isAllDay: false,
      isBusy: true,
    } as never);

    const plan = await buildPlanForDay(profile, TODAY, NOW);

    // Neither their task nor their busy block affected this plan.
    expect(plan.isEmpty).toBe(true);
    expect(plan.availableMinutes).toBe(480);
  });
});

describe("the weekend plan", () => {
  test("covers the next Saturday and Sunday", async () => {
    const weekend = await buildWeekendPlan(profile, NOW);

    expect(weekend).toHaveLength(2);
    // The 15th is a Tuesday, so the 19th and 20th.
    expect(weekend[0]?.dayKey).toBe("2026-09-19");
    expect(weekend[1]?.dayKey).toBe("2026-09-20");
  });
});

describe("procrastination signals", () => {
  test("nothing is flagged on a fresh account", async () => {
    await addTask();

    expect(await getProcrastinationSignals(profile, NOW)).toHaveLength(0);
  });

  test("counts real reschedules from the activity log", async () => {
    const task = await addTask();

    for (const date of ["2026-09-16", "2026-09-17", "2026-09-18"]) {
      await rescheduleTask(profile.id, profile.timeZone, {
        taskId: task.id,
        dueDate: date,
      } as never);
    }

    const signals = await getProcrastinationSignals(profile, NOW);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.rescheduleCount).toBe(3);
    expect(signals[0]?.severity).toBe("STUCK");
  });

  test("one reschedule is not a pattern", async () => {
    const task = await addTask();

    await rescheduleTask(profile.id, profile.timeZone, {
      taskId: task.id,
      dueDate: "2026-09-16",
    } as never);

    expect(await getProcrastinationSignals(profile, NOW)).toHaveLength(0);
  });

  test("another user's reschedules are not counted", async () => {
    const theirTask = await createTask(other.id, other.timeZone, {
      title: "[TEST] Their task",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: TODAY,
    } as never);

    for (const date of ["2026-09-16", "2026-09-17", "2026-09-18"]) {
      await rescheduleTask(other.id, other.timeZone, {
        taskId: theirTask.id,
        dueDate: date,
      } as never);
    }

    expect(await getProcrastinationSignals(profile, NOW)).toHaveLength(0);
    expect((await getProcrastinationSignals(other, NOW)).length).toBe(1);
  });
});

describe("recovery mode", () => {
  test("is not offered on an ordinary day", async () => {
    await addTask();

    expect((await getRecoveryPlan(profile, NOW)).isNeeded).toBe(false);
  });

  test("triggers on a real backlog and names what to drop", async () => {
    for (let index = 0; index < 7; index += 1) {
      await addTask({
        title: `[TEST] Overdue ${index}`,
        dueDate: "2026-09-01",
        estimatedMinutes: 60,
      });
    }

    const recovery = await getRecoveryPlan(profile, NOW);

    expect(recovery.isNeeded).toBe(true);
    expect(recovery.focus.length).toBeGreaterThan(0);
    expect(recovery.defer.length).toBeGreaterThan(0);
    // Every item is accounted for — none silently disappears.
    expect(recovery.focus.length + recovery.defer.length).toBe(7);
  });
});

describe("exam mode", () => {
  test("is inactive with no upcoming exam", async () => {
    expect((await getExamMode(profile, NOW)).isActive).toBe(false);
  });

  test("computes a daily study figure from real topics", async () => {
    const semester = await db.semester.create({
      data: {
        profileId: profile.id,
        name: "[TEST] Semester",
        academicYear: "2026-27",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    const exam = await db.exam.create({
      data: {
        profileId: profile.id,
        semesterId: semester.id,
        title: "[TEST] Networks",
        startAt: instantFromLocalTime(2026, 9, 22, 10 * 60, TEST_TIME_ZONE),
      },
    });

    await db.examTopic.createMany({
      data: Array.from({ length: 14 }, (_, index) => ({
        profileId: profile.id,
        examId: exam.id,
        title: `[TEST] Topic ${index}`,
        position: index,
      })),
    });

    const mode = await getExamMode(profile, NOW);

    expect(mode.isActive).toBe(true);
    expect(mode.examTitle).toBe("[TEST] Networks");
    expect(mode.daysUntil).toBe(7);
    expect(mode.topicsRemaining).toBe(14);
    // 14 topics × 30 min ÷ 7 days.
    expect(mode.dailyStudyMinutes).toBe(60);
  });

  test("another user's exam never activates this user's exam mode", async () => {
    const semester = await db.semester.create({
      data: {
        profileId: other.id,
        name: "[TEST] Their semester",
        academicYear: "2026-27",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    await db.exam.create({
      data: {
        profileId: other.id,
        semesterId: semester.id,
        title: "[TEST] Their exam",
        startAt: instantFromLocalTime(2026, 9, 18, 10 * 60, TEST_TIME_ZONE),
      },
    });

    expect((await getExamMode(profile, NOW)).isActive).toBe(false);
  });
});

describe("the weekly review", () => {
  test("a quiet week reports honestly rather than inventing insight", async () => {
    const review = await getWeeklyReview(profile, NOW);

    expect(review.completedCount).toBe(0);
    expect(review.completionRate).toBeNull();
    expect(review.observations.length).toBeGreaterThan(0);
  });

  test("counts real completions and creations", async () => {
    const first = await addTask({ title: "[TEST] One" });
    await addTask({ title: "[TEST] Two" });

    await db.task.update({
      where: { id: first.id },
      data: { status: "COMPLETED", completedAt: NOW },
    });

    const review = await getWeeklyReview(profile, NOW);

    expect(review.createdCount).toBe(2);
    expect(review.completedCount).toBe(1);
  });

  test("another user's activity does not appear", async () => {
    for (let index = 0; index < 5; index += 1) {
      await createTask(other.id, other.timeZone, {
        title: `[TEST] Their task ${index}`,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
      } as never);
    }

    expect((await getWeeklyReview(profile, NOW)).createdCount).toBe(0);
  });
});

describe("planning works with no AI configured", () => {
  test("every surface returns real output without a model", async () => {
    // GEMINI_API_KEY is blank in this environment. This is the whole point of
    // computing plans rather than generating them.
    await addTask({ estimatedMinutes: 60 });

    const [plan, recovery, examMode, signals, review] = await Promise.all([
      buildPlanForDay(profile, TODAY, NOW),
      getRecoveryPlan(profile, NOW),
      getExamMode(profile, NOW),
      getProcrastinationSignals(profile, NOW),
      getWeeklyReview(profile, NOW),
    ]);

    expect(plan.blocks).toHaveLength(1);
    expect(recovery.isNeeded).toBe(false);
    expect(examMode.isActive).toBe(false);
    expect(signals).toHaveLength(0);
    expect(review.createdCount).toBe(1);
  });
});
