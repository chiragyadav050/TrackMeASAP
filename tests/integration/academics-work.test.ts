import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Semester, Subject } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime, localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import {
  getAcademicOverview,
  getAcademicPriorities,
  getExamDetail,
  getTodayAcademics,
  getUpcomingAssignments,
  getUpcomingExams,
  listAssignments,
} from "@/services/academics/academic.query";
import {
  createAssignment,
  createTaskForAssignment,
  deleteAssignment,
  recordMarks,
  setAssignmentStatus,
  setSubmission,
  updateAssignment,
} from "@/services/academics/assignment.service";
import {
  createAssessment,
  createExam,
  createExamTopic,
  deleteExam,
  reorderExamTopics,
  setTopicCompletion,
} from "@/services/academics/exam.service";
import {
  createSemester,
  createSubject,
  setCurrentSemester,
} from "@/services/academics/semester.service";
import {
  getStudySummary,
  logStudySession,
} from "@/services/academics/study.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/** 2026-09-15, 10:00 in Kolkata. Fixed, so nothing depends on the real clock. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

let profile: Profile;
let semester: Semester;
let subject: Subject;

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();

  semester = await createSemester(profile.id, {
    name: "Semester 6",
    academicYear: "2025-26",
    startDate: "2026-08-01",
    endDate: "2026-12-20",
    status: "ACTIVE",
  } as never);

  await setCurrentSemester(profile.id, semester.id);

  subject = await createSubject(profile.id, {
    semesterId: semester.id,
    name: "DBMS",
    code: "DB-301",
    attendanceThreshold: 75,
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const assignmentInput = (overrides: Record<string, unknown> = {}) =>
  ({
    subjectId: subject.id,
    title: "Normalisation report",
    priority: "MEDIUM",
    status: "NOT_STARTED",
    submissionStatus: "NOT_SUBMITTED",
    createTask: false,
    ...overrides,
  }) as never;

describe("assignments", () => {
  test("are created with the semester denormalised from the subject", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ dueDate: "2026-09-18", estimatedMinutes: 120 }),
    );

    expect(assignment.semesterId).toBe(semester.id);
    expect(assignment.subjectId).toBe(subject.id);
    expect(assignment.isAllDay).toBe(true);
    expect(localDateKey(assignment.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-18");
  });

  test("a timed deadline converts from the student's zone", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ dueDate: "2026-09-18", dueTime: "23:59" }),
    );

    expect(assignment.isAllDay).toBe(false);
    // 23:59 IST on the 18th is 18:29Z.
    expect(assignment.dueAt?.toISOString()).toBe("2026-09-18T18:29:00.000Z");
  });

  test("WORK STATUS AND SUBMISSION MOVE INDEPENDENTLY", async () => {
    // The core product rule: finishing the work and handing it in are
    // separate events that routinely happen days apart.
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ dueDate: "2026-09-10" }),
    );

    const completed = await setAssignmentStatus(
      profile.id,
      assignment.id,
      "COMPLETED",
    );

    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeInstanceOf(Date);
    // Completing the work does NOT submit it.
    expect(completed.submissionStatus).toBe("NOT_SUBMITTED");
    expect(completed.submittedAt).toBeNull();

    const submitted = await setSubmission(
      profile.id,
      assignment.id,
      "SUBMITTED",
      "https://lms.example.edu/a/1",
    );

    expect(submitted.submissionStatus).toBe("SUBMITTED");
    expect(submitted.submittedAt).toBeInstanceOf(Date);
    // …and submitting does not change the work status either.
    expect(submitted.status).toBe("COMPLETED");
  });

  test("an unfinished assignment can still be submitted", async () => {
    // Submitting a draft to beat a deadline is a real thing students do.
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ status: "IN_PROGRESS" }),
    );

    const submitted = await setSubmission(
      profile.id,
      assignment.id,
      "SUBMITTED",
    );

    expect(submitted.status).toBe("IN_PROGRESS");
    expect(submitted.submissionStatus).toBe("SUBMITTED");
  });

  test("'graded' is simply having a mark", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput(),
    );

    const graded = await recordMarks(profile.id, assignment.id, 18, 20);

    expect(graded.marksObtained).toBe(18);
    expect(graded.maxMarks).toBe(20);
  });

  test("bonus marks above the maximum are accepted, not clamped", async () => {
    // Moderation and grace marks are common; rejecting 22/20 would force the
    // student to record something untrue.
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput(),
    );

    const graded = await recordMarks(profile.id, assignment.id, 22, 20);

    expect(graded.marksObtained).toBe(22);
  });
});

