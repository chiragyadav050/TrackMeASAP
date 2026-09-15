import type {
  AssessmentStatus,
  AssessmentType,
  AssignmentStatus,
  ExamStatus,
  ExamType,
  SemesterStatus,
  SubmissionStatus,
  TaskPriority,
  TopicImportance,
} from "@/generated/prisma/client";
import type { AttendanceRisk } from "@/services/academics/attendance.calculator";
import type { AcademicItemKind } from "@/services/academics/academic.priority";

export type {
  AssessmentStatus,
  AssessmentType,
  AssignmentStatus,
  ExamStatus,
  ExamType,
  SemesterStatus,
  SubmissionStatus,
  TopicImportance,
} from "@/generated/prisma/client";
export type { AttendanceRisk } from "@/services/academics/attendance.calculator";

/**
 * Academic view models.
 *
 * Same contract as `TaskDto`: every date-derived label is computed on the
 * SERVER in the profile's zone and handed over as a finished string. The
 * client never owns a second copy of the date maths.
 */

export type SemesterDto = {
  readonly id: string;
  readonly name: string;
  readonly academicYear: string;
  /** DATE-ONLY values (UTC midnight); render without zone conversion. */
  readonly startDate: Date;
  readonly endDate: Date;
  readonly status: SemesterStatus;
  readonly isCurrent: boolean;
  /** 0–100, or `null` for a malformed range. */
  readonly progressPercent: number | null;
};

export type AssignmentDto = {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly notes: string | null;

  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectCode: string | null;
  readonly semesterId: string;

  /** WORK state. Independent of `submissionStatus` — see schema.prisma. */
  readonly status: AssignmentStatus;
  /** ADMINISTRATIVE state. */
  readonly submissionStatus: SubmissionStatus;
  readonly priority: TaskPriority;

  readonly dueAt: Date | null;
  readonly isAllDay: boolean;
  readonly dueLabel: string | null;
  readonly daysUntilDue: number | null;
  readonly isOverdue: boolean;

  readonly estimatedMinutes: number | null;
  readonly actualMinutes: number | null;

  readonly marksObtained: number | null;
  readonly maxMarks: number | null;
  /** `null` until graded; may exceed 100 where bonus marks were awarded. */
  readonly marksPercent: number | null;

  readonly submissionUrl: string | null;
  /** The linked Task, if one was generated. A reference, never a copy. */
  readonly taskId: string | null;

  readonly isArchived: boolean;
  readonly completedAt: Date | null;
  readonly submittedAt: Date | null;
};

export type ExamDto = {
  readonly id: string;
  readonly title: string;
  readonly type: ExamType;
  readonly status: ExamStatus;

  readonly subjectId: string | null;
  readonly subjectName: string | null;
  readonly subjectCode: string | null;
  readonly semesterId: string;

  readonly startAt: Date | null;
  readonly dateLabel: string | null;
  readonly timeLabel: string | null;
  readonly daysRemaining: number | null;
  readonly durationMinutes: number | null;
  readonly location: string | null;

  readonly maxMarks: number | null;
  readonly marksObtained: number | null;
  readonly marksPercent: number | null;
  readonly notes: string | null;

  readonly totalTopics: number;
  readonly completedTopics: number;
  /**
   * `null` means PREPARATION TRACKING HAS NOT STARTED — which is different
   * from 0% prepared, and the UI says so.
   */
  readonly preparationPercent: number | null;
  readonly remainingHighImportance: number;
};

export type ExamTopicDto = {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly importance: TopicImportance;
  readonly isCompleted: boolean;
  readonly confidence: number | null;
  readonly position: number;
};

export type AssessmentDto = {
  readonly id: string;
  readonly title: string;
  readonly type: AssessmentType;
  readonly status: AssessmentStatus;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly scheduledAt: Date | null;
  readonly dateLabel: string | null;
  readonly durationMinutes: number | null;
  readonly maxMarks: number | null;
  readonly marksObtained: number | null;
  readonly marksPercent: number | null;
  readonly syllabusNotes: string | null;
};

export type SubjectAttendanceDto = {
  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectCode: string | null;
  /** `null` when no classes have been marked — not zero. */
  readonly percentage: number | null;
  readonly thresholdPercent: number;
  readonly risk: AttendanceRisk;
  readonly canMiss: number | null;
  readonly mustAttend: number | null;
};

export type AcademicPriorityDto = {
  readonly id: string;
  readonly kind: AcademicItemKind;
  readonly title: string;
  readonly subjectName: string | null;
  readonly dueAt: Date | null;
  readonly dueLabel: string | null;
  readonly isOverdue: boolean;
  readonly preparationPercent: number | null;
  readonly attendanceRisk: AttendanceRisk | null;
  /** Why this ranked where it did. Deterministic, never generated. */
  readonly reasons: readonly string[];
};

export type AcademicOverviewDto = {
  readonly semester: SemesterDto | null;
  readonly subjectCount: number;
  readonly attendance: {
    readonly percentage: number | null;
    readonly thresholdPercent: number;
    readonly risk: AttendanceRisk;
    readonly counts: { present: number; absent: number; excused: number };
  } | null;
  readonly attendanceBySubject: readonly SubjectAttendanceDto[];
  readonly assignmentsTotal: number;
  readonly assignmentsCompleted: number;
  readonly upcomingAssignments: readonly AssignmentDto[];
  readonly upcomingExams: readonly ExamDto[];
  readonly studyWeekMinutes: number;
  readonly studyTodayMinutes: number;
  readonly priorities: readonly AcademicPriorityDto[];
};
