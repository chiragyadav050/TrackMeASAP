-- CreateEnum
CREATE TYPE "SemesterStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ClassSessionType" AS ENUM ('LECTURE', 'LAB', 'TUTORIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ClassSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NOT_SUBMITTED', 'SUBMITTED', 'LATE', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('QUIZ', 'CLASS_TEST', 'INTERNAL', 'PRACTICAL_TEST', 'VIVA', 'OTHER');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('MIDTERM', 'END_SEMESTER', 'PRACTICAL', 'VIVA', 'SUPPLEMENTARY', 'BACKLOG', 'OTHER');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TopicImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "semesters" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academic_year" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SemesterStatus" NOT NULL DEFAULT 'UPCOMING',
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "semester_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "faculty_name" TEXT,
    "credits" INTEGER,
    "attendance_threshold" INTEGER NOT NULL DEFAULT 75,
    "color_key" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "session_type" "ClassSessionType" NOT NULL DEFAULT 'LECTURE',
    "room" TEXT,
    "teacher_name" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "session_type" "ClassSessionType" NOT NULL DEFAULT 'LECTURE',
    "room" TEXT,
    "teacher_name" TEXT,
    "notes" TEXT,
    "status" "ClassSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "class_session_id" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "semester_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "assigned_at" DATE,
    "due_at" TIMESTAMP(3),
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "estimated_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "submission_status" "SubmissionStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "submission_url" TEXT,
    "submitted_at" TIMESTAMP(3),
    "marks_obtained" DOUBLE PRECISION,
    "max_marks" DOUBLE PRECISION,
    "completed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "semester_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "AssessmentType" NOT NULL DEFAULT 'QUIZ',
    "scheduled_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "max_marks" DOUBLE PRECISION,
    "marks_obtained" DOUBLE PRECISION,
    "syllabus_notes" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'UPCOMING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "semester_id" TEXT NOT NULL,
    "subject_id" TEXT,
    "title" TEXT NOT NULL,
    "type" "ExamType" NOT NULL DEFAULT 'MIDTERM',
    "start_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "location" TEXT,
    "max_marks" DOUBLE PRECISION,
    "marks_obtained" DOUBLE PRECISION,
    "status" "ExamStatus" NOT NULL DEFAULT 'UPCOMING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_topics" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "exam_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "importance" "TopicImportance" NOT NULL DEFAULT 'MEDIUM',
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "confidence" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "exam_id" TEXT,
    "topic_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL,
    "focus_rating" INTEGER,
    "confidence_before" INTEGER,
    "confidence_after" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_notes" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "academic_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "semesters_profile_id_status_idx" ON "semesters"("profile_id", "status");

-- CreateIndex
CREATE INDEX "semesters_profile_id_start_date_idx" ON "semesters"("profile_id", "start_date");

-- CreateIndex
CREATE INDEX "subjects_profile_id_semester_id_archived_at_idx" ON "subjects"("profile_id", "semester_id", "archived_at");

-- CreateIndex
CREATE INDEX "subjects_profile_id_archived_at_idx" ON "subjects"("profile_id", "archived_at");

-- CreateIndex
CREATE INDEX "class_schedules_profile_id_subject_id_is_active_idx" ON "class_schedules"("profile_id", "subject_id", "is_active");

-- CreateIndex
CREATE INDEX "class_schedules_profile_id_day_of_week_idx" ON "class_schedules"("profile_id", "day_of_week");

-- CreateIndex
CREATE INDEX "class_sessions_profile_id_start_at_idx" ON "class_sessions"("profile_id", "start_at");

-- CreateIndex
CREATE INDEX "class_sessions_profile_id_subject_id_start_at_idx" ON "class_sessions"("profile_id", "subject_id", "start_at");

-- CreateIndex
CREATE INDEX "class_sessions_profile_id_status_start_at_idx" ON "class_sessions"("profile_id", "status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_schedule_id_start_at_key" ON "class_sessions"("schedule_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_class_session_id_key" ON "attendance_records"("class_session_id");

-- CreateIndex
CREATE INDEX "attendance_records_profile_id_subject_id_status_idx" ON "attendance_records"("profile_id", "subject_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "assignments_task_id_key" ON "assignments"("task_id");

-- CreateIndex
CREATE INDEX "assignments_profile_id_archived_at_status_due_at_idx" ON "assignments"("profile_id", "archived_at", "status", "due_at");

-- CreateIndex
CREATE INDEX "assignments_profile_id_semester_id_archived_at_idx" ON "assignments"("profile_id", "semester_id", "archived_at");

-- CreateIndex
CREATE INDEX "assignments_profile_id_subject_id_archived_at_idx" ON "assignments"("profile_id", "subject_id", "archived_at");

-- CreateIndex
CREATE INDEX "assessments_profile_id_semester_id_status_idx" ON "assessments"("profile_id", "semester_id", "status");

-- CreateIndex
CREATE INDEX "assessments_profile_id_subject_id_scheduled_at_idx" ON "assessments"("profile_id", "subject_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "exams_profile_id_semester_id_status_idx" ON "exams"("profile_id", "semester_id", "status");

-- CreateIndex
CREATE INDEX "exams_profile_id_status_start_at_idx" ON "exams"("profile_id", "status", "start_at");

-- CreateIndex
CREATE INDEX "exams_profile_id_subject_id_idx" ON "exams"("profile_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_topics_exam_id_position_idx" ON "exam_topics"("exam_id", "position");

-- CreateIndex
CREATE INDEX "exam_topics_profile_id_is_completed_idx" ON "exam_topics"("profile_id", "is_completed");

-- CreateIndex
CREATE INDEX "study_sessions_profile_id_started_at_idx" ON "study_sessions"("profile_id", "started_at");

-- CreateIndex
CREATE INDEX "study_sessions_profile_id_subject_id_started_at_idx" ON "study_sessions"("profile_id", "subject_id", "started_at");

-- CreateIndex
CREATE INDEX "study_sessions_profile_id_exam_id_idx" ON "study_sessions"("profile_id", "exam_id");

-- CreateIndex
CREATE INDEX "academic_notes_profile_id_subject_id_updated_at_idx" ON "academic_notes"("profile_id", "subject_id", "updated_at");

-- CreateIndex
CREATE INDEX "attachments_profile_id_entity_type_entity_id_idx" ON "attachments"("profile_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "class_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_class_session_id_fkey" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_topics" ADD CONSTRAINT "exam_topics_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_topics" ADD CONSTRAINT "exam_topics_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "exam_topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_notes" ADD CONSTRAINT "academic_notes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_notes" ADD CONSTRAINT "academic_notes_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- HAND-WRITTEN: at most one current semester per profile.
--
-- A PARTIAL unique index, which Prisma's schema language cannot express. A
-- plain UNIQUE(profile_id, is_current) would also forbid a second NON-current
-- semester, which is exactly backwards. Restricting the index to rows WHERE
-- is_current makes the database itself guarantee the rule, so a future code
-- path that forgets to clear the previous flag fails loudly instead of
-- silently leaving two "current" semesters.
--
-- The service still clears the old flag inside a transaction; this is the
-- backstop, not the mechanism.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "semesters_one_current_per_profile"
  ON "semesters" ("profile_id")
  WHERE "is_current";
