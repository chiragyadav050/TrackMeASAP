import "server-only";

import type { Prisma, Profile } from "@/generated/prisma/client";
import {
  endOfLocalDay,
  formatInTimeZone,
  localDayDifference,
  startOfLocalDay,
  startOfLocalDayOffset,
} from "@/lib/time";
import { db } from "@/server/db";
import {
  calculatePreparation,
  daysUntil,
  isAssignmentOverdue,
  marksPercentage,
  semesterProgress,
  summarisePreparation,
} from "@/services/academics/academic.derive";
import {
  assignmentToPriorityItem,
  attendanceToPriorityItem,
  examToPriorityItem,
  rankAcademicItems,
  type AcademicPriorityItem,
} from "@/services/academics/academic.priority";
import type {
  AssignmentFilters,
  ExamFilters,
} from "@/services/academics/academic.schema";
import {
  getOverallAttendance,
  getSemesterAttendance,
} from "@/services/academics/attendance.service";
import { resolveActiveSemester } from "@/services/academics/semester.service";
import { getStudySummary } from "@/services/academics/study.service";
import type {
  AcademicOverviewDto,
  AcademicPriorityDto,
  AssignmentDto,
  ExamDto,
} from "@/types/academics";

/**
 * Academic reads.
 *
 * ===========================================================================
 * THE AI-READY SURFACE (brief §54)
 * ===========================================================================
 * The exported functions below are deliberately shaped as the typed tools
 * Phase 8 will expose to Gemini:
 *
 *   getCurrentSemester()      → semester.service.ts
 *   getUpcomingAssignments()
 *   getUpcomingExams()
 *   getAttendanceStatus()
 *   getStudySummary()         → study.service.ts
 *   getAcademicPriorities()
 *
 * Each takes a profile and returns a serialisable DTO with no ambient state,
 * which is exactly what a function-calling tool needs. Nothing here calls a
 * model, and nothing is generated.
 * ===========================================================================
 *
 * Every query is scoped by a `profileId` from the Clerk session. As in the
 * task module, all date-derived display strings are produced HERE, in the
 * profile's zone, and handed to the client finished.
 */

const TIME_HELPERS = { localDayDifference } as const;

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

type AssignmentRow = Prisma.AssignmentGetPayload<{
  include: {
    subject: { select: { id: true; name: true; code: true; colorKey: true } };
  };
}>;

const ASSIGNMENT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true, colorKey: true } },
} satisfies Prisma.AssignmentInclude;

export function toAssignmentDto(
  row: AssignmentRow,
  now: Date,
  profile: Pick<Profile, "timeZone" | "locale">,
): AssignmentDto {
  const overdue = isAssignmentOverdue(row, now, profile.timeZone);
  const days = row.dueAt
    ? localDayDifference(now, row.dueAt, profile.timeZone)
    : null;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    subjectCode: row.subject.code,
    semesterId: row.semesterId,
    status: row.status,
    submissionStatus: row.submissionStatus,
    priority: row.priority,
    dueAt: row.dueAt,
    isAllDay: row.isAllDay,
    dueLabel: row.dueAt
      ? formatDueLabel(row.dueAt, now, profile, row.isAllDay)
      : null,
    daysUntilDue: days,
    isOverdue: overdue,
    estimatedMinutes: row.estimatedMinutes,
    actualMinutes: row.actualMinutes,
    marksObtained: row.marksObtained,
    maxMarks: row.maxMarks,
    marksPercent: marksPercentage(row),
    submissionUrl: row.submissionUrl,
    taskId: row.taskId,
    isArchived: row.archivedAt !== null,
    completedAt: row.completedAt,
    submittedAt: row.submittedAt,
  };
}

function formatDueLabel(
  dueAt: Date,
  now: Date,
  profile: Pick<Profile, "timeZone" | "locale">,
  isAllDay: boolean,
): string {
  const days = localDayDifference(now, dueAt, profile.timeZone);

  const dayPart =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : days === -1
          ? "Yesterday"
          : formatInTimeZone(
              dueAt,
              profile.timeZone,
              { day: "numeric", month: "short" },
              profile.locale,
            );

  if (isAllDay) {
    return dayPart;
  }

  const timePart = formatInTimeZone(
    dueAt,
    profile.timeZone,
    { hour: "numeric", minute: "2-digit" },
    profile.locale,
  );

  return `${dayPart}, ${timePart}`;
}

