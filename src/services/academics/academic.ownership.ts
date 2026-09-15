import "server-only";

import type {
  Assessment,
  Assignment,
  ClassSession,
  Exam,
  ExamTopic,
  Semester,
  Subject,
} from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { db } from "@/server/db";

/**
 * Ownership guards for every academic entity.
 *
 * ONE PLACE, ONE PATTERN. Each guard puts `profileId` in the WHERE clause, so
 * ownership is enforced by the query itself rather than by a check afterwards
 * that someone could forget to write.
 *
 * `NOT_FOUND`, never `FORBIDDEN` — a 403 would confirm that an id exists and
 * belongs to somebody, turning the API into an id oracle. Same rule as Tasks.
 *
 * NOTE ON NESTED ENTITIES. A topic belongs to an exam which belongs to a
 * profile, but `ExamTopic` also carries its own `profileId`. The guard checks
 * the DENORMALISED column rather than joining through the parent: an
 * authorization check should not depend on a join being written correctly,
 * and a single indexed lookup is both safer and faster.
 */

export async function requireOwnedSemester(
  profileId: string,
  semesterId: string,
): Promise<Semester> {
  const semester = await db.semester.findFirst({
    where: { id: semesterId, profileId },
  });

  if (!semester) {
    throw notFound("Semester");
  }

  return semester;
}

export async function requireOwnedSubject(
  profileId: string,
  subjectId: string,
): Promise<Subject> {
  const subject = await db.subject.findFirst({
    where: { id: subjectId, profileId },
  });

  if (!subject) {
    throw notFound("Subject");
  }

  return subject;
}

export async function requireOwnedSchedule(
  profileId: string,
  scheduleId: string,
) {
  const schedule = await db.classSchedule.findFirst({
    where: { id: scheduleId, profileId },
  });

  if (!schedule) {
    throw notFound("Class schedule");
  }

  return schedule;
}

export async function requireOwnedClassSession(
  profileId: string,
  classSessionId: string,
): Promise<ClassSession> {
  const session = await db.classSession.findFirst({
    where: { id: classSessionId, profileId },
  });

  if (!session) {
    throw notFound("Class");
  }

  return session;
}

export async function requireOwnedAssignment(
  profileId: string,
  assignmentId: string,
): Promise<Assignment> {
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, profileId },
  });

  if (!assignment) {
    throw notFound("Assignment");
  }

  return assignment;
}

export async function requireOwnedAssessment(
  profileId: string,
  assessmentId: string,
): Promise<Assessment> {
  const assessment = await db.assessment.findFirst({
    where: { id: assessmentId, profileId },
  });

  if (!assessment) {
    throw notFound("Assessment");
  }

  return assessment;
}

export async function requireOwnedExam(
  profileId: string,
  examId: string,
): Promise<Exam> {
  const exam = await db.exam.findFirst({ where: { id: examId, profileId } });

  if (!exam) {
    throw notFound("Exam");
  }

  return exam;
}

export async function requireOwnedTopic(
  profileId: string,
  topicId: string,
): Promise<ExamTopic> {
  const topic = await db.examTopic.findFirst({
    where: { id: topicId, profileId },
  });

  if (!topic) {
    throw notFound("Topic");
  }

  return topic;
}

export async function requireOwnedStudySession(
  profileId: string,
  studySessionId: string,
) {
  const session = await db.studySession.findFirst({
    where: { id: studySessionId, profileId },
  });

  if (!session) {
    throw notFound("Study session");
  }

  return session;
}

export async function requireOwnedNote(profileId: string, noteId: string) {
  const note = await db.academicNote.findFirst({
    where: { id: noteId, profileId },
  });

  if (!note) {
    throw notFound("Note");
  }

  return note;
}
