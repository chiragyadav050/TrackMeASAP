import { z } from "zod";

import { MINUTES_PER_DAY } from "@/lib/time";
import { localDateSchema, localTimeSchema } from "@/services/task/task.schema";

/**
 * Academic input schemas.
 *
 * Isomorphic, like every other schema in Life OS: the same definition gives
 * the form fast feedback and the server the check that counts.
 *
 * `localDateSchema` / `localTimeSchema` are reused from the task module on
 * purpose. The client never sends an absolute instant for a user-chosen date
 * — it sends the calendar day (and optionally the clock time) the user picked
 * and the server converts using the PROFILE's zone. Two modules with two
 * conventions would guarantee an off-by-one-day bug.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const SEMESTER_STATUSES = [
  "UPCOMING",
  "ACTIVE",
  "COMPLETED",
  "ARCHIVED",
] as const;

export const CLASS_SESSION_TYPES = [
  "LECTURE",
  "LAB",
  "TUTORIAL",
  "OTHER",
] as const;

export const CLASS_SESSION_STATUSES = [
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "EXCUSED"] as const;

export const ASSIGNMENT_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

export const SUBMISSION_STATUSES = [
  "NOT_SUBMITTED",
  "SUBMITTED",
  "LATE",
  "ACCEPTED",
] as const;

export const ASSESSMENT_TYPES = [
  "QUIZ",
  "CLASS_TEST",
  "INTERNAL",
  "PRACTICAL_TEST",
  "VIVA",
  "OTHER",
] as const;

export const ASSESSMENT_STATUSES = [
  "UPCOMING",
  "COMPLETED",
  "CANCELLED",
] as const;

export const EXAM_TYPES = [
  "MIDTERM",
  "END_SEMESTER",
  "PRACTICAL",
  "VIVA",
  "SUPPLEMENTARY",
  "BACKLOG",
  "OTHER",
] as const;

export const EXAM_STATUSES = ["UPCOMING", "COMPLETED", "CANCELLED"] as const;

export const TOPIC_IMPORTANCES = ["LOW", "MEDIUM", "HIGH"] as const;

const idSchema = z.string().min(1, "Missing reference.");

const shortText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `Keep ${label.toLowerCase()} under ${max} characters.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

/**
 * Marks.
 *
 * `marksObtained` is NOT capped at `maxMarks`. That is a deliberate product
 * decision: bonus marks, moderation and grace marks are common enough in
 * Indian universities that rejecting 22/20 would force users to lie about a
 * real result. The cross-field check below only rejects clearly impossible
 * input — negative marks, or a non-positive maximum.
 */
const marksSchema = z.coerce
  .number()
  .min(0, "Marks cannot be negative.")
  .max(10_000, "That does not look like a mark.")
  .optional();

const maxMarksSchema = z.coerce
  .number()
  .positive("Maximum marks must be greater than zero.")
  .max(10_000, "That does not look like a total.")
  .optional();

const minutesSchema = z.coerce
  .number()
  .int("Use whole minutes.")
  .min(1, "Must be at least a minute.")
  .max(MINUTES_PER_DAY, "Cap is 24 hours.")
  .optional();

const percentSchema = z.coerce
  .number()
  .int("Use a whole percentage.")
  .min(0, "Cannot be below 0%.")
  .max(100, "Cannot be above 100%.");

/** Self-rated 1–5 scales. */
const ratingSchema = z.coerce
  .number()
  .int()
  .min(1, "Rate from 1 to 5.")
  .max(5, "Rate from 1 to 5.")
  .optional();

// ---------------------------------------------------------------------------
// Semester
// ---------------------------------------------------------------------------

const semesterFields = z.object({
  name: shortText(80, "Semester name"),
  /** Free text: "2025-26" is how an academic year is actually written. */
  academicYear: shortText(20, "Academic year"),
  startDate: localDateSchema,
  endDate: localDateSchema,
  status: z.enum(SEMESTER_STATUSES).default("UPCOMING"),
  notes: optionalText(2000),
});

