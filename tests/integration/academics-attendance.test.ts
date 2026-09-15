import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Semester, Subject } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { instantFromLocalTime, localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import {
  clearAttendance,
  getAttendanceCounts,
  getAttendanceSummary,
  getOverallAttendance,
  getSemesterAttendance,
  markAttendance,
} from "@/services/academics/attendance.service";
import {
  createSemester,
  createSubject,
} from "@/services/academics/semester.service";
import {
  createClassSession,
  createSchedule,
  deleteSchedule,
  generateClassSessions,
  listClassSessions,
  setClassSessionStatus,
} from "@/services/academics/timetable.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * The timetable ↔ attendance relationship, against a real database.
 *
 * The scenarios that matter most are the ones a single-table design gets
 * wrong: cancelling one occurrence, changing a rule mid-term, and deleting a
 * rule that already has history behind it.
 */

/** 2026-09-15 is a TUESDAY. 10:00 in Kolkata. */
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
    startDate: "2026-01-05",
    endDate: "2026-05-30",
    status: "ACTIVE",
  } as never);

  subject = await createSubject(profile.id, {
    semesterId: semester.id,
    name: "Cloud Computing",
    code: "CC-301",
    attendanceThreshold: 75,
  } as never);
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

async function makeMondaySchedule() {
  return createSchedule(profile.id, {
    subjectId: subject.id,
    dayOfWeek: 1, // Monday
    startTime: "10:00",
    endTime: "11:00",
    sessionType: "LECTURE",
  } as never);
}

describe("generateClassSessions", () => {
  test("materialises a weekly rule into real occurrences", async () => {
    await makeMondaySchedule();

    // 2026-09-14 to 2026-10-12 contains five Mondays.
    const result = await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    expect(result.created).toBe(5);

    const sessions = await db.classSession.findMany({
      where: { profileId: profile.id },
      orderBy: { startAt: "asc" },
    });

    expect(sessions).toHaveLength(5);
    // Every occurrence lands on a Monday in the student's own zone.
    for (const session of sessions) {
      expect(localDateKey(session.startAt, TEST_TIME_ZONE)).toMatch(
        /^2026-(09|10)-\d{2}$/,
      );
    }
  });

  test("occurrences carry the rule's wall-clock time in the student's zone", async () => {
    await makeMondaySchedule();

    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
    } as never);

    const session = await db.classSession.findFirst({
      where: { profileId: profile.id },
    });

    // 10:00 IST on 2026-09-14 is 04:30Z.
    expect(session?.startAt.toISOString()).toBe("2026-09-14T04:30:00.000Z");
    expect(session?.endAt.toISOString()).toBe("2026-09-14T05:30:00.000Z");
  });

  test("IS IDEMPOTENT — re-running creates nothing new", async () => {
    await makeMondaySchedule();

    const first = await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    const second = await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    expect(first.created).toBe(5);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(5);

    expect(
      await db.classSession.count({ where: { profileId: profile.id } }),
    ).toBe(5);
  });

  test("respects a rule's effective window, so a mid-term change is clean", async () => {
    // The old rule stops applying after 28 September.
    await createSchedule(profile.id, {
      subjectId: subject.id,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "11:00",
      sessionType: "LECTURE",
      effectiveTo: "2026-09-28",
    } as never);

    // The replacement starts the following Monday, at a different time.
    await createSchedule(profile.id, {
      subjectId: subject.id,
      dayOfWeek: 1,
      startTime: "14:00",
      endTime: "15:00",
      sessionType: "LECTURE",
      effectiveFrom: "2026-10-05",
    } as never);

    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    const sessions = await db.classSession.findMany({
      where: { profileId: profile.id },
      orderBy: { startAt: "asc" },
    });

    // 3 Mondays under the old rule (14, 21, 28) + 2 under the new (5, 12).
    expect(sessions).toHaveLength(5);
    expect(sessions[0]?.startAt.toISOString()).toBe("2026-09-14T04:30:00.000Z");
    // The last two are at 14:00 IST = 08:30Z.
    expect(sessions.at(-1)?.startAt.toISOString()).toBe(
      "2026-10-12T08:30:00.000Z",
    );
  });

  test("generates nothing when no rule matches the range", async () => {
    await makeMondaySchedule();

    // Tuesday to Sunday — no Mondays.
    const result = await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-15",
      toDate: "2026-09-20",
    } as never);

    expect(result.created).toBe(0);
  });
});

