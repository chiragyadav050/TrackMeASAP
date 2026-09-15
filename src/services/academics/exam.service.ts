import "server-only";

import type {
  Assessment,
  Exam,
  ExamTopic,
  Prisma,
} from "@/generated/prisma/client";
import { validationFailed } from "@/lib/errors";
import { db } from "@/server/db";
import {
  ENTITY_ASSESSMENT,
  ENTITY_EXAM,
  ENTITY_EXAM_TOPIC,
  recordAcademicActivity,
} from "@/services/academics/academic.activity";
import { toInstant } from "@/services/academics/academic.dates";
import {
  requireOwnedAssessment,
  requireOwnedExam,
  requireOwnedSemester,
  requireOwnedSubject,
  requireOwnedTopic,
} from "@/services/academics/academic.ownership";
import type {
  CreateExamInput,
  createAssessmentSchema,
  updateAssessmentSchema,
  updateExamSchema,
} from "@/services/academics/academic.schema";
import type { z } from "zod";

/**
 * Exams, their topic checklists, and the lighter continuous assessments.
 *
 * `Exam` and `Assessment` are separate models rather than one behind a type
 * flag. An exam carries a topic checklist and drives preparation tracking; an
 * assessment is a small dated event with a mark. Merging them would produce a
 * table where half the columns are meaningless for half the rows.
 */

const POSITION_STEP = 1000;

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export async function createExam(
  profileId: string,
  timeZone: string,
  input: CreateExamInput,
): Promise<Exam> {
  await requireOwnedSemester(profileId, input.semesterId);

  if (input.subjectId) {
    await requireOwnedSubject(profileId, input.subjectId);
  }

  const exam = await db.exam.create({
    data: {
      profileId,
      semesterId: input.semesterId,
      subjectId: input.subjectId ?? null,
      title: input.title,
      type: input.type,
      startAt: input.date ? toInstant(input.date, input.time, timeZone) : null,
      durationMinutes: input.durationMinutes ?? null,
      location: input.location ?? null,
      maxMarks: input.maxMarks ?? null,
      marksObtained: input.marksObtained ?? null,
      status: input.status,
      notes: input.notes ?? null,
    },
  });

  await recordAcademicActivity(profileId, ENTITY_EXAM, exam.id, "CREATED", {
    type: exam.type,
  });

  return exam;
}

export async function updateExam(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateExamSchema>,
): Promise<Exam> {
  const existing = await requireOwnedExam(profileId, input.examId);

  if (input.subjectId && input.subjectId !== existing.subjectId) {
    await requireOwnedSubject(profileId, input.subjectId);
  }

  const data: Prisma.ExamUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.durationMinutes !== undefined) {
    data.durationMinutes = input.durationMinutes;
  }
  if (input.maxMarks !== undefined) data.maxMarks = input.maxMarks;
  if (input.marksObtained !== undefined) {
    data.marksObtained = input.marksObtained;
  }

  data.location = input.location ?? null;
  data.notes = input.notes ?? null;

  if (input.date) {
    data.startAt = toInstant(input.date, input.time, timeZone);
  }

  if (input.subjectId !== undefined) {
    data.subject = input.subjectId
      ? { connect: { id: input.subjectId } }
      : { disconnect: true };
  }

  const exam = await db.exam.update({ where: { id: existing.id }, data });

  await recordAcademicActivity(profileId, ENTITY_EXAM, exam.id, "UPDATED");

  return exam;
}

export async function deleteExam(
  profileId: string,
  examId: string,
): Promise<void> {
  const existing = await requireOwnedExam(profileId, examId);

  // Topics cascade. Study sessions do not — `examId` is SetNull, so logged
  // study time survives the exam record being removed.
  await db.exam.delete({ where: { id: existing.id } });

  await recordAcademicActivity(profileId, ENTITY_EXAM, existing.id, "DELETED", {
    title: existing.title.slice(0, 60),
  });
}

