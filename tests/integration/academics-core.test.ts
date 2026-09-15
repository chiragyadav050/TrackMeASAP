import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile, Semester, Subject } from "@/generated/prisma/client";
import { isAppError } from "@/lib/errors";
import { db } from "@/server/db";
import { fromDateOnly } from "@/services/academics/academic.dates";
import {
  archiveSemester,
  createSemester,
  createSubject,
  deleteSemester,
  deleteSubject,
  getCurrentSemester,
  listSemesters,
  listSubjects,
  resolveActiveSemester,
  setCurrentSemester,
  setSubjectArchived,
  updateSemester,
  updateSubject,
} from "@/services/academics/semester.service";
import { cleanupTestData, createTestProfile, disconnect } from "./helpers";

/**
 * Semesters and subjects against a real database.
 *
 * The centrepiece here is the one-current-semester rule, which is enforced in
 * two places (a transaction AND a partial unique index) and therefore has to
 * be verified in both.
 */

let profile: Profile;

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

const semesterInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Semester 6",
  academicYear: "2025-26",
  startDate: "2026-01-05",
  endDate: "2026-05-30",
  status: "UPCOMING" as const,
  ...overrides,
});

async function makeSemester(overrides: Record<string, unknown> = {}) {
  return createSemester(profile.id, semesterInput(overrides) as never);
}

async function makeSubject(
  semester: Semester,
  overrides: Record<string, unknown> = {},
): Promise<Subject> {
  return createSubject(profile.id, {
    semesterId: semester.id,
    name: "Cloud Computing",
    code: "CC-301",
    facultyName: "Professor X",
    credits: 4,
    attendanceThreshold: 75,
    ...overrides,
  } as never);
}

describe("createSemester", () => {
  test("persists the supplied fields", async () => {
    const semester = await makeSemester();

    const stored = await db.semester.findUnique({ where: { id: semester.id } });

    expect(stored?.name).toBe("Semester 6");
    expect(stored?.academicYear).toBe("2025-26");
    expect(stored?.status).toBe("UPCOMING");
    expect(stored?.isCurrent).toBe(false);
    expect(stored?.profileId).toBe(profile.id);
  });

  test("stores dates as DATE-ONLY values that round-trip unchanged", async () => {
    // The whole point of `@db.Date`: no zone conversion, so 5 January stays
    // 5 January for a user in Kolkata, Auckland or Los Angeles.
    const semester = await makeSemester();

    expect(fromDateOnly(semester.startDate)).toBe("2026-01-05");
    expect(fromDateOnly(semester.endDate)).toBe("2026-05-30");
  });
});

describe("the one-current-semester rule", () => {
  test("setting a current semester clears the previous one", async () => {
    const first = await makeSemester({ name: "Semester 5" });
    const second = await makeSemester({ name: "Semester 6" });

    await setCurrentSemester(profile.id, first.id);
    await setCurrentSemester(profile.id, second.id);

    const current = await getCurrentSemester(profile.id);
    expect(current?.id).toBe(second.id);

    const stillCurrent = await db.semester.count({
      where: { profileId: profile.id, isCurrent: true },
    });
    expect(stillCurrent).toBe(1);
  });

  test("setting current also marks the semester ACTIVE", async () => {
    const semester = await makeSemester();

    const updated = await setCurrentSemester(profile.id, semester.id);

    expect(updated.isCurrent).toBe(true);
    expect(updated.status).toBe("ACTIVE");
  });

  test("THE DATABASE ITSELF refuses a second current semester", async () => {
    // The service clears the old flag in a transaction, but that is the
    // mechanism, not the guarantee. This bypasses the service entirely to
    // prove the partial unique index holds even if a future code path forgets.
    const first = await makeSemester({ name: "A" });
    const second = await makeSemester({ name: "B" });

    await setCurrentSemester(profile.id, first.id);

    await expect(
      db.semester.update({
        where: { id: second.id },
        data: { isCurrent: true },
      }),
    ).rejects.toThrow();

    expect(
      await db.semester.count({
        where: { profileId: profile.id, isCurrent: true },
      }),
    ).toBe(1);
  });

  test("two different profiles may each have a current semester", async () => {
    // The index is partial AND scoped per profile — it must not become a
    // global singleton.
    const other = await createTestProfile();

    const mine = await makeSemester();
    const theirs = await createSemester(other.id, semesterInput() as never);

    await setCurrentSemester(profile.id, mine.id);
    await setCurrentSemester(other.id, theirs.id);

    expect((await getCurrentSemester(profile.id))?.id).toBe(mine.id);
    expect((await getCurrentSemester(other.id))?.id).toBe(theirs.id);
  });

  test("a new account has no current semester", async () => {
    expect(await getCurrentSemester(profile.id)).toBeNull();
  });
});

describe("resolveActiveSemester", () => {
  test("prefers the current semester", async () => {
    await makeSemester({
      name: "Old",
      startDate: "2025-01-05",
      endDate: "2025-05-30",
    });
    const current = await makeSemester({ name: "Now" });

    await setCurrentSemester(profile.id, current.id);

    expect((await resolveActiveSemester(profile.id))?.id).toBe(current.id);
  });

  test("falls back to the most recent when none is marked current", async () => {
    await makeSemester({
      name: "Older",
      startDate: "2025-01-05",
      endDate: "2025-05-30",
    });
    const newer = await makeSemester({ name: "Newer" });

    expect((await resolveActiveSemester(profile.id))?.id).toBe(newer.id);
  });

  test("ignores archived semesters in the fallback", async () => {
    const archived = await makeSemester({ name: "Archived" });
    await archiveSemester(profile.id, archived.id);

    expect(await resolveActiveSemester(profile.id)).toBeNull();
  });
});

