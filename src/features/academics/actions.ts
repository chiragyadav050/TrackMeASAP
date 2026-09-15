"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  attendanceCalculatorSchema,
  classSessionIdSchema,
  clearAttendanceSchema,
  createAcademicNoteSchema,
  createAssessmentSchema,
  createAssignmentSchema,
  createClassSessionSchema,
  createExamSchema,
  createExamTopicSchema,
  createScheduleSchema,
  createSemesterSchema,
  createSubjectSchema,
  examIdSchema,
  generateSessionsSchema,
  logStudySessionSchema,
  markAttendanceSchema,
  noteIdSchema,
  recordMarksSchema,
  reorderTopicsSchema,
  scheduleIdSchema,
  semesterIdSchema,
  setAssignmentStatusSchema,
  setSubmissionSchema,
  setTopicCompletionSchema,
  studySessionIdSchema,
  subjectIdSchema,
  topicIdSchema,
  updateAcademicNoteSchema,
  updateAssessmentSchema,
  updateAssignmentSchema,
  updateClassSessionStatusSchema,
  updateExamSchema,
  updateExamTopicSchema,
  updateScheduleSchema,
  updateSemesterSchema,
  updateSubjectSchema,
  assignmentIdSchema,
} from "@/services/academics/academic.schema";
import {
  createAssignment,
  createTaskForAssignment,
  deleteAssignment,
  recordMarks,
  setAssignmentArchived,
  setAssignmentStatus,
  setSubmission,
  unlinkAssignmentTask,
  updateAssignment,
} from "@/services/academics/assignment.service";
import {
  clearAttendance,
  markAttendance,
} from "@/services/academics/attendance.service";
import {
  createAssessment,
  createExam,
  createExamTopic,
  deleteAssessment,
  deleteExam,
  deleteExamTopic,
  reorderExamTopics,
  setTopicCompletion,
  updateAssessment,
  updateExam,
  updateExamTopic,
} from "@/services/academics/exam.service";
import {
  archiveSemester,
  createSemester,
  createSubject,
  deleteSemester,
  deleteSubject,
  setCurrentSemester,
  setSubjectArchived,
  updateSemester,
  updateSubject,
} from "@/services/academics/semester.service";
import {
  createAcademicNote,
  deleteAcademicNote,
  deleteStudySession,
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
import { summariseAttendance } from "@/services/academics/attendance.calculator";
import {
  searchAcademics,
  type AcademicSearchResult,
} from "@/services/academics/academic.search";

/**
 * Academic server actions.
 *
 * Every export goes through `createAuthenticatedAction` (form posts) or
 * `createAuthenticatedCommand` (typed arguments) — the same Phase 1/2
 * factories. Both resolve identity from the Clerk session, rate limit per
 * profile, validate with Zod and convert thrown errors into safe copy.
 *
 * No action accepts a profile id, and none reaches the database except
 * through a service that requires one.
 */

/** Surfaces whose data changes whenever academic data does. */
function revalidateAcademics(): void {
  revalidatePath("/academics", "layout");
  revalidatePath("/today");
  revalidatePath("/overview");
}

// ---------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------

export const createSemesterAction = createAuthenticatedAction({
  name: "semester.create",
  schema: createSemesterSchema,
  handler: async (input, { profile }): Promise<{ semesterId: string }> => {
    const semester = await createSemester(profile.id, input);
    revalidateAcademics();
    return { semesterId: semester.id };
  },
});

export const updateSemesterAction = createAuthenticatedAction({
  name: "semester.update",
  schema: updateSemesterSchema,
  handler: async (input, { profile }): Promise<{ semesterId: string }> => {
    await updateSemester(profile.id, input);
    revalidateAcademics();
    return { semesterId: input.semesterId };
  },
});

export const setCurrentSemesterCommand = createAuthenticatedCommand({
  name: "semester.setCurrent",
  schema: semesterIdSchema,
  handler: async (input, { profile }): Promise<{ semesterId: string }> => {
    await setCurrentSemester(profile.id, input.semesterId);
    revalidateAcademics();
    return { semesterId: input.semesterId };
  },
});

export const archiveSemesterCommand = createAuthenticatedCommand({
  name: "semester.archive",
  schema: semesterIdSchema,
  handler: async (input, { profile }): Promise<{ semesterId: string }> => {
    await archiveSemester(profile.id, input.semesterId);
    revalidateAcademics();
    return { semesterId: input.semesterId };
  },
});

export const deleteSemesterCommand = createAuthenticatedCommand({
  name: "semester.delete",
  schema: semesterIdSchema,
  handler: async (input, { profile }): Promise<{ semesterId: string }> => {
    await deleteSemester(profile.id, input.semesterId);
    revalidateAcademics();
    return { semesterId: input.semesterId };
  },
});

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

export const createSubjectAction = createAuthenticatedAction({
  name: "subject.create",
  schema: createSubjectSchema,
  handler: async (input, { profile }): Promise<{ subjectId: string }> => {
    const subject = await createSubject(profile.id, input);
    revalidateAcademics();
    return { subjectId: subject.id };
  },
});

export const updateSubjectAction = createAuthenticatedAction({
  name: "subject.update",
  schema: updateSubjectSchema,
  handler: async (input, { profile }): Promise<{ subjectId: string }> => {
    await updateSubject(profile.id, input);
    revalidateAcademics();
    return { subjectId: input.subjectId };
  },
});

export const setSubjectArchivedCommand = createAuthenticatedCommand({
  name: "subject.setArchived",
  schema: subjectIdSchema.extend({ isArchived: z.boolean() }),
  handler: async (input, { profile }): Promise<{ subjectId: string }> => {
    await setSubjectArchived(profile.id, input.subjectId, input.isArchived);
    revalidateAcademics();
    return { subjectId: input.subjectId };
  },
});

export const deleteSubjectCommand = createAuthenticatedCommand({
  name: "subject.delete",
  schema: subjectIdSchema,
  handler: async (input, { profile }): Promise<{ subjectId: string }> => {
    await deleteSubject(profile.id, input.subjectId);
    revalidateAcademics();
    return { subjectId: input.subjectId };
  },
});

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

export const createScheduleAction = createAuthenticatedAction({
  name: "schedule.create",
  schema: createScheduleSchema,
  handler: async (input, { profile }): Promise<{ scheduleId: string }> => {
    const schedule = await createSchedule(profile.id, input);
    revalidateAcademics();
    return { scheduleId: schedule.id };
  },
});

export const updateScheduleAction = createAuthenticatedAction({
  name: "schedule.update",
  schema: updateScheduleSchema,
  handler: async (input, { profile }): Promise<{ scheduleId: string }> => {
    await updateSchedule(profile.id, input);
    revalidateAcademics();
    return { scheduleId: input.scheduleId };
  },
});

export const deleteScheduleCommand = createAuthenticatedCommand({
  name: "schedule.delete",
  schema: scheduleIdSchema,
  handler: async (input, { profile }): Promise<{ scheduleId: string }> => {
    await deleteSchedule(profile.id, input.scheduleId);
    revalidateAcademics();
    return { scheduleId: input.scheduleId };
  },
});

export const generateSessionsCommand = createAuthenticatedCommand({
  name: "schedule.generate",
  schema: generateSessionsSchema,
  handler: async (
    input,
    { profile },
  ): Promise<{ created: number; skipped: number }> => {
    const result = await generateClassSessions(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateAcademics();
    return { created: result.created, skipped: result.skipped };
  },
});

export const createClassSessionAction = createAuthenticatedAction({
  name: "classSession.create",
  schema: createClassSessionSchema,
  handler: async (input, { profile }): Promise<{ classSessionId: string }> => {
    const session = await createClassSession(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateAcademics();
    return { classSessionId: session.id };
  },
});

export const setClassSessionStatusCommand = createAuthenticatedCommand({
  name: "classSession.setStatus",
  schema: updateClassSessionStatusSchema,
  handler: async (input, { profile }): Promise<{ classSessionId: string }> => {
    await setClassSessionStatus(profile.id, input.classSessionId, input.status);
    revalidateAcademics();
    return { classSessionId: input.classSessionId };
  },
});

export const deleteClassSessionCommand = createAuthenticatedCommand({
  name: "classSession.delete",
  schema: classSessionIdSchema,
  handler: async (input, { profile }): Promise<{ classSessionId: string }> => {
    await deleteClassSession(profile.id, input.classSessionId);
    revalidateAcademics();
    return { classSessionId: input.classSessionId };
  },
});

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const markAttendanceCommand = createAuthenticatedCommand({
  name: "attendance.mark",
  schema: markAttendanceSchema,
  handler: async (input, { profile }): Promise<{ classSessionId: string }> => {
    await markAttendance(
      profile.id,
      input.classSessionId,
      input.status,
      input.note,
    );
    revalidateAcademics();
    return { classSessionId: input.classSessionId };
  },
});

export const clearAttendanceCommand = createAuthenticatedCommand({
  name: "attendance.clear",
  schema: clearAttendanceSchema,
  handler: async (input, { profile }): Promise<{ classSessionId: string }> => {
    await clearAttendance(profile.id, input.classSessionId);
    revalidateAcademics();
    return { classSessionId: input.classSessionId };
  },
});

/**
 * The standalone what-if calculator.
 *
 * Authenticated but read-only — it touches no rows, so it is a pure call into
 * the same arithmetic the dashboards use. Sharing the function is the point:
 * a separate "calculator formula" would eventually disagree with the real one.
 */
export const calculateAttendanceCommand = createAuthenticatedCommand({
  name: "attendance.calculate",
  schema: attendanceCalculatorSchema,
  handler: async (input) => {
    return summariseAttendance(
      {
        present: input.present,
        absent: input.absent,
        excused: input.excused,
      },
      input.thresholdPercent,
    );
  },
});

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export const createAssignmentAction = createAuthenticatedAction({
  name: "assignment.create",
  schema: createAssignmentSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    const assignment = await createAssignment(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateAcademics();
    revalidatePath("/tasks");
    return { assignmentId: assignment.id };
  },
});

export const updateAssignmentAction = createAuthenticatedAction({
  name: "assignment.update",
  schema: updateAssignmentSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await updateAssignment(profile.id, profile.timeZone, input);
    revalidateAcademics();
    revalidatePath("/tasks");
    return { assignmentId: input.assignmentId };
  },
});

export const setAssignmentStatusCommand = createAuthenticatedCommand({
  name: "assignment.setStatus",
  schema: setAssignmentStatusSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await setAssignmentStatus(profile.id, input.assignmentId, input.status);
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

export const setSubmissionCommand = createAuthenticatedCommand({
  name: "assignment.setSubmission",
  schema: setSubmissionSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await setSubmission(
      profile.id,
      input.assignmentId,
      input.submissionStatus,
      input.submissionUrl,
    );
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

export const recordMarksCommand = createAuthenticatedCommand({
  name: "assignment.recordMarks",
  schema: recordMarksSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await recordMarks(
      profile.id,
      input.assignmentId,
      input.marksObtained,
      input.maxMarks,
    );
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

export const createTaskFromAssignmentCommand = createAuthenticatedCommand({
  name: "assignment.createTask",
  schema: assignmentIdSchema,
  handler: async (
    input,
    { profile },
  ): Promise<{ taskId: string; created: boolean }> => {
    const result = await createTaskForAssignment(
      profile.id,
      input.assignmentId,
    );
    revalidateAcademics();
    revalidatePath("/tasks");
    return result;
  },
});

export const unlinkAssignmentTaskCommand = createAuthenticatedCommand({
  name: "assignment.unlinkTask",
  schema: assignmentIdSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await unlinkAssignmentTask(profile.id, input.assignmentId);
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

export const setAssignmentArchivedCommand = createAuthenticatedCommand({
  name: "assignment.setArchived",
  schema: assignmentIdSchema.extend({ isArchived: z.boolean() }),
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await setAssignmentArchived(
      profile.id,
      input.assignmentId,
      input.isArchived,
    );
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

export const deleteAssignmentCommand = createAuthenticatedCommand({
  name: "assignment.delete",
  schema: assignmentIdSchema,
  handler: async (input, { profile }): Promise<{ assignmentId: string }> => {
    await deleteAssignment(profile.id, input.assignmentId);
    revalidateAcademics();
    return { assignmentId: input.assignmentId };
  },
});

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export const createAssessmentAction = createAuthenticatedAction({
  name: "assessment.create",
  schema: createAssessmentSchema,
  handler: async (input, { profile }): Promise<{ assessmentId: string }> => {
    const assessment = await createAssessment(
      profile.id,
      profile.timeZone,
      input,
    );
    revalidateAcademics();
    return { assessmentId: assessment.id };
  },
});

export const updateAssessmentAction = createAuthenticatedAction({
  name: "assessment.update",
  schema: updateAssessmentSchema,
  handler: async (input, { profile }): Promise<{ assessmentId: string }> => {
    await updateAssessment(profile.id, profile.timeZone, input);
    revalidateAcademics();
    return { assessmentId: input.assessmentId };
  },
});

export const deleteAssessmentCommand = createAuthenticatedCommand({
  name: "assessment.delete",
  schema: z.object({ assessmentId: z.string().min(1) }),
  handler: async (input, { profile }): Promise<{ assessmentId: string }> => {
    await deleteAssessment(profile.id, input.assessmentId);
    revalidateAcademics();
    return { assessmentId: input.assessmentId };
  },
});

// ---------------------------------------------------------------------------
// Exams and topics
// ---------------------------------------------------------------------------

export const createExamAction = createAuthenticatedAction({
  name: "exam.create",
  schema: createExamSchema,
  handler: async (input, { profile }): Promise<{ examId: string }> => {
    const exam = await createExam(profile.id, profile.timeZone, input);
    revalidateAcademics();
    return { examId: exam.id };
  },
});

export const updateExamAction = createAuthenticatedAction({
  name: "exam.update",
  schema: updateExamSchema,
  handler: async (input, { profile }): Promise<{ examId: string }> => {
    await updateExam(profile.id, profile.timeZone, input);
    revalidateAcademics();
    return { examId: input.examId };
  },
});

export const deleteExamCommand = createAuthenticatedCommand({
  name: "exam.delete",
  schema: examIdSchema,
  handler: async (input, { profile }): Promise<{ examId: string }> => {
    await deleteExam(profile.id, input.examId);
    revalidateAcademics();
    return { examId: input.examId };
  },
});

export const createExamTopicCommand = createAuthenticatedCommand({
  name: "examTopic.create",
  schema: createExamTopicSchema,
  handler: async (input, { profile }): Promise<{ topicId: string }> => {
    const topic = await createExamTopic(
      profile.id,
      input.examId,
      input.title,
      input.importance,
      input.description,
    );
    revalidateAcademics();
    return { topicId: topic.id };
  },
});

export const setTopicCompletionCommand = createAuthenticatedCommand({
  name: "examTopic.setCompletion",
  schema: setTopicCompletionSchema,
  handler: async (input, { profile }): Promise<{ topicId: string }> => {
    await setTopicCompletion(profile.id, input.topicId, input.isCompleted);
    revalidateAcademics();
    return { topicId: input.topicId };
  },
});

export const updateExamTopicCommand = createAuthenticatedCommand({
  name: "examTopic.update",
  schema: updateExamTopicSchema,
  handler: async (input, { profile }): Promise<{ topicId: string }> => {
    await updateExamTopic(profile.id, input);
    revalidateAcademics();
    return { topicId: input.topicId };
  },
});

export const deleteExamTopicCommand = createAuthenticatedCommand({
  name: "examTopic.delete",
  schema: topicIdSchema,
  handler: async (input, { profile }): Promise<{ topicId: string }> => {
    await deleteExamTopic(profile.id, input.topicId);
    revalidateAcademics();
    return { topicId: input.topicId };
  },
});

export const reorderExamTopicsCommand = createAuthenticatedCommand({
  name: "examTopic.reorder",
  schema: reorderTopicsSchema,
  handler: async (input, { profile }): Promise<{ examId: string }> => {
    await reorderExamTopics(profile.id, input.examId, input.orderedIds);
    revalidateAcademics();
    return { examId: input.examId };
  },
});

// ---------------------------------------------------------------------------
// Study and notes
// ---------------------------------------------------------------------------

export const logStudySessionAction = createAuthenticatedAction({
  name: "study.log",
  schema: logStudySessionSchema,
  handler: async (input, { profile }): Promise<{ studySessionId: string }> => {
    const session = await logStudySession(profile.id, profile.timeZone, input);
    revalidateAcademics();
    return { studySessionId: session.id };
  },
});

export const deleteStudySessionCommand = createAuthenticatedCommand({
  name: "study.delete",
  schema: studySessionIdSchema,
  handler: async (input, { profile }): Promise<{ studySessionId: string }> => {
    await deleteStudySession(profile.id, input.studySessionId);
    revalidateAcademics();
    return { studySessionId: input.studySessionId };
  },
});

export const createAcademicNoteAction = createAuthenticatedAction({
  name: "note.create",
  schema: createAcademicNoteSchema,
  handler: async (input, { profile }): Promise<{ noteId: string }> => {
    const note = await createAcademicNote(
      profile.id,
      input.subjectId,
      input.title,
      input.body,
    );
    revalidateAcademics();
    return { noteId: note.id };
  },
});

export const updateAcademicNoteAction = createAuthenticatedAction({
  name: "note.update",
  schema: updateAcademicNoteSchema,
  handler: async (input, { profile }): Promise<{ noteId: string }> => {
    await updateAcademicNote(profile.id, input.noteId, input);
    revalidateAcademics();
    return { noteId: input.noteId };
  },
});

export const deleteAcademicNoteCommand = createAuthenticatedCommand({
  name: "note.delete",
  schema: noteIdSchema,
  handler: async (input, { profile }): Promise<{ noteId: string }> => {
    await deleteAcademicNote(profile.id, input.noteId);
    revalidateAcademics();
    return { noteId: input.noteId };
  },
});

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

/** Feeds the ⌘K palette. Scoped to the caller's own records. */
export const searchAcademicsCommand = createAuthenticatedCommand({
  name: "academics.search",
  schema: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(20).default(6),
  }),
  handler: async (
    input,
    { profile },
  ): Promise<readonly AcademicSearchResult[]> => {
    return searchAcademics(profile, input.query, input.limit);
  },
});