describe("assignment → task integration", () => {
  test("creates a LINKED task, not a copy", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({
        dueDate: "2026-09-18",
        priority: "HIGH",
        estimatedMinutes: 90,
      }),
    );

    const { taskId, created } = await createTaskForAssignment(
      profile.id,
      assignment.id,
    );

    expect(created).toBe(true);

    const task = await db.task.findUnique({ where: { id: taskId } });

    // Context carried across: subject, deadline, estimate, priority.
    expect(task?.title).toBe("DB-301: Normalisation report");
    expect(task?.subjectId).toBe(subject.id);
    expect(task?.category).toBe("COLLEGE");
    expect(task?.priority).toBe("HIGH");
    expect(task?.estimatedMinutes).toBe(90);
    expect(task?.dueAt?.toISOString()).toBe(assignment.dueAt?.toISOString());

    // …and the two records reference each other rather than duplicating.
    const linked = await db.assignment.findUnique({
      where: { id: assignment.id },
    });
    expect(linked?.taskId).toBe(taskId);
  });

  test("is idempotent — asking twice returns the same task", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput(),
    );

    const first = await createTaskForAssignment(profile.id, assignment.id);
    const second = await createTaskForAssignment(profile.id, assignment.id);

    expect(second.taskId).toBe(first.taskId);
    expect(second.created).toBe(false);

    expect(await db.task.count({ where: { profileId: profile.id } })).toBe(1);
  });

  test("createTask on creation does it in one step", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ createTask: true }),
    );

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });

    expect(stored?.taskId).not.toBeNull();
  });

  test("COMPLETING THE TASK DOES NOT SUBMIT THE ASSIGNMENT", async () => {
    // The single most important boundary in this phase. A student who ticks
    // the task has finished writing; they have not handed anything in.
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ createTask: true }),
    );

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });

    await db.task.update({
      where: { id: stored!.taskId! },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const after = await db.assignment.findUnique({
      where: { id: assignment.id },
    });

    expect(after?.submissionStatus).toBe("NOT_SUBMITTED");
    expect(after?.submittedAt).toBeNull();
  });

  test("editing the assignment mirrors schedulable facts onto the task", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ createTask: true, dueDate: "2026-09-18" }),
    );

    await updateAssignment(profile.id, TEST_TIME_ZONE, {
      assignmentId: assignment.id,
      dueDate: "2026-09-25",
      priority: "URGENT",
      estimatedMinutes: 45,
    } as never);

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });
    const task = await db.task.findUnique({ where: { id: stored!.taskId! } });

    expect(localDateKey(task!.dueAt!, TEST_TIME_ZONE)).toBe("2026-09-25");
    expect(task?.priority).toBe("URGENT");
    expect(task?.estimatedMinutes).toBe(45);
  });

  test("deleting the assignment leaves the task alone", async () => {
    const assignment = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ createTask: true }),
    );

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });
    const taskId = stored!.taskId!;

    await deleteAssignment(profile.id, assignment.id);

    // The student may still want the work item; destroying it was not asked
    // for.
    expect(await db.task.findUnique({ where: { id: taskId } })).not.toBeNull();
  });
});

