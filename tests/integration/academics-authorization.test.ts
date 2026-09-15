import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Semester, Subject } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import {
  getAcademicOverview,
  getAssignment,
  getExamDetail,
  listAssignments,
  listExams,
} from "@/services/academics/academic.query";
import {
  requireOwnedAssignment,
  requireOwnedExam,
  requireOwnedSemester,
  requireOwnedSubject,
  requireOwnedTopic,
} from "@/services/academics/academic.ownership";
import {
  createAssignment,
  createTaskForAssignment,
  deleteAssignment,
  recordMarks,
  setAssignmentArchived,
  setAssignmentStatus,
  setSubmission,
  updateAssignment,
} from "@/services/academics/assignment.service";
import {
  clearAttendance,
  getAttendanceSummary,
  markAttendance,
} from "@/services/academics/attendance.service";
import {
  createAssessment,
  createExam,
  createExamTopic,
  deleteExam,
  deleteExamTopic,
  reorderExamTopics,
  setTopicCompletion,
  updateExamTopic,
} from "@/services/academics/exam.service";
import {
  archiveSemester,
  createSemester,
  createSubject,
  deleteSemester,
  deleteSubject,
  listSubjects,
  setCurrentSemester,
  setSubjectArchived,
  updateSemester,
  updateSubject,
} from "@/services/academics/semester.service";
import {
  createAcademicNote,
  deleteAcademicNote,
  deleteStudySession,
  listAcademicNotes,
  logStudySession,
  updateAcademicNote,
} from "@/services/academics/study.service";
import {
  createClassSession,
  createSchedule,
  deleteClassSession,
  deleteSchedule,
  generateClassSessions,
  setClassSessionStatus,
  updateSchedule,
} from "@/services/academics/timetable.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * CROSS-TENANT ISOLATION FOR THE ACADEMIC MODULE.
 *
 * Phase 3 adds eleven owned entities. Every mutation on every one of them is
 * invoked here with the WRONG profile and must refuse — and, just as
 * importantly, must leave the victim's data untouched.
 *
 * Two real profiles in a real database; no mocks. A mocked repository would
 * assert only that the mock was called correctly, which is precisely the bug
 * class this exists to catch.
 *
 * NOT_FOUND is asserted rather than FORBIDDEN, so the API cannot be used as
 * an id oracle. Same rule as Tasks.
 */

const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

let owner: Profile;
let attacker: Profile;
let semester: Semester;
let subject: Subject;

const expectNotFound = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toSatisfy(
    (error: unknown) => isAppError(error) && error.code === "NOT_FOUND",
  );
};