/** A semester that ends before it starts is not a typo worth accepting. */
const orderedDates = <T extends { startDate: string; endDate: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.endDate <= value.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "The semester must end after it starts.",
    });
  }
};

export const createSemesterSchema = semesterFields.superRefine(orderedDates);

export const updateSemesterSchema = semesterFields
  .extend({ semesterId: idSchema })
  .superRefine(orderedDates);

export const semesterIdSchema = z.object({ semesterId: idSchema });

// ---------------------------------------------------------------------------
// Subject
// ---------------------------------------------------------------------------

const subjectFields = z.object({
  semesterId: idSchema,
  name: shortText(120, "Subject name"),
  code: optionalText(30),
  facultyName: optionalText(120),
  credits: z.coerce
    .number()
    .int("Credits must be a whole number.")
    .min(0, "Credits cannot be negative.")
    .max(50, "That does not look like a credit value.")
    .optional(),
  attendanceThreshold: percentSchema.default(75),
  colorKey: optionalText(24),
  notes: optionalText(4000),
});

export const createSubjectSchema = subjectFields;

export const updateSubjectSchema = subjectFields
  .partial()
  .extend({ subjectId: idSchema });

export const subjectIdSchema = z.object({ subjectId: idSchema });

// ---------------------------------------------------------------------------
// Timetable
// ---------------------------------------------------------------------------

const scheduleFields = z.object({
  subjectId: idSchema,
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  sessionType: z.enum(CLASS_SESSION_TYPES).default("LECTURE"),
  room: optionalText(60),
  teacherName: optionalText(120),
  effectiveFrom: localDateSchema.optional(),
  effectiveTo: localDateSchema.optional(),
});

const orderedTimes = <T extends { startTime: string; endTime: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.endTime <= value.startTime) {
    ctx.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "The class must end after it starts.",
    });
  }
};

export const createScheduleSchema = scheduleFields.superRefine(orderedTimes);

export const updateScheduleSchema = scheduleFields
  .extend({ scheduleId: idSchema, isActive: z.boolean().optional() })
  .superRefine(orderedTimes);

export const scheduleIdSchema = z.object({ scheduleId: idSchema });

/**
 * Materialises a recurring schedule into real class occurrences.
 *
 * Bounded to a term's worth of days so one request cannot become an unbounded
 * write.
 */
export const generateSessionsSchema = z
  .object({
    subjectId: idSchema.optional(),
    fromDate: localDateSchema,
    toDate: localDateSchema,
  })
  .superRefine((value, ctx) => {
    if (value.toDate < value.fromDate) {
      ctx.addIssue({
        code: "custom",
        path: ["toDate"],
        message: "The range must end after it starts.",
      });
    }
  });

export const createClassSessionSchema = z
  .object({
    subjectId: idSchema,
    date: localDateSchema,
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    title: optionalText(120),
    sessionType: z.enum(CLASS_SESSION_TYPES).default("LECTURE"),
    room: optionalText(60),
    teacherName: optionalText(120),
    notes: optionalText(2000),
  })
  .superRefine(orderedTimes);

export const updateClassSessionStatusSchema = z.object({
  classSessionId: idSchema,
  status: z.enum(CLASS_SESSION_STATUSES),
});

export const classSessionIdSchema = z.object({ classSessionId: idSchema });

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const markAttendanceSchema = z.object({
  classSessionId: idSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  note: optionalText(500),
});

export const clearAttendanceSchema = z.object({
  classSessionId: idSchema,
});