describe("assignment views", () => {
  async function seed() {
    const overdue = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Overdue", dueDate: "2026-09-10" }),
    );
    const dueToday = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Today", dueDate: "2026-09-15" }),
    );
    const thisWeek = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "This week", dueDate: "2026-09-19" }),
    );
    const done = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Done", dueDate: "2026-09-12" }),
    );

    await setAssignmentStatus(profile.id, done.id, "COMPLETED");
    await setSubmission(profile.id, done.id, "SUBMITTED");

    return { overdue, dueToday, thisWeek, done };
  }

  test("OVERDUE excludes anything submitted, whatever its work status", async () => {
    const seeded = await seed();

    const overdue = await listAssignments(
      profile,
      { view: "OVERDUE", sort: "DUE_DATE" } as never,
      NOW,
    );

    expect(overdue.map((entry) => entry.id)).toEqual([seeded.overdue.id]);
  });

  test("an all-day assignment due TODAY is not overdue", async () => {
    await seed();

    const overdue = await listAssignments(
      profile,
      { view: "OVERDUE", sort: "DUE_DATE" } as never,
      NOW,
    );

    expect(overdue.map((entry) => entry.title)).not.toContain("Today");
  });

  test("DUE_TODAY, DUE_THIS_WEEK and OPEN narrow correctly", async () => {
    const seeded = await seed();

    const today = await listAssignments(
      profile,
      { view: "DUE_TODAY", sort: "DUE_DATE" } as never,
      NOW,
    );
    expect(today.map((entry) => entry.id)).toEqual([seeded.dueToday.id]);

    const week = await listAssignments(
      profile,
      { view: "DUE_THIS_WEEK", sort: "DUE_DATE" } as never,
      NOW,
    );
    expect(week.map((entry) => entry.id).sort()).toEqual(
      [seeded.dueToday.id, seeded.thisWeek.id].sort(),
    );

    const open = await listAssignments(
      profile,
      { view: "OPEN", sort: "DUE_DATE" } as never,
      NOW,
    );
    expect(open.map((entry) => entry.id)).not.toContain(seeded.done.id);
  });

  test("GRADED means having a mark, not a status", async () => {
    const seeded = await seed();
    await recordMarks(profile.id, seeded.thisWeek.id, 15, 20);

    const graded = await listAssignments(
      profile,
      { view: "GRADED", sort: "DUE_DATE" } as never,
      NOW,
    );

    expect(graded.map((entry) => entry.id)).toEqual([seeded.thisWeek.id]);
    expect(graded[0]?.marksPercent).toBe(75);
  });

  test("getUpcomingAssignments is the AI-tool shape", async () => {
    await seed();

    const upcoming = await getUpcomingAssignments(profile, 14, NOW);

    expect(upcoming.map((entry) => entry.title).sort()).toEqual([
      "This week",
      "Today",
    ]);
    // Finished labels, computed server-side in the student's zone.
    expect(upcoming[0]?.dueLabel).toBeTypeOf("string");
  });
});