export async function getExamWithTopics(profileId: string, examId: string) {
  await requireOwnedExam(profileId, examId);

  return db.exam.findFirst({
    where: { id: examId, profileId },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      topics: { orderBy: { position: "asc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Exam topics
// ---------------------------------------------------------------------------

export async function createExamTopic(
  profileId: string,
  examId: string,
  title: string,
  importance: "LOW" | "MEDIUM" | "HIGH",
  description?: string,
): Promise<ExamTopic> {
  await requireOwnedExam(profileId, examId);

  const highest = await db.examTopic.aggregate({
    where: { examId },
    _max: { position: true },
  });

  const topic = await db.examTopic.create({
    data: {
      profileId,
      examId,
      title,
      description: description ?? null,
      importance,
      position: (highest._max.position ?? 0) + POSITION_STEP,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_EXAM_TOPIC,
    topic.id,
    "CREATED",
    { examId },
  );

  return topic;
}

export async function setTopicCompletion(
  profileId: string,
  topicId: string,
  isCompleted: boolean,
): Promise<ExamTopic> {
  const existing = await requireOwnedTopic(profileId, topicId);

  const topic = await db.examTopic.update({
    where: { id: existing.id },
    data: { isCompleted },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_EXAM_TOPIC,
    topic.id,
    isCompleted ? "COMPLETED" : "REOPENED",
    { examId: topic.examId },
  );

  return topic;
}

export async function updateExamTopic(
  profileId: string,
  input: {
    topicId: string;
    title?: string;
    description?: string;
    importance?: "LOW" | "MEDIUM" | "HIGH";
    confidence?: number;
  },
): Promise<ExamTopic> {
  const existing = await requireOwnedTopic(profileId, input.topicId);

  return db.examTopic.update({
    where: { id: existing.id },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.importance === undefined
        ? {}
        : { importance: input.importance }),
      ...(input.confidence === undefined
        ? {}
        : { confidence: input.confidence }),
      description: input.description ?? null,
    },
  });
}

export async function deleteExamTopic(
  profileId: string,
  topicId: string,
): Promise<void> {
  const existing = await requireOwnedTopic(profileId, topicId);

  await db.examTopic.delete({ where: { id: existing.id } });
}

/**
 * Rewrites topic order.
 *
 * The submitted ids must be exactly this exam's topics — anything else is
 * rejected rather than partially applied, so a malformed request cannot
 * reorder half a list or pull in another exam's topic.
 */
export async function reorderExamTopics(
  profileId: string,
  examId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await requireOwnedExam(profileId, examId);

  const existing = await db.examTopic.findMany({
    where: { examId, profileId },
    select: { id: true },
  });

  const existingIds = new Set(existing.map((topic) => topic.id));
  const submitted = new Set(orderedIds);

  const isCompleteSet =
    existingIds.size === submitted.size &&
    [...submitted].every((id) => existingIds.has(id));

  if (!isCompleteSet) {
    throw validationFailed({
      orderedIds: ["The reordered list does not match this exam's topics."],
    });
  }

  await db.$transaction(
    orderedIds.map((id, index) =>
      db.examTopic.update({
        where: { id },
        data: { position: (index + 1) * POSITION_STEP },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Assessments (quizzes / class tests)
// ---------------------------------------------------------------------------

export async function createAssessment(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof createAssessmentSchema>,
): Promise<Assessment> {
  const subject = await requireOwnedSubject(profileId, input.subjectId);

  const assessment = await db.assessment.create({
    data: {
      profileId,
      subjectId: subject.id,
      semesterId: subject.semesterId,
      title: input.title,
      type: input.type,
      scheduledAt: input.date
        ? toInstant(input.date, input.time, timeZone)
        : null,
      durationMinutes: input.durationMinutes ?? null,
      maxMarks: input.maxMarks ?? null,
      marksObtained: input.marksObtained ?? null,
      syllabusNotes: input.syllabusNotes ?? null,
      status: input.status,
    },
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSESSMENT,
    assessment.id,
    "CREATED",
    { type: assessment.type },
  );

  return assessment;
}

export async function updateAssessment(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateAssessmentSchema>,
): Promise<Assessment> {
  const existing = await requireOwnedAssessment(profileId, input.assessmentId);

  if (input.subjectId && input.subjectId !== existing.subjectId) {
    await requireOwnedSubject(profileId, input.subjectId);
  }

  const data: Prisma.AssessmentUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.type !== undefined) data.type = input.type;
  if (input.status !== undefined) data.status = input.status;
  if (input.durationMinutes !== undefined) {
    data.durationMinutes = input.durationMinutes;
  }
  if (input.maxMarks !== undefined) data.maxMarks = input.maxMarks;
  if (input.marksObtained !== undefined) {
    data.marksObtained = input.marksObtained;
  }

  data.syllabusNotes = input.syllabusNotes ?? null;

  if (input.date) {
    data.scheduledAt = toInstant(input.date, input.time, timeZone);
  }

  const assessment = await db.assessment.update({
    where: { id: existing.id },
    data,
  });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSESSMENT,
    assessment.id,
    "UPDATED",
  );

  return assessment;
}

export async function deleteAssessment(
  profileId: string,
  assessmentId: string,
): Promise<void> {
  const existing = await requireOwnedAssessment(profileId, assessmentId);

  await db.assessment.delete({ where: { id: existing.id } });

  await recordAcademicActivity(
    profileId,
    ENTITY_ASSESSMENT,
    existing.id,
    "DELETED",
  );
}