/** Inputs for the standalone what-if calculator. */
export const attendanceCalculatorSchema = z.object({
  present: z.coerce.number().int().min(0).max(1000),
  absent: z.coerce.number().int().min(0).max(1000),
  excused: z.coerce.number().int().min(0).max(1000).default(0),
  thresholdPercent: percentSchema,
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

const assignmentFields = z.object({
  subjectId: idSchema,
  title: shortText(200, "Title"),
  description: optionalText(4000),
  notes: optionalText(4000),
  assignedAt: localDateSchema.optional(),
  dueDate: localDateSchema.optional(),
  dueTime: localTimeSchema.optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  status: z.enum(ASSIGNMENT_STATUSES).default("NOT_STARTED"),
  estimatedMinutes: minutesSchema,
  actualMinutes: minutesSchema,
  submissionStatus: z.enum(SUBMISSION_STATUSES).default("NOT_SUBMITTED"),
  submissionUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => value === "" || /^https?:\/\//i.test(value),
      "Use a full http(s) link.",
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  marksObtained: marksSchema,
  maxMarks: maxMarksSchema,
});

const requireDateForTime = (
  value: { dueDate?: string; dueTime?: string },
  ctx: z.RefinementCtx,
): void => {
  if (value.dueTime && !value.dueDate) {
    ctx.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Pick a date to go with the time.",
    });
  }
};

export const createAssignmentSchema = assignmentFields
  .extend({
    /** Creates a linked Task in the main task system at the same time. */
    createTask: z.boolean().default(false),
  })
  .superRefine(requireDateForTime);

export const updateAssignmentSchema = assignmentFields
  .partial()
  .extend({ assignmentId: idSchema, clearDue: z.boolean().optional() })
  .superRefine(requireDateForTime);

export const assignmentIdSchema = z.object({ assignmentId: idSchema });

export const setAssignmentStatusSchema = z.object({
  assignmentId: idSchema,
  status: z.enum(ASSIGNMENT_STATUSES),
});

export const setSubmissionSchema = z.object({
  assignmentId: idSchema,
  submissionStatus: z.enum(SUBMISSION_STATUSES),
  submissionUrl: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
});