describe("exams and topics", () => {
  async function makeExam(overrides: Record<string, unknown> = {}) {
    return createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "DBMS Midterm",
      type: "MIDTERM",
      date: "2026-09-25",
      time: "09:30",
      durationMinutes: 120,
      maxMarks: 50,
      status: "UPCOMING",
      ...overrides,
    } as never);
  }

  test("are created with a zone-converted start instant", async () => {
    const exam = await makeExam();

    // 09:30 IST on the 25th is 04:00Z.
    expect(exam.startAt?.toISOString()).toBe("2026-09-25T04:00:00.000Z");
  });

  test("preparation is null until topics exist", async () => {
    const exam = await makeExam();

    const detail = await getExamDetail(profile, exam.id, NOW);

    // "Preparation tracking not started" — NOT 0% prepared.
    expect(detail?.exam.preparationPercent).toBeNull();
    expect(detail?.exam.totalTopics).toBe(0);
  });

  test("THE BRIEF'S CASE: 5 of 8 topics reads 62.5%", async () => {
    const exam = await makeExam();

    const topics = [];
    for (let index = 0; index < 8; index += 1) {
      topics.push(
        await createExamTopic(
          profile.id,
          exam.id,
          `Topic ${index + 1}`,
          "MEDIUM",
        ),
      );
    }

    for (let index = 0; index < 5; index += 1) {
      await setTopicCompletion(profile.id, topics[index]!.id, true);
    }

    const detail = await getExamDetail(profile, exam.id, NOW);

    expect(detail?.exam.totalTopics).toBe(8);
    expect(detail?.exam.completedTopics).toBe(5);
    expect(detail?.exam.preparationPercent).toBe(62.5);
  });

  test("days remaining is counted in the student's zone", async () => {
    const exam = await makeExam();

    const detail = await getExamDetail(profile, exam.id, NOW);

    expect(detail?.exam.daysRemaining).toBe(10);
  });

  test("topics keep their order, and can be reordered as a complete set", async () => {
    const exam = await makeExam();

    const a = await createExamTopic(profile.id, exam.id, "A", "HIGH");
    const b = await createExamTopic(profile.id, exam.id, "B", "MEDIUM");
    const c = await createExamTopic(profile.id, exam.id, "C", "LOW");

    await reorderExamTopics(profile.id, exam.id, [c.id, a.id, b.id]);

    const detail = await getExamDetail(profile, exam.id, NOW);
    expect(detail?.topics.map((topic) => topic.title)).toEqual(["C", "A", "B"]);
  });

  test("reordering rejects an incomplete list rather than partially applying", async () => {
    const exam = await makeExam();
    const a = await createExamTopic(profile.id, exam.id, "A", "HIGH");
    await createExamTopic(profile.id, exam.id, "B", "MEDIUM");

    await expect(
      reorderExamTopics(profile.id, exam.id, [a.id]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );
  });

  test("deleting an exam cascades topics but SPARES logged study time", async () => {
    const exam = await makeExam();
    const topic = await createExamTopic(profile.id, exam.id, "A", "HIGH");

    const session = await logStudySession(
      profile.id,
      TEST_TIME_ZONE,
      {
        subjectId: subject.id,
        examId: exam.id,
        topicId: topic.id,
        durationMinutes: 45,
      } as never,
      NOW,
    );

    await deleteExam(profile.id, exam.id);

    expect(await db.examTopic.count({ where: { examId: exam.id } })).toBe(0);

    // Study time is the student's own record of work done — it survives.
    const survivor = await db.studySession.findUnique({
      where: { id: session.id },
    });
    expect(survivor).not.toBeNull();
    expect(survivor?.examId).toBeNull();
  });

  test("getUpcomingExams is the AI-tool shape", async () => {
    await makeExam();

    const upcoming = await getUpcomingExams(profile, 30, NOW);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.daysRemaining).toBe(10);
    expect(upcoming[0]?.subjectName).toBe("DBMS");
  });
});

describe("assessments", () => {
  test("are created against the subject's semester", async () => {
    const assessment = await createAssessment(profile.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      title: "Unit test 1",
      type: "CLASS_TEST",
      date: "2026-09-19",
      time: "11:00",
      maxMarks: 20,
      status: "UPCOMING",
    } as never);

    expect(assessment.semesterId).toBe(semester.id);
    expect(assessment.type).toBe("CLASS_TEST");
    expect(assessment.scheduledAt?.toISOString()).toBe(
      "2026-09-19T05:30:00.000Z",
    );
  });
});

