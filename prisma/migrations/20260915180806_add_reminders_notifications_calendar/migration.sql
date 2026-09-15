-- CreateEnum
CREATE TYPE "ReminderRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'WEEKDAYS');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'SNOOZED', 'DISMISSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'TELEGRAM', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REMINDER', 'DEADLINE', 'ATTENDANCE', 'HABIT', 'PROJECT', 'FINANCE', 'SYSTEM', 'PROACTIVE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ', 'DISMISSED');

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('PERSONAL', 'CLASS', 'EXAM', 'DEADLINE', 'WORK', 'SOCIAL', 'TRAVEL', 'OTHER');

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "remind_at" TIMESTAMP(3) NOT NULL,
    "recurrence" "ReminderRecurrence" NOT NULL DEFAULT 'NONE',
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "recur_until" TIMESTAMP(3),
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "snoozed_until" TIMESTAMP(3),
    "last_fired_at" TIMESTAMP(3),
    "task_id" TEXT,
    "event_id" TEXT,
    "habit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL DEFAULT 'SYSTEM',
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "reminder_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "quiet_hours_start" INTEGER,
    "quiet_hours_end" INTEGER,
    "is_quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "daily_limit" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "kind" "CalendarEventKind" NOT NULL DEFAULT 'PERSONAL',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "color_key" TEXT,
    "source_kind" TEXT,
    "source_id" TEXT,
    "is_busy" BOOLEAN NOT NULL DEFAULT true,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_status_remind_at_idx" ON "reminders"("status", "remind_at");

-- CreateIndex
CREATE INDEX "reminders_profile_id_status_remind_at_idx" ON "reminders"("profile_id", "status", "remind_at");

-- CreateIndex
CREATE INDEX "notifications_profile_id_status_scheduled_for_idx" ON "notifications"("profile_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_profile_id_read_at_idx" ON "notifications"("profile_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_profile_id_dedupe_key_key" ON "notifications"("profile_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_profile_id_kind_channel_key" ON "notification_preferences"("profile_id", "kind", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_profile_id_key" ON "notification_settings"("profile_id");

-- CreateIndex
CREATE INDEX "calendar_events_profile_id_start_at_idx" ON "calendar_events"("profile_id", "start_at");

-- CreateIndex
CREATE INDEX "calendar_events_profile_id_end_at_idx" ON "calendar_events"("profile_id", "end_at");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