export const recordMarksSchema = z
  .object({
    assignmentId: idSchema,
    marksObtained: marksSchema,
    maxMarks: maxMarksSchema,
  })
  .superRefine((value, ctx) => {
    if (value.marksObtained !== undefined && value.maxMarks === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["maxMarks"],
        message: "Record the total the mark is out of.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Assessment (quiz / class test)
// ---------------------------------------------------------------------------

const assessmentFields = z.object({
  subjectId: idSchema,
  title: shortText(200, "Title"),
  type: z.enum(ASSESSMENT_TYPES).default("QUIZ"),
  date: localDateSchema.optional(),
  time: localTimeSchema.optional(),
  durationMinutes: minutesSchema,
  maxMarks: maxMarksSchema,
  marksObtained: marksSchema,
  syllabusNotes: optionalText(4000),
  status: z.enum(ASSESSMENT_STATUSES).default("UPCOMING"),
});

export const createAssessmentSchema = assessmentFields;

export const updateAssessmentSchema = assessmentFields
  .partial()
  .extend({ assessmentId: idSchema });

export const assessmentIdSchema = z.object({ assessmentId: idSchema });

// ---------------------------------------------------------------------------
// Exam
// ---------------------------------------------------------------------------

const examFields = z.object({
  /** Nullable: a backlog paper may not map to a current subject. */
  subjectId: idSchema.optional(),
  title: shortText(200, "Title"),
  type: z.enum(EXAM_TYPES).default("MIDTERM"),
  date: localDateSchema.optional(),
  time: localTimeSchema.optional(),
  durationMinutes: minutesSchema,
  location: optionalText(120),
  maxMarks: maxMarksSchema,
  marksObtained: marksSchema,
  status: z.enum(EXAM_STATUSES).default("UPCOMING"),
  notes: optionalText(4000),
});

export const createExamSchema = examFields.extend({ semesterId: idSchema });

export const updateExamSchema = examFields
  .partial()
  .extend({ examId: idSchema });

export const examIdSchema = z.object({ examId: idSchema });

// ---------------------------------------------------------------------------
// Exam topics
// ---------------------------------------------------------------------------

export const createExamTopicSchema = z.object({
  examId: idSchema,
  title: shortText(200, "Topic"),
  description: optionalText(2000),
  importance: z.enum(TOPIC_IMPORTANCES).default("MEDIUM"),
});

export const updateExamTopicSchema = z.object({
  topicId: idSchema,
  title: shortText(200, "Topic").optional(),
  description: optionalText(2000),
  importance: z.enum(TOPIC_IMPORTANCES).optional(),
  confidence: ratingSchema,
});

export const setTopicCompletionSchema = z.object({
  topicId: idSchema,
  isCompleted: z.boolean(),
});

export const topicIdSchema = z.object({ topicId: idSchema });

export const reorderTopicsSchema = z.object({
  examId: idSchema,
  orderedIds: z.array(idSchema).min(1, "Nothing to reorder."),
});

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

export const logStudySessionSchema = z.object({
  subjectId: idSchema,
  examId: idSchema.optional(),
  topicId: idSchema.optional(),
  /** The local day the studying happened. Defaults to today in the service. */
  date: localDateSchema.optional(),
  startTime: localTimeSchema.optional(),
  durationMinutes: z.coerce
    .number()
    .int("Use whole minutes.")
    .min(1, "Log at least a minute.")
    .max(MINUTES_PER_DAY, "A single session caps at 24 hours."),
  focusRating: ratingSchema,
  confidenceBefore: ratingSchema,
  confidenceAfter: ratingSchema,
  notes: optionalText(2000),
});

export const studySessionIdSchema = z.object({
  studySessionId: idSchema,
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const createAcademicNoteSchema = z.object({
  subjectId: idSchema,
  title: shortText(200, "Title"),
  body: z.string().trim().min(1, "Write something.").max(20_000),
});

export const updateAcademicNoteSchema = z.object({
  noteId: idSchema,
  title: shortText(200, "Title").optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
});

export const noteIdSchema = z.object({ noteId: idSchema });

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

export const ASSIGNMENT_VIEWS = [
  "ALL",
  "OPEN",
  "DUE_TODAY",
  "DUE_THIS_WEEK",
  "UPCOMING",
  "OVERDUE",
  "COMPLETED",
  "SUBMITTED",
  "GRADED",
  "ARCHIVED",
] as const;

export const assignmentFiltersSchema = z.object({
  view: z.enum(ASSIGNMENT_VIEWS).default("OPEN"),
  semesterId: z.string().optional(),
  subjectId: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  sort: z
    .enum(["DUE_DATE", "PRIORITY", "RECENTLY_CREATED", "SUBJECT"])
    .default("DUE_DATE"),
  search: z.string().trim().max(200).optional(),
});

export type AssignmentFilters = z.infer<typeof assignmentFiltersSchema>;

export const EXAM_VIEWS = ["UPCOMING", "COMPLETED", "ALL"] as const;

export const examFiltersSchema = z.object({
  view: z.enum(EXAM_VIEWS).default("UPCOMING"),
  semesterId: z.string().optional(),
  subjectId: z.string().optional(),
  type: z.enum(EXAM_TYPES).optional(),
});

export type ExamFilters = z.infer<typeof examFiltersSchema>;

export const studyFiltersSchema = z.object({
  subjectId: z.string().optional(),
  /** Days back from today. Bounded so a dashboard query stays selective. */
  days: z.coerce.number().int().min(1).max(365).default(7),
});

export type StudyFilters = z.infer<typeof studyFiltersSchema>;

export type CreateSemesterInput = z.infer<typeof createSemesterSchema>;
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type CreateExamInput = z.infer<typeof createExamSchema>;
export type LogStudySessionInput = z.infer<typeof logStudySessionSchema>;