describe("cancelling one occurrence", () => {
  test("does not touch the recurring rule", async () => {
    const schedule = await makeMondaySchedule();

    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    const sessions = await db.classSession.findMany({
      where: { profileId: profile.id },
      orderBy: { startAt: "asc" },
    });

    await setClassSessionStatus(profile.id, sessions[0]!.id, "CANCELLED");

    // The rule is untouched, and the other four Mondays still stand.
    const rule = await db.classSchedule.findUnique({
      where: { id: schedule.id },
    });
    expect(rule?.isActive).toBe(true);

    const stillScheduled = await db.classSession.count({
      where: { profileId: profile.id, status: "SCHEDULED" },
    });
    expect(stillScheduled).toBe(4);
  });

  test("removes any attendance already marked for that day", async () => {
    await makeMondaySchedule();
    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-09-14",
    } as never);

    const session = (await db.classSession.findFirst({
      where: { profileId: profile.id },
    }))!;

    await markAttendance(profile.id, session.id, "ABSENT");
    expect(
      await db.attendanceRecord.count({ where: { profileId: profile.id } }),
    ).toBe(1);

    await setClassSessionStatus(profile.id, session.id, "CANCELLED");

    // Attendance for a class that did not happen is not a fact about the
    // student, and would otherwise quietly distort the percentage.
    expect(
      await db.attendanceRecord.count({ where: { profileId: profile.id } }),
    ).toBe(0);
  });
});

describe("deleting a recurring rule", () => {
  test("keeps past occurrences and their attendance", async () => {
    const schedule = await makeMondaySchedule();

    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-09-21",
    } as never);

    const session = (await db.classSession.findFirst({
      where: { profileId: profile.id },
      orderBy: { startAt: "asc" },
    }))!;

    await markAttendance(profile.id, session.id, "PRESENT");

    await deleteSchedule(profile.id, schedule.id);

    // `scheduleId` is SetNull — the history survives as ad-hoc records.
    const survivors = await db.classSession.findMany({
      where: { profileId: profile.id },
    });

    expect(survivors).toHaveLength(2);
    expect(survivors.every((entry) => entry.scheduleId === null)).toBe(true);

    expect(
      await db.attendanceRecord.count({ where: { profileId: profile.id } }),
    ).toBe(1);
  });
});