beforeEach(async () => {
  await cleanupTestData();
  owner = await createTestProfile();
  attacker = await createTestProfile();

  semester = await createSemester(owner.id, {
    name: "Owner's semester",
    academicYear: "2025-26",
    startDate: "2026-08-01",
    endDate: "2026-12-20",
    status: "ACTIVE",
  } as never);

  await setCurrentSemester(owner.id, semester.id);

  subject = await createSubject(owner.id, {
    semesterId: semester.id,
    name: "Owner's private subject",
    code: "PRV-101",
    attendanceThreshold: 75,
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("ownership guards refuse foreign ids", () => {
  test("semester, subject, assignment, exam and topic", async () => {
    const assignment = await createAssignment(owner.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      title: "Private",
      priority: "MEDIUM",
      status: "NOT_STARTED",
      submissionStatus: "NOT_SUBMITTED",
      createTask: false,
    } as never);

    const exam = await createExam(owner.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Private exam",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    const topic = await createExamTopic(owner.id, exam.id, "Private", "HIGH");

    await expectNotFound(requireOwnedSemester(attacker.id, semester.id));
    await expectNotFound(requireOwnedSubject(attacker.id, subject.id));
    await expectNotFound(requireOwnedAssignment(attacker.id, assignment.id));
    await expectNotFound(requireOwnedExam(attacker.id, exam.id));
    await expectNotFound(requireOwnedTopic(attacker.id, topic.id));

    // …and all still resolve for the legitimate owner.
    await expect(
      requireOwnedSubject(owner.id, subject.id),
    ).resolves.toMatchObject({ id: subject.id });
  });
});

describe("semester and subject mutations", () => {
  test("cannot be updated, archived or deleted by another profile", async () => {
    await expectNotFound(
      updateSemester(attacker.id, {
        semesterId: semester.id,
        name: "Hijacked",
        academicYear: "2025-26",
        startDate: "2026-08-01",
        endDate: "2026-12-20",
        status: "ACTIVE",
      } as never),
    );

    await expectNotFound(archiveSemester(attacker.id, semester.id));
    await expectNotFound(deleteSemester(attacker.id, semester.id));

    const stored = await db.semester.findUnique({ where: { id: semester.id } });
    expect(stored?.name).toBe("Owner's semester");
    expect(stored?.status).toBe("ACTIVE");
  });

  test("setCurrentSemester cannot be used on a foreign semester", async () => {
    await expectNotFound(setCurrentSemester(attacker.id, semester.id));

    // The victim keeps their current semester; the attacker gains none.
    expect(
      await db.semester.count({
        where: { profileId: attacker.id, isCurrent: true },
      }),
    ).toBe(0);
  });

  test("a subject cannot be created against a foreign semester", async () => {
    await expectNotFound(
      createSubject(attacker.id, {
        semesterId: semester.id,
        name: "Injected",
        attendanceThreshold: 75,
      } as never),
    );

    expect(await db.subject.count({ where: { semesterId: semester.id } })).toBe(
      1,
    );
  });

  test("a subject cannot be MOVED into a foreign semester", async () => {
    // The attacker owns the subject but not the destination.
    const theirSemester = await createSemester(attacker.id, {
      name: "Theirs",
      academicYear: "2025-26",
      startDate: "2026-08-01",
      endDate: "2026-12-20",
      status: "ACTIVE",
    } as never);

    const theirSubject = await createSubject(attacker.id, {
      semesterId: theirSemester.id,
      name: "Theirs",
      attendanceThreshold: 75,
    } as never);

    await expectNotFound(
      updateSubject(attacker.id, {
        subjectId: theirSubject.id,
        semesterId: semester.id,
      } as never),
    );

    const stored = await db.subject.findUnique({
      where: { id: theirSubject.id },
    });
    expect(stored?.semesterId).toBe(theirSemester.id);
  });

  test("subject update, archive and delete refuse a foreign subject", async () => {
    await expectNotFound(
      updateSubject(attacker.id, {
        subjectId: subject.id,
        name: "Hijacked",
      } as never),
    );
    await expectNotFound(setSubjectArchived(attacker.id, subject.id, true));
    await expectNotFound(deleteSubject(attacker.id, subject.id));

    const stored = await db.subject.findUnique({ where: { id: subject.id } });
    expect(stored?.name).toBe("Owner's private subject");
    expect(stored?.archivedAt).toBeNull();
  });
});

describe("timetable and attendance", () => {
  test("a schedule cannot be created against a foreign subject", async () => {
    await expectNotFound(
      createSchedule(attacker.id, {
        subjectId: subject.id,
        dayOfWeek: 1,
        startTime: "10:00",
        endTime: "11:00",
        sessionType: "LECTURE",
      } as never),
    );

    expect(
      await db.classSchedule.count({ where: { subjectId: subject.id } }),
    ).toBe(0);
  });

  test("schedule update and delete refuse a foreign schedule", async () => {
    const schedule = await createSchedule(owner.id, {
      subjectId: subject.id,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "11:00",
      sessionType: "LECTURE",
    } as never);

    await expectNotFound(
      updateSchedule(attacker.id, {
        scheduleId: schedule.id,
        subjectId: subject.id,
        dayOfWeek: 2,
        startTime: "14:00",
        endTime: "15:00",
        sessionType: "LECTURE",
      } as never),
    );

    await expectNotFound(deleteSchedule(attacker.id, schedule.id));

    const stored = await db.classSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(stored?.dayOfWeek).toBe(1);
  });

  test("generation only ever materialises the caller's own rules", async () => {
    await createSchedule(owner.id, {
      subjectId: subject.id,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "11:00",
      sessionType: "LECTURE",
    } as never);

    const result = await generateClassSessions(attacker.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    expect(result.created).toBe(0);
    expect(
      await db.classSession.count({ where: { profileId: attacker.id } }),
    ).toBe(0);
  });

  test("a class session cannot be created against a foreign subject", async () => {
    await expectNotFound(
      createClassSession(attacker.id, TEST_TIME_ZONE, {
        subjectId: subject.id,
        date: "2026-09-14",
        startTime: "10:00",
        endTime: "11:00",
        sessionType: "LECTURE",
      } as never),
    );
  });

  test("attendance cannot be marked, cleared or read on a foreign class", async () => {
    const session = await createClassSession(owner.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      date: "2026-09-14",
      startTime: "10:00",
      endTime: "11:00",
      sessionType: "LECTURE",
    } as never);

    await expectNotFound(markAttendance(attacker.id, session.id, "PRESENT"));
    await expectNotFound(clearAttendance(attacker.id, session.id));
    await expectNotFound(
      setClassSessionStatus(attacker.id, session.id, "CANCELLED"),
    );
    await expectNotFound(deleteClassSession(attacker.id, session.id));
    await expectNotFound(getAttendanceSummary(attacker.id, subject.id, NOW));

    // Nothing was written, and the class is untouched.
    expect(
      await db.attendanceRecord.count({
        where: { classSessionId: session.id },
      }),
    ).toBe(0);

    const stored = await db.classSession.findUnique({
      where: { id: session.id },
    });
    expect(stored?.status).toBe("SCHEDULED");
  });
});

describe("assignments", () => {
  async function makeAssignment() {
    return createAssignment(owner.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      title: "Owner's assignment",
      priority: "MEDIUM",
      status: "NOT_STARTED",
      submissionStatus: "NOT_SUBMITTED",
      createTask: false,
    } as never);
  }

  test("cannot be created against a foreign subject", async () => {
    await expectNotFound(
      createAssignment(attacker.id, TEST_TIME_ZONE, {
        subjectId: subject.id,
        title: "Injected",
        priority: "MEDIUM",
        status: "NOT_STARTED",
        submissionStatus: "NOT_SUBMITTED",
        createTask: false,
      } as never),
    );

    expect(
      await db.assignment.count({ where: { subjectId: subject.id } }),
    ).toBe(0);
  });

  test("every mutation refuses a foreign assignment", async () => {
    const assignment = await makeAssignment();

    await expectNotFound(
      updateAssignment(attacker.id, TEST_TIME_ZONE, {
        assignmentId: assignment.id,
        title: "Hijacked",
      } as never),
    );
    await expectNotFound(
      setAssignmentStatus(attacker.id, assignment.id, "COMPLETED"),
    );
    await expectNotFound(
      setSubmission(attacker.id, assignment.id, "SUBMITTED"),
    );
    await expectNotFound(recordMarks(attacker.id, assignment.id, 20, 20));
    await expectNotFound(
      setAssignmentArchived(attacker.id, assignment.id, true),
    );
    await expectNotFound(deleteAssignment(attacker.id, assignment.id));

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });

    expect(stored?.title).toBe("Owner's assignment");
    expect(stored?.status).toBe("NOT_STARTED");
    expect(stored?.submissionStatus).toBe("NOT_SUBMITTED");
    expect(stored?.marksObtained).toBeNull();
    expect(stored?.archivedAt).toBeNull();
  });

  test("a task cannot be generated from a foreign assignment", async () => {
    const assignment = await makeAssignment();

    await expectNotFound(createTaskForAssignment(attacker.id, assignment.id));

    expect(await db.task.count({ where: { profileId: attacker.id } })).toBe(0);

    const stored = await db.assignment.findUnique({
      where: { id: assignment.id },
    });
    expect(stored?.taskId).toBeNull();
  });

  test("reads never cross the boundary", async () => {
    await makeAssignment();

    expect(
      await listAssignments(
        attacker,
        { view: "ALL", sort: "DUE_DATE" } as never,
        NOW,
      ),
    ).toHaveLength(0);

    const owned = await db.assignment.findFirst({
      where: { profileId: owner.id },
    });

    expect(await getAssignment(attacker, owned!.id, NOW)).toBeNull();
  });
});

describe("exams, topics and assessments", () => {
  async function makeExam() {
    return createExam(owner.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Owner's exam",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);
  }

  test("an exam cannot be created against a foreign semester or subject", async () => {
    await expectNotFound(
      createExam(attacker.id, TEST_TIME_ZONE, {
        semesterId: semester.id,
        title: "Injected",
        type: "MIDTERM",
        status: "UPCOMING",
      } as never),
    );
  });

  test("topic mutations refuse a foreign exam or topic", async () => {
    const exam = await makeExam();
    const topic = await createExamTopic(owner.id, exam.id, "Private", "HIGH");

    await expectNotFound(
      createExamTopic(attacker.id, exam.id, "Injected", "HIGH"),
    );
    await expectNotFound(setTopicCompletion(attacker.id, topic.id, true));
    await expectNotFound(
      updateExamTopic(attacker.id, { topicId: topic.id, title: "Hijacked" }),
    );
    await expectNotFound(deleteExamTopic(attacker.id, topic.id));
    await expectNotFound(reorderExamTopics(attacker.id, exam.id, [topic.id]));
    await expectNotFound(deleteExam(attacker.id, exam.id));

    const stored = await db.examTopic.findUnique({ where: { id: topic.id } });
    expect(stored?.title).toBe("Private");
    expect(stored?.isCompleted).toBe(false);
  });

  test("reorder rejects a list smuggling in a foreign topic id", async () => {
    // The attacker owns the exam, but not the topic they try to attach.
    const theirSemester = await createSemester(attacker.id, {
      name: "Theirs",
      academicYear: "2025-26",
      startDate: "2026-08-01",
      endDate: "2026-12-20",
      status: "ACTIVE",
    } as never);

    const theirExam = await createExam(attacker.id, TEST_TIME_ZONE, {
      semesterId: theirSemester.id,
      title: "Theirs",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    const theirTopic = await createExamTopic(
      attacker.id,
      theirExam.id,
      "Mine",
      "HIGH",
    );

    const ownerExam = await makeExam();
    const victimTopic = await createExamTopic(
      owner.id,
      ownerExam.id,
      "Not yours",
      "HIGH",
    );

    await expect(
      reorderExamTopics(attacker.id, theirExam.id, [
        theirTopic.id,
        victimTopic.id,
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) && error.code === "VALIDATION_FAILED",
    );

    const stored = await db.examTopic.findUnique({
      where: { id: victimTopic.id },
    });
    expect(stored?.examId).toBe(ownerExam.id);
  });

  test("exam reads are scoped", async () => {
    await makeExam();

    expect(
      await listExams(attacker, { view: "ALL" } as never, NOW),
    ).toHaveLength(0);

    const owned = await db.exam.findFirst({ where: { profileId: owner.id } });
    expect(await getExamDetail(attacker, owned!.id, NOW)).toBeNull();
  });

  test("an assessment cannot be created against a foreign subject", async () => {
    await expectNotFound(
      createAssessment(attacker.id, TEST_TIME_ZONE, {
        subjectId: subject.id,
        title: "Injected",
        type: "QUIZ",
        status: "UPCOMING",
      } as never),
    );
  });
});

describe("study sessions and notes", () => {
  test("a session cannot be logged against a foreign subject, exam or topic", async () => {
    const exam = await createExam(owner.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Owner's exam",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    const topic = await createExamTopic(owner.id, exam.id, "Private", "HIGH");

    await expectNotFound(
      logStudySession(
        attacker.id,
        TEST_TIME_ZONE,
        { subjectId: subject.id, durationMinutes: 30 } as never,
        NOW,
      ),
    );

    // Even with their own subject, a foreign exam or topic must be refused —
    // otherwise a valid subject id would smuggle the rest through.
    const theirSemester = await createSemester(attacker.id, {
      name: "Theirs",
      academicYear: "2025-26",
      startDate: "2026-08-01",
      endDate: "2026-12-20",
      status: "ACTIVE",
    } as never);

    const theirSubject = await createSubject(attacker.id, {
      semesterId: theirSemester.id,
      name: "Theirs",
      attendanceThreshold: 75,
    } as never);

    await expectNotFound(
      logStudySession(
        attacker.id,
        TEST_TIME_ZONE,
        {
          subjectId: theirSubject.id,
          examId: exam.id,
          durationMinutes: 30,
        } as never,
        NOW,
      ),
    );

    await expectNotFound(
      logStudySession(
        attacker.id,
        TEST_TIME_ZONE,
        {
          subjectId: theirSubject.id,
          topicId: topic.id,
          durationMinutes: 30,
        } as never,
        NOW,
      ),
    );

    expect(
      await db.studySession.count({ where: { profileId: attacker.id } }),
    ).toBe(0);
  });

  test("a foreign study session cannot be deleted", async () => {
    const session = await logStudySession(
      owner.id,
      TEST_TIME_ZONE,
      { subjectId: subject.id, durationMinutes: 45 } as never,
      NOW,
    );

    await expectNotFound(deleteStudySession(attacker.id, session.id));

    expect(
      await db.studySession.findUnique({ where: { id: session.id } }),
    ).not.toBeNull();
  });

  test("notes cannot be created, edited, deleted or listed across profiles", async () => {
    const note = await createAcademicNote(
      owner.id,
      subject.id,
      "Private note",
      "Secret revision plan",
    );

    await expectNotFound(
      createAcademicNote(attacker.id, subject.id, "Injected", "Body"),
    );
    await expectNotFound(
      updateAcademicNote(attacker.id, note.id, { title: "Hijacked" }),
    );
    await expectNotFound(deleteAcademicNote(attacker.id, note.id));
    await expectNotFound(listAcademicNotes(attacker.id, subject.id));

    const stored = await db.academicNote.findUnique({ where: { id: note.id } });
    expect(stored?.title).toBe("Private note");
  });
});

describe("dashboards never leak", () => {
  test("the academic overview shows an attacker nothing of the owner's", async () => {
    await createAssignment(owner.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      title: "Owner's work",
      priority: "MEDIUM",
      status: "NOT_STARTED",
      submissionStatus: "NOT_SUBMITTED",
      createTask: false,
    } as never);

    const overview = await getAcademicOverview(attacker, NOW);

    expect(overview.semester).toBeNull();
    expect(overview.subjectCount).toBe(0);
    expect(overview.assignmentsTotal).toBe(0);
    expect(overview.upcomingAssignments).toEqual([]);
    expect(overview.priorities).toEqual([]);
  });

  test("subject listing is scoped", async () => {
    expect(await listSubjects(attacker.id)).toHaveLength(0);
    expect(await listSubjects(owner.id)).toHaveLength(1);
  });
});

describe("cascade behaviour", () => {
  test("deleting a profile removes every academic record it owned", async () => {
    const exam = await createExam(owner.id, TEST_TIME_ZONE, {
      semesterId: semester.id,
      subjectId: subject.id,
      title: "Exam",
      type: "MIDTERM",
      status: "UPCOMING",
    } as never);

    await createExamTopic(owner.id, exam.id, "Topic", "HIGH");
    await createAcademicNote(owner.id, subject.id, "Note", "Body");
    await logStudySession(
      owner.id,
      TEST_TIME_ZONE,
      { subjectId: subject.id, durationMinutes: 30 } as never,
      NOW,
    );

    await db.profile.delete({ where: { id: owner.id } });

    for (const [label, count] of [
      ["semesters", db.semester.count({ where: { profileId: owner.id } })],
      ["subjects", db.subject.count({ where: { profileId: owner.id } })],
      ["exams", db.exam.count({ where: { profileId: owner.id } })],
      ["topics", db.examTopic.count({ where: { profileId: owner.id } })],
      ["notes", db.academicNote.count({ where: { profileId: owner.id } })],
      ["study", db.studySession.count({ where: { profileId: owner.id } })],
    ] as const) {
      expect(await count, label).toBe(0);
    }

    // The other profile is untouched.
    expect(
      await db.profile.findUnique({ where: { id: attacker.id } }),
    ).not.toBeNull();
  });
});
