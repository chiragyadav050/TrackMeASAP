-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TaskCategory" AS ENUM ('PERSONAL', 'COLLEGE', 'WORK', 'PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATED', 'UPDATED', 'COMPLETED', 'REOPENED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'RESCHEDULED');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "category" "TaskCategory" NOT NULL DEFAULT 'PERSONAL',
    "energy" "EnergyLevel" NOT NULL DEFAULT 'MEDIUM',
    "due_at" TIMESTAMP(3),
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "estimated_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "completed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "subject_id" TEXT,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtasks" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subtasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_profile_id_archived_at_status_due_at_idx" ON "tasks"("profile_id", "archived_at", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_profile_id_archived_at_priority_due_at_idx" ON "tasks"("profile_id", "archived_at", "priority", "due_at");

-- CreateIndex
CREATE INDEX "tasks_profile_id_archived_at_created_at_idx" ON "tasks"("profile_id", "archived_at", "created_at");

-- CreateIndex
CREATE INDEX "tasks_profile_id_completed_at_idx" ON "tasks"("profile_id", "completed_at");

-- CreateIndex
CREATE INDEX "tasks_profile_id_subject_id_idx" ON "tasks"("profile_id", "subject_id");

-- CreateIndex
CREATE INDEX "tasks_profile_id_project_id_idx" ON "tasks"("profile_id", "project_id");

-- CreateIndex
CREATE INDEX "subtasks_task_id_position_idx" ON "subtasks"("task_id", "position");

-- CreateIndex
CREATE INDEX "subtasks_profile_id_idx" ON "subtasks"("profile_id");

-- CreateIndex
CREATE INDEX "activity_events_profile_id_created_at_idx" ON "activity_events"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_entity_type_entity_id_idx" ON "activity_events"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