describe("markAttendance", () => {
  async function makeSession(dateKey = "2026-09-14") {
    return createClassSession(profile.id, TEST_TIME_ZONE, {
      subjectId: subject.id,
      date: dateKey,
      startTime: "10:00",
      endTime: "11:00",
      sessionType: "LECTURE",
    } as never);
  }

  test("records the status and completes the class", async () => {
    const session = await makeSession();

    const record = await markAttendance(profile.id, session.id, "PRESENT");

    expect(record.status).toBe("PRESENT");
    expect(record.subjectId).toBe(subject.id);

    // A class you attended has, by definition, happened.
    const updated = await db.classSession.findUnique({
      where: { id: session.id },
    });
    expect(updated?.status).toBe("COMPLETED");
  });

  test("re-marking corrects the record rather than adding a second", async () => {
    const session = await makeSession();

    await markAttendance(profile.id, session.id, "ABSENT");
    await markAttendance(profile.id, session.id, "PRESENT");

    const records = await db.attendanceRecord.findMany({
      where: { classSessionId: session.id },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe("PRESENT");
  });

  test("REFUSES to mark a cancelled class", async () => {
    const session = await makeSession();
    await setClassSessionStatus(profile.id, session.id, "CANCELLED");

    await expect(
      markAttendance(profile.id, session.id, "PRESENT"),
    ).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "CONFLICT",
    );
  });

  test("clearing returns the class to 'not yet recorded'", async () => {
    const session = await makeSession();
    await markAttendance(profile.id, session.id, "ABSENT");

    await clearAttendance(profile.id, session.id);

    // Unmarked is NOT the same as absent — it counts toward nothing.
    expect(
      await db.attendanceRecord.count({
        where: { classSessionId: session.id },
      }),
    ).toBe(0);

    const restored = await db.classSession.findUnique({
      where: { id: session.id },
    });
    expect(restored?.status).toBe("SCHEDULED");
  });
});

describe("attendance aggregation", () => {
  async function markMany(
    present: number,
    absent: number,
    excused = 0,
  ): Promise<void> {
    let day = 1;

    const mark = async (status: "PRESENT" | "ABSENT" | "EXCUSED") => {
      const session = await createClassSession(profile.id, TEST_TIME_ZONE, {
        subjectId: subject.id,
        date: `2026-03-${String(day).padStart(2, "0")}`,
        startTime: "10:00",
        endTime: "11:00",
        sessionType: "LECTURE",
      } as never);

      day += 1;
      await markAttendance(profile.id, session.id, status);
    };

    for (let i = 0; i < present; i += 1) await mark("PRESENT");
    for (let i = 0; i < absent; i += 1) await mark("ABSENT");
    for (let i = 0; i < excused; i += 1) await mark("EXCUSED");
  }

  test("counts present, absent and excused separately", async () => {
    await markMany(8, 2, 3);

    const counts = await getAttendanceCounts(profile.id, subject.id);

    expect(counts).toEqual({ present: 8, absent: 2, excused: 3 });
  });

  test("the summary applies the excused rule and the subject's threshold", async () => {
    await markMany(8, 2, 3);

    const summary = await getAttendanceSummary(profile.id, subject.id, NOW);

    // Excused is struck from the record: 8/10, not 11/13.
    expect(summary.eligible).toBe(10);
    expect(summary.recorded).toBe(13);
    expect(summary.percentage).toBe(80);
    expect(summary.thresholdPercent).toBe(75);
    expect(summary.meetsThreshold).toBe(true);
  });

  test("an unmarked subject reports no percentage rather than zero", async () => {
    const summary = await getAttendanceSummary(profile.id, subject.id, NOW);

    expect(summary.percentage).toBeNull();
    expect(summary.risk).toBe("UNKNOWN");
  });

  test("future SCHEDULED classes feed the recoverability judgement", async () => {
    await markMany(2, 8);

    // Below threshold with nothing left to attend.
    const bleak = await getAttendanceSummary(profile.id, subject.id, NOW);
    expect(bleak.risk).toBe("CRITICAL");

    // Give the student thirty more classes ahead of `NOW`.
    for (let index = 0; index < 30; index += 1) {
      await createClassSession(profile.id, TEST_TIME_ZONE, {
        subjectId: subject.id,
        date: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`,
        startTime: `${String(8 + Math.floor(index / 28)).padStart(2, "0")}:00`,
        endTime: `${String(9 + Math.floor(index / 28)).padStart(2, "0")}:00`,
        sessionType: "LECTURE",
      } as never);
    }

    const recoverable = await getAttendanceSummary(profile.id, subject.id, NOW);
    expect(recoverable.risk).toBe("AT_RISK");
  });

  test("semester attendance covers every subject in one pass", async () => {
    const second = await createSubject(profile.id, {
      semesterId: semester.id,
      name: "Operating Systems",
      code: "OS-302",
      attendanceThreshold: 75,
    } as never);

    await markMany(9, 1);

    const rows = await getSemesterAttendance(profile.id, semester.id, NOW);

    expect(rows).toHaveLength(2);

    const cloud = rows.find((row) => row.subjectId === subject.id);
    const os = rows.find((row) => row.subjectId === second.id);

    expect(cloud?.summary.percentage).toBe(90);
    // A subject with no marked classes reports null, not 0%.
    expect(os?.summary.percentage).toBeNull();
  });

  test("overall attendance POOLS classes rather than averaging percentages", async () => {
    // Cloud: 1/1 = 100%. OS: 5/9 ≈ 55.6%.
    // Averaging the percentages gives 77.8%; pooling gives 6/10 = 60%.
    // Pooling is correct — a one-class subject must not outweigh a nine-class
    // one.
    const second = await createSubject(profile.id, {
      semesterId: semester.id,
      name: "Operating Systems",
      attendanceThreshold: 75,
    } as never);

    const mark = async (
      subjectId: string,
      dateKey: string,
      status: "PRESENT" | "ABSENT",
    ) => {
      const session = await createClassSession(profile.id, TEST_TIME_ZONE, {
        subjectId,
        date: dateKey,
        startTime: "10:00",
        endTime: "11:00",
        sessionType: "LECTURE",
      } as never);

      await markAttendance(profile.id, session.id, status);
    };

    await mark(subject.id, "2026-03-02", "PRESENT");

    for (let index = 0; index < 5; index += 1) {
      await mark(second.id, `2026-03-1${index}`, "PRESENT");
    }
    for (let index = 0; index < 4; index += 1) {
      await mark(second.id, `2026-03-2${index}`, "ABSENT");
    }

    const overall = await getOverallAttendance(profile.id, semester.id, NOW);

    expect(overall?.counts).toEqual({ present: 6, absent: 4, excused: 0 });
    expect(overall?.percentage).toBe(60);
  });

  test("overall is null when the semester has no subjects", async () => {
    await db.subject.deleteMany({ where: { profileId: profile.id } });

    expect(await getOverallAttendance(profile.id, semester.id, NOW)).toBeNull();
  });
});

describe("listClassSessions", () => {
  test("filters by date range in the student's zone", async () => {
    await makeMondaySchedule();
    await generateClassSessions(profile.id, TEST_TIME_ZONE, {
      fromDate: "2026-09-14",
      toDate: "2026-10-12",
    } as never);

    const firstWeek = await listClassSessions(profile.id, {
      from: instantFromLocalTime(2026, 9, 14, 0, TEST_TIME_ZONE),
      to: instantFromLocalTime(2026, 9, 21, 0, TEST_TIME_ZONE),
    });

    expect(firstWeek).toHaveLength(1);
  });
});