describe("archiveSemester", () => {
  test("archives a non-current semester", async () => {
    const semester = await makeSemester();

    const archived = await archiveSemester(profile.id, semester.id);

    expect(archived.status).toBe("ARCHIVED");
    expect(archived.isCurrent).toBe(false);
  });

  test("REFUSES to archive the current semester", async () => {
    // Silently leaving the account with no current semester would empty every
    // academic surface with no explanation.
    const semester = await makeSemester();
    await setCurrentSemester(profile.id, semester.id);

    await expect(archiveSemester(profile.id, semester.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "CONFLICT",
    );

    expect((await getCurrentSemester(profile.id))?.id).toBe(semester.id);
  });

  test("archived semesters leave the default list but remain retrievable", async () => {
    const kept = await makeSemester({ name: "Kept" });
    const archived = await makeSemester({ name: "Gone" });
    await archiveSemester(profile.id, archived.id);

    const active = await listSemesters(profile.id);
    expect(active.map((entry) => entry.id)).toEqual([kept.id]);

    const all = await listSemesters(profile.id, true);
    expect(all).toHaveLength(2);
  });
});

describe("deleteSemester", () => {
  test("cascades to subjects and everything beneath them", async () => {
    const semester = await makeSemester();
    const subject = await makeSubject(semester);

    await deleteSemester(profile.id, semester.id);

    expect(
      await db.subject.findUnique({ where: { id: subject.id } }),
    ).toBeNull();
  });

  test("refuses to delete the current semester", async () => {
    const semester = await makeSemester();
    await setCurrentSemester(profile.id, semester.id);

    await expect(deleteSemester(profile.id, semester.id)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "CONFLICT",
    );
  });
});

describe("updateSemester", () => {
  test("changes the fields supplied", async () => {
    const semester = await makeSemester();

    const updated = await updateSemester(profile.id, {
      semesterId: semester.id,
      name: "Semester 6 (revised)",
      academicYear: "2025-26",
      startDate: "2026-01-12",
      endDate: "2026-06-05",
      status: "ACTIVE",
    } as never);

    expect(updated.name).toBe("Semester 6 (revised)");
    expect(fromDateOnly(updated.startDate)).toBe("2026-01-12");
    expect(updated.status).toBe("ACTIVE");
  });
});

describe("subjects", () => {
  test("are created against an owned semester", async () => {
    const semester = await makeSemester();
    const subject = await makeSubject(semester);

    expect(subject.name).toBe("Cloud Computing");
    expect(subject.code).toBe("CC-301");
    expect(subject.credits).toBe(4);
    expect(subject.attendanceThreshold).toBe(75);
    expect(subject.semesterId).toBe(semester.id);
  });

  test("default to a 75% attendance threshold, overridable per subject", async () => {
    // Labs and theory papers routinely differ; no single rule can be
    // hard-coded.
    const semester = await makeSemester();

    const theory = await makeSubject(semester, { name: "Theory" });
    const lab = await makeSubject(semester, {
      name: "Lab",
      attendanceThreshold: 85,
    });

    expect(theory.attendanceThreshold).toBe(75);
    expect(lab.attendanceThreshold).toBe(85);
  });

  test("can be updated, including moving to another owned semester", async () => {
    const first = await makeSemester({ name: "S5" });
    const second = await makeSemester({ name: "S6" });
    const subject = await makeSubject(first);

    const moved = await updateSubject(profile.id, {
      subjectId: subject.id,
      semesterId: second.id,
      name: "Cloud Computing II",
    } as never);

    expect(moved.semesterId).toBe(second.id);
    expect(moved.name).toBe("Cloud Computing II");
  });

  test("archiving removes them from the default list but keeps the row", async () => {
    const semester = await makeSemester();
    const subject = await makeSubject(semester);

    await setSubjectArchived(profile.id, subject.id, true);

    expect(await listSubjects(profile.id)).toHaveLength(0);
    expect(
      await listSubjects(profile.id, { includeArchived: true }),
    ).toHaveLength(1);

    await setSubjectArchived(profile.id, subject.id, false);
    expect(await listSubjects(profile.id)).toHaveLength(1);
  });

  test("search matches name, code and faculty", async () => {
    const semester = await makeSemester();
    await makeSubject(semester, { name: "Cloud Computing", code: "CC-301" });
    await makeSubject(semester, {
      name: "Operating Systems",
      code: "OS-302",
      facultyName: "Dr Rao",
    });

    expect(await listSubjects(profile.id, { search: "cloud" })).toHaveLength(1);
    expect(await listSubjects(profile.id, { search: "OS-3" })).toHaveLength(1);
    expect(await listSubjects(profile.id, { search: "rao" })).toHaveLength(1);
    expect(await listSubjects(profile.id, { search: "zzz" })).toHaveLength(0);
  });

  test("deleting a subject does NOT delete the tasks done for it", async () => {
    // `Task.subjectId` is SetNull — work the student actually did survives the
    // subject being removed.
    const semester = await makeSemester();
    const subject = await makeSubject(semester);

    const task = await db.task.create({
      data: {
        profileId: profile.id,
        title: "Read chapter 4",
        subjectId: subject.id,
      },
    });

    await deleteSubject(profile.id, subject.id);

    const survivor = await db.task.findUnique({ where: { id: task.id } });

    expect(survivor).not.toBeNull();
    expect(survivor?.subjectId).toBeNull();
  });
});