/** Translates a view filter into a WHERE clause. Exported for testing. */
export function buildAssignmentWhere(
  profileId: string,
  filters: AssignmentFilters,
  now: Date,
  timeZone: string,
): Prisma.AssignmentWhereInput {
  const where: Prisma.AssignmentWhereInput = { profileId };

  where.archivedAt = filters.view === "ARCHIVED" ? { not: null } : null;

  const openWork: Prisma.AssignmentWhereInput = {
    status: { notIn: ["CANCELLED"] },
    NOT: {
      AND: [
        { status: "COMPLETED" },
        { submissionStatus: { in: ["SUBMITTED", "LATE", "ACCEPTED"] } },
      ],
    },
  };

  // Overdue expressed as a query rather than read from a column — the same
  // derived-not-stored stance as Tasks, with the same all-day semantics.
  const overdueClause: Prisma.AssignmentWhereInput = {
    ...openWork,
    OR: [
      { isAllDay: false, dueAt: { lt: now } },
      { isAllDay: true, dueAt: { lt: startOfLocalDay(now, timeZone) } },
    ],
  };

  const dayStart = startOfLocalDay(now, timeZone);

  switch (filters.view) {
    case "OPEN":
      Object.assign(where, openWork);
      break;

    case "OVERDUE":
      Object.assign(where, overdueClause);
      break;

    case "DUE_TODAY":
      Object.assign(where, openWork);
      where.dueAt = {
        gte: dayStart,
        lt: startOfLocalDayOffset(now, timeZone, 1),
      };
      break;

    case "DUE_THIS_WEEK":
      Object.assign(where, openWork);
      where.dueAt = {
        gte: dayStart,
        lt: startOfLocalDayOffset(now, timeZone, 7),
      };
      break;

    case "UPCOMING":
      Object.assign(where, openWork);
      where.dueAt = { gte: dayStart };
      break;

    case "COMPLETED":
      where.status = "COMPLETED";
      break;

    case "SUBMITTED":
      where.submissionStatus = { in: ["SUBMITTED", "LATE", "ACCEPTED"] };
      break;

    case "GRADED":
      // "Graded" is not a status — it is having a mark.
      where.marksObtained = { not: null };
      break;

    default:
      break;
  }

  if (filters.semesterId) where.semesterId = filters.semesterId;
  if (filters.subjectId) where.subjectId = filters.subjectId;
  if (filters.priority) where.priority = filters.priority;

  if (filters.search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" } },
          { description: { contains: filters.search, mode: "insensitive" } },
          {
            subject: {
              name: { contains: filters.search, mode: "insensitive" },
            },
          },
        ],
      },
    ];
  }

  return where;
}

function assignmentOrderBy(
  sort: AssignmentFilters["sort"],
): Prisma.AssignmentOrderByWithRelationInput[] {
  switch (sort) {
    case "PRIORITY":
      return [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }];
    case "RECENTLY_CREATED":
      return [{ createdAt: "desc" }];
    case "SUBJECT":
      return [
        { subject: { name: "asc" } },
        { dueAt: { sort: "asc", nulls: "last" } },
      ];
    case "DUE_DATE":
    default:
      return [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }];
  }
}

export async function listAssignments(
  profile: Profile,
  filters: AssignmentFilters,
  now: Date = new Date(),
): Promise<readonly AssignmentDto[]> {
  const rows = await db.assignment.findMany({
    where: buildAssignmentWhere(profile.id, filters, now, profile.timeZone),
    orderBy: assignmentOrderBy(filters.sort),
    include: ASSIGNMENT_INCLUDE,
    take: 200,
  });

  return rows.map((row) => toAssignmentDto(row, now, profile));
}

export async function getAssignment(
  profile: Profile,
  assignmentId: string,
  now: Date = new Date(),
): Promise<AssignmentDto | null> {
  const row = await db.assignment.findFirst({
    where: { id: assignmentId, profileId: profile.id },
    include: ASSIGNMENT_INCLUDE,
  });

  return row ? toAssignmentDto(row, now, profile) : null;
}