describe("study sessions", () => {
  test("logging records duration and derives the end instant", async () => {
    const session = await logStudySession(
      profile.id,
      TEST_TIME_ZONE,
      {
        subjectId: subject.id,
        date: "2026-09-15",
        startTime: "19:00",
        durationMinutes: 45,
        focusRating: 4,
      } as never,
      NOW,
    );

    expect(session.durationMinutes).toBe(45);
    expect(session.focusRating).toBe(4);
    // 19:00 IST is 13:30Z; +45 minutes is 14:15Z.
    expect(session.startedAt.toISOString()).toBe("2026-09-15T13:30:00.000Z");
    expect(session.endedAt?.toISOString()).toBe("2026-09-15T14:15:00.000Z");
  });

  test("defaults to today in the student's zone", async () => {
    const session = await logStudySession(
      profile.id,
      TEST_TIME_ZONE,
      { subjectId: subject.id, durationMinutes: 30 } as never,
      NOW,
    );

    expect(localDateKey(session.startedAt, TEST_TIME_ZONE)).toBe("2026-09-15");
  });

  test("refuses a topic that belongs to a different exam", async () => {
    const examA = await createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "A",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    const examB = await createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "B",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    const topicOfB = await createExamTopic(profile.id, examB.id, "T", "HIGH");

    await expect(
      logStudySession(
        profile.id,
        TEST_TIME_ZONE,
        {
          subjectId: subject.id,
          examId: examA.id,
          topicId: topicOfB.id,
          durationMinutes: 30,
        } as never,
        NOW,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );
  });

  test("weekly summary totals minutes and counts DISTINCT days", async () => {
    const log = (dateKey: string, minutes: number) =>
      logStudySession(
        profile.id,
        TEST_TIME_ZONE,
        {
          subjectId: subject.id,
          date: dateKey,
          startTime: "19:00",
          durationMinutes: minutes,
        } as never,
        NOW,
      );

    await log("2026-09-15", 60);
    await log("2026-09-15", 30); // same day again
    await log("2026-09-14", 90);

    const summary = await getStudySummary(profile.id, TEST_TIME_ZONE, NOW);

    expect(summary.todayMinutes).toBe(90);
    expect(summary.weekMinutes).toBe(180);
    // Three sessions, two days — consistency is days, not session count.
    expect(summary.activeDays).toBe(2);
    expect(summary.bySubject[0]?.minutes).toBe(180);
  });

  test("study outside the trailing week is excluded from the weekly figure", async () => {
    await logStudySession(
      profile.id,
      TEST_TIME_ZONE,
      {
        subjectId: subject.id,
        date: "2026-09-01",
        startTime: "19:00",
        durationMinutes: 120,
      } as never,
      NOW,
    );

    const summary = await getStudySummary(profile.id, TEST_TIME_ZONE, NOW);

    expect(summary.weekMinutes).toBe(0);
  });
});

describe("dashboards", () => {
  test("the academic overview assembles real figures", async () => {
    await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "One", dueDate: "2026-09-18" }),
    );
    const done = await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Two" }),
    );
    await setAssignmentStatus(profile.id, done.id, "COMPLETED");

    await createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Midterm",
      type: "MIDTERM",
      date: "2026-09-25",
      status: "UPCOMING",
    } as never);

    await logStudySession(
      profile.id,
      TEST_TIME_ZONE,
      { subjectId: subject.id, durationMinutes: 120 } as never,
      NOW,
    );

    const overview = await getAcademicOverview(profile, NOW);

    expect(overview.semester?.id).toBe(semester.id);
    expect(overview.subjectCount).toBe(1);
    expect(overview.assignmentsTotal).toBe(2);
    expect(overview.assignmentsCompleted).toBe(1);
    expect(overview.upcomingExams).toHaveLength(1);
    expect(overview.studyWeekMinutes).toBe(120);
    // No classes marked, so attendance honestly reports nothing.
    expect(overview.attendance?.percentage).toBeNull();
  });

  test("a profile with no semester gets empty values, not invented ones", async () => {
    const fresh = await createTestProfile();

    const overview = await getAcademicOverview(fresh, NOW);

    expect(overview.semester).toBeNull();
    expect(overview.subjectCount).toBe(0);
    expect(overview.priorities).toEqual([]);
    expect(overview.upcomingExams).toEqual([]);
  });

  test("academic priorities rank overdue work above a distant exam", async () => {
    await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Late report", dueDate: "2026-09-10" }),
    );

    await createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Far off",
      type: "END_SEMESTER",
      date: "2026-12-10",
      status: "UPCOMING",
    } as never);

    const priorities = await getAcademicPriorities(profile, 10, NOW);

    expect(priorities[0]?.title).toBe("Late report");
    expect(priorities[0]?.reasons).toContain("Overdue");
  });

  test("the Today slice surfaces academic work without a semester crash", async () => {
    await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Due now", dueDate: "2026-09-15" }),
    );
    await createAssignment(
      profile.id,
      TEST_TIME_ZONE,
      assignmentInput({ title: "Was due", dueDate: "2026-09-11" }),
    );
    await createExam(profile.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Next up",
      type: "MIDTERM",
      date: "2026-09-25",
      status: "UPCOMING",
    } as never);

    const today = await getTodayAcademics(profile, NOW);

    expect(today.dueToday.map((entry) => entry.title)).toEqual(["Due now"]);
    expect(today.overdue.map((entry) => entry.title)).toEqual(["Was due"]);
    expect(today.nextExam?.title).toBe("Next up");
    expect(today.topPriority).not.toBeNull();
  });

  test("the Today slice is empty and safe for a user with no semester", async () => {
    const fresh = await createTestProfile();

    const today = await getTodayAcademics(fresh, NOW);

    expect(today.dueToday).toEqual([]);
    expect(today.nextExam).toBeNull();
    expect(today.topPriority).toBeNull();
  });
});