/** AI-tool shape: what is due soon and still outstanding. */
export async function getUpcomingAssignments(
  profile: Profile,
  withinDays = 14,
  now: Date = new Date(),
): Promise<readonly AssignmentDto[]> {
  const rows = await db.assignment.findMany({
    where: {
      profileId: profile.id,
      archivedAt: null,
      status: { notIn: ["CANCELLED"] },
      NOT: {
        AND: [
          { status: "COMPLETED" },
          { submissionStatus: { in: ["SUBMITTED", "LATE", "ACCEPTED"] } },
        ],
      },
      dueAt: {
        gte: startOfLocalDay(now, profile.timeZone),
        lt: startOfLocalDayOffset(now, profile.timeZone, withinDays),
      },
    },
    orderBy: { dueAt: "asc" },
    include: ASSIGNMENT_INCLUDE,
    take: 50,
  });

  return rows.map((row) => toAssignmentDto(row, now, profile));
}

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

const EXAM_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  topics: { select: { isCompleted: true, importance: true, confidence: true } },
} satisfies Prisma.ExamInclude;

type ExamRow = Prisma.ExamGetPayload<{ include: typeof EXAM_INCLUDE }>;

export function toExamDto(
  row: ExamRow,
  now: Date,
  profile: Pick<Profile, "timeZone" | "locale">,
): ExamDto {
  const preparation = summarisePreparation(row.topics);

  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    subjectId: row.subjectId,
    subjectName: row.subject?.name ?? null,
    subjectCode: row.subject?.code ?? null,
    semesterId: row.semesterId,
    startAt: row.startAt,
    dateLabel: row.startAt
      ? formatInTimeZone(
          row.startAt,
          profile.timeZone,
          { weekday: "short", day: "numeric", month: "short" },
          profile.locale,
        )
      : null,
    timeLabel: row.startAt
      ? formatInTimeZone(
          row.startAt,
          profile.timeZone,
          { hour: "numeric", minute: "2-digit" },
          profile.locale,
        )
      : null,
    daysRemaining: daysUntil(row.startAt, now, profile.timeZone),
    durationMinutes: row.durationMinutes,
    location: row.location,
    maxMarks: row.maxMarks,
    marksObtained: row.marksObtained,
    marksPercent: marksPercentage(row),
    notes: row.notes,
    totalTopics: preparation.totalTopics,
    completedTopics: preparation.completedTopics,
    // `null` means tracking has not started — NOT 0% prepared.
    preparationPercent: preparation.percentage,
    remainingHighImportance: preparation.remainingHighImportance,
  };
}

export async function listExams(
  profile: Profile,
  filters: ExamFilters,
  now: Date = new Date(),
): Promise<readonly ExamDto[]> {
  const where: Prisma.ExamWhereInput = { profileId: profile.id };

  if (filters.view === "UPCOMING") where.status = "UPCOMING";
  if (filters.view === "COMPLETED") where.status = "COMPLETED";
  if (filters.semesterId) where.semesterId = filters.semesterId;
  if (filters.subjectId) where.subjectId = filters.subjectId;
  if (filters.type) where.type = filters.type;

  const rows = await db.exam.findMany({
    where,
    orderBy: [{ startAt: { sort: "asc", nulls: "last" } }],
    include: EXAM_INCLUDE,
    take: 100,
  });

  return rows.map((row) => toExamDto(row, now, profile));
}

/** AI-tool shape. */
export async function getUpcomingExams(
  profile: Profile,
  withinDays = 30,
  now: Date = new Date(),
): Promise<readonly ExamDto[]> {
  const rows = await db.exam.findMany({
    where: {
      profileId: profile.id,
      status: "UPCOMING",
      startAt: {
        gte: startOfLocalDay(now, profile.timeZone),
        lt: startOfLocalDayOffset(now, profile.timeZone, withinDays),
      },
    },
    orderBy: { startAt: "asc" },
    include: EXAM_INCLUDE,
    take: 30,
  });

  return rows.map((row) => toExamDto(row, now, profile));
}

export async function getExamDetail(
  profile: Profile,
  examId: string,
  now: Date = new Date(),
) {
  const row = await db.exam.findFirst({
    where: { id: examId, profileId: profile.id },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      topics: { orderBy: { position: "asc" } },
    },
  });

  if (!row) {
    return null;
  }

  return {
    exam: toExamDto({ ...row, topics: row.topics }, now, profile),
    topics: row.topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      description: topic.description,
      importance: topic.importance,
      isCompleted: topic.isCompleted,
      confidence: topic.confidence,
      position: topic.position,
    })),
  };
}

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

/**
 * AI-tool shape: the ranked academic work list.
 *
 * Assembles assignments, exams and attendance warnings into one ordering
 * using the deterministic engine. No model involved.
 */
export async function getAcademicPriorities(
  profile: Profile,
  limit = 10,
  now: Date = new Date(),
): Promise<readonly AcademicPriorityDto[]> {
  const semester = await resolveActiveSemester(profile.id);

  if (!semester) {
    return [];
  }

  const [assignments, exams, attendance] = await Promise.all([
    db.assignment.findMany({
      where: {
        profileId: profile.id,
        archivedAt: null,
        status: { notIn: ["CANCELLED"] },
      },
      include: ASSIGNMENT_INCLUDE,
      take: 100,
    }),
    db.exam.findMany({
      where: { profileId: profile.id, status: "UPCOMING" },
      include: EXAM_INCLUDE,
      take: 50,
    }),
    getSemesterAttendance(profile.id, semester.id, now),
  ]);

  const items: AcademicPriorityItem[] = [
    ...assignments.map((row) =>
      assignmentToPriorityItem(row, row.subject.name, now, profile.timeZone),
    ),
    ...exams.map((row) =>
      examToPriorityItem(
        row,
        row.topics,
        row.subject?.name ?? null,
        now,
        profile.timeZone,
      ),
    ),
    ...attendance.map((entry) =>
      attendanceToPriorityItem(
        { id: entry.subjectId, name: entry.subjectName },
        entry.summary.risk,
      ),
    ),
  ];

  const ranked = rankAcademicItems(items, now, profile.timeZone, TIME_HELPERS);

  return ranked.slice(0, limit).map((entry) => ({
    id: entry.item.id,
    kind: entry.item.kind,
    title: entry.item.title,
    subjectName: entry.item.subjectName,
    dueAt: entry.item.dueAt,
    dueLabel: entry.item.dueAt
      ? formatDueLabel(entry.item.dueAt, now, profile, entry.item.isAllDay)
      : null,
    isOverdue: entry.item.isOverdue,
    preparationPercent: entry.item.preparationPercent,
    attendanceRisk: entry.item.attendanceRisk,
    reasons: entry.score.reasons,
  }));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Everything the Academics overview needs, in one pass.
 *
 * Returns `null` for `semester` when the user has not created one — the page
 * then shows the "start by creating your semester" empty state rather than a
 * dashboard of zeroes pretending to be data.
 */
export async function getAcademicOverview(
  profile: Profile,
  now: Date = new Date(),
): Promise<AcademicOverviewDto> {
  const semester = await resolveActiveSemester(profile.id);

  if (!semester) {
    return {
      semester: null,
      subjectCount: 0,
      attendance: null,
      assignmentsTotal: 0,
      assignmentsCompleted: 0,
      upcomingAssignments: [],
      upcomingExams: [],
      studyWeekMinutes: 0,
      studyTodayMinutes: 0,
      priorities: [],
      attendanceBySubject: [],
    };
  }

  const [
    subjectCount,
    attendance,
    attendanceBySubject,
    assignmentsTotal,
    assignmentsCompleted,
    upcomingAssignments,
    upcomingExams,
    study,
    priorities,
  ] = await Promise.all([
    db.subject.count({
      where: {
        profileId: profile.id,
        semesterId: semester.id,
        archivedAt: null,
      },
    }),
    getOverallAttendance(profile.id, semester.id, now),
    getSemesterAttendance(profile.id, semester.id, now),
    db.assignment.count({
      where: {
        profileId: profile.id,
        semesterId: semester.id,
        archivedAt: null,
        status: { not: "CANCELLED" },
      },
    }),
    db.assignment.count({
      where: {
        profileId: profile.id,
        semesterId: semester.id,
        archivedAt: null,
        status: "COMPLETED",
      },
    }),
    getUpcomingAssignments(profile, 14, now),
    getUpcomingExams(profile, 45, now),
    getStudySummary(profile.id, profile.timeZone, now),
    getAcademicPriorities(profile, 6, now),
  ]);

  return {
    semester: {
      id: semester.id,
      name: semester.name,
      academicYear: semester.academicYear,
      startDate: semester.startDate,
      endDate: semester.endDate,
      status: semester.status,
      isCurrent: semester.isCurrent,
      progressPercent: semesterProgress(
        semester.startDate,
        semester.endDate,
        now,
      ),
    },
    subjectCount,
    attendance,
    attendanceBySubject: attendanceBySubject.map((entry) => ({
      subjectId: entry.subjectId,
      subjectName: entry.subjectName,
      subjectCode: entry.subjectCode,
      percentage: entry.summary.percentage,
      thresholdPercent: entry.summary.thresholdPercent,
      risk: entry.summary.risk,
      canMiss: entry.summary.canMiss,
      mustAttend: entry.summary.mustAttend,
    })),
    assignmentsTotal,
    assignmentsCompleted,
    upcomingAssignments: upcomingAssignments.slice(0, 5),
    upcomingExams: upcomingExams.slice(0, 5),
    studyWeekMinutes: study.weekMinutes,
    studyTodayMinutes: study.todayMinutes,
    priorities,
  };
}

// ---------------------------------------------------------------------------
// Today integration
// ---------------------------------------------------------------------------

/**
 * The academic slice of the Today page.
 *
 * Kept small and cheap — Today already runs the task queries, and this must
 * not double the page's cost. Three narrow queries, all indexed.
 */
export async function getTodayAcademics(
  profile: Profile,
  now: Date = new Date(),
): Promise<{
  dueToday: readonly AssignmentDto[];
  overdue: readonly AssignmentDto[];
  nextExam: ExamDto | null;
  attendanceWarnings: readonly {
    subjectId: string;
    subjectName: string;
    percentage: number | null;
    thresholdPercent: number;
    risk: string;
    mustAttend: number | null;
  }[];
  topPriority: AcademicPriorityDto | null;
}> {
  const semester = await resolveActiveSemester(profile.id);

  if (!semester) {
    return {
      dueToday: [],
      overdue: [],
      nextExam: null,
      attendanceWarnings: [],
      topPriority: null,
    };
  }

  const dayStart = startOfLocalDay(now, profile.timeZone);
  const dayEnd = startOfLocalDayOffset(now, profile.timeZone, 1);

  const openWork: Prisma.AssignmentWhereInput = {
    profileId: profile.id,
    archivedAt: null,
    status: { notIn: ["CANCELLED"] },
    NOT: {
      AND: [
        { status: "COMPLETED" },
        { submissionStatus: { in: ["SUBMITTED", "LATE", "ACCEPTED"] } },
      ],
    },
  };

  const [dueTodayRows, overdueRows, nextExamRow, attendance, priorities] =
    await Promise.all([
      db.assignment.findMany({
        where: { ...openWork, dueAt: { gte: dayStart, lt: dayEnd } },
        include: ASSIGNMENT_INCLUDE,
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
      db.assignment.findMany({
        where: {
          ...openWork,
          OR: [
            { isAllDay: false, dueAt: { lt: now } },
            { isAllDay: true, dueAt: { lt: dayStart } },
          ],
        },
        include: ASSIGNMENT_INCLUDE,
        orderBy: { dueAt: "asc" },
        take: 10,
      }),
      db.exam.findFirst({
        where: {
          profileId: profile.id,
          status: "UPCOMING",
          startAt: { gte: dayStart },
        },
        orderBy: { startAt: "asc" },
        include: EXAM_INCLUDE,
      }),
      getSemesterAttendance(profile.id, semester.id, now),
      getAcademicPriorities(profile, 1, now),
    ]);

  return {
    dueToday: dueTodayRows.map((row) => toAssignmentDto(row, now, profile)),
    overdue: overdueRows.map((row) => toAssignmentDto(row, now, profile)),
    nextExam: nextExamRow ? toExamDto(nextExamRow, now, profile) : null,
    attendanceWarnings: attendance
      .filter(
        (entry) =>
          entry.summary.risk === "CRITICAL" || entry.summary.risk === "AT_RISK",
      )
      .map((entry) => ({
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        percentage: entry.summary.percentage,
        thresholdPercent: entry.summary.thresholdPercent,
        risk: entry.summary.risk,
        mustAttend: entry.summary.mustAttend,
      })),
    topPriority: priorities[0] ?? null,
  };
}

/** AI-tool shape: attendance across the active semester. */
export async function getAttendanceStatus(profile: Profile, now = new Date()) {
  const semester = await resolveActiveSemester(profile.id);

  if (!semester) {
    return { semesterId: null, overall: null, bySubject: [] };
  }

  const [overall, bySubject] = await Promise.all([
    getOverallAttendance(profile.id, semester.id, now),
    getSemesterAttendance(profile.id, semester.id, now),
  ]);

  return { semesterId: semester.id, overall, bySubject };
}

/** Exported so the exam page and the priority engine agree on the figure. */
export { calculatePreparation, endOfLocalDay };
