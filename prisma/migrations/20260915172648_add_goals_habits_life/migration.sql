-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('ACADEMIC', 'CAREER', 'HEALTH', 'FINANCE', 'SKILL', 'PERSONAL', 'RELATIONSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "GoalTimeframe" AS ENUM ('WEEK', 'MONTH', 'QUARTER', 'SEMESTER', 'YEAR', 'LONG_TERM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'PAUSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "HabitKind" AS ENUM ('BUILD', 'QUIT');

-- CreateEnum
CREATE TYPE "HabitCadence" AS ENUM ('DAILY', 'WEEKLY', 'SPECIFIC_DAYS');

-- CreateEnum
CREATE TYPE "MoodLevel" AS ENUM ('VERY_LOW', 'LOW', 'NEUTRAL', 'GOOD', 'GREAT');

-- CreateEnum
CREATE TYPE "MoneyDirection" AS ENUM ('EXPENSE', 'INCOME');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ImportantDateKind" AS ENUM ('BIRTHDAY', 'ANNIVERSARY', 'DEADLINE', 'RENEWAL', 'OTHER');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "goal_id" TEXT;

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "GoalCategory" NOT NULL DEFAULT 'PERSONAL',
    "timeframe" "GoalTimeframe" NOT NULL DEFAULT 'MONTH',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "target_date" DATE,
    "target_value" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "achieved_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_milestones" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "completed_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habits" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "HabitKind" NOT NULL DEFAULT 'BUILD',
    "cadence" "HabitCadence" NOT NULL DEFAULT 'DAILY',
    "target_per_period" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "target_amount" DOUBLE PRECISION,
    "unit" TEXT,
    "reminder_minute" INTEGER,
    "color_key" TEXT,
    "start_date" DATE NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "habit_logs" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "habit_id" TEXT NOT NULL,
    "log_date" DATE NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT true,
    "amount" DOUBLE PRECISION,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "habit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_check_ins" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "check_in_date" DATE NOT NULL,
    "mood" "MoodLevel",
    "energy" INTEGER,
    "stress" INTEGER,
    "sleep_minutes" INTEGER,
    "slept_at_minute" INTEGER,
    "woke_at_minute" INTEGER,
    "water_glasses" INTEGER,
    "exercise_minutes" INTEGER,
    "steps" INTEGER,
    "gratitude" TEXT,
    "notes" TEXT,
    "highlight" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_categories" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "MoneyDirection" NOT NULL DEFAULT 'EXPENSE',
    "color_key" TEXT,
    "monthly_budget_minor" INTEGER,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_entries" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "category_id" TEXT,
    "direction" "MoneyDirection" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "description" TEXT NOT NULL,
    "entry_date" DATE NOT NULL,
    "subscription_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "next_charge_date" DATE NOT NULL,
    "started_on" DATE,
    "cancelled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "important_dates" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ImportantDateKind" NOT NULL DEFAULT 'OTHER',
    "event_date" DATE NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT true,
    "remind_days_before" INTEGER NOT NULL DEFAULT 7,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "important_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_profile_id_status_archived_at_idx" ON "goals"("profile_id", "status", "archived_at");

-- CreateIndex
CREATE INDEX "goals_profile_id_target_date_idx" ON "goals"("profile_id", "target_date");

-- CreateIndex
CREATE INDEX "goal_milestones_goal_id_sort_order_idx" ON "goal_milestones"("goal_id", "sort_order");

-- CreateIndex
CREATE INDEX "goal_milestones_profile_id_completed_at_idx" ON "goal_milestones"("profile_id", "completed_at");

-- CreateIndex
CREATE INDEX "habits_profile_id_archived_at_idx" ON "habits"("profile_id", "archived_at");

-- CreateIndex
CREATE INDEX "habit_logs_profile_id_log_date_idx" ON "habit_logs"("profile_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "habit_logs_habit_id_log_date_key" ON "habit_logs"("habit_id", "log_date");

-- CreateIndex
CREATE INDEX "daily_check_ins_profile_id_check_in_date_idx" ON "daily_check_ins"("profile_id", "check_in_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_check_ins_profile_id_check_in_date_key" ON "daily_check_ins"("profile_id", "check_in_date");

-- CreateIndex
CREATE INDEX "money_categories_profile_id_direction_archived_at_idx" ON "money_categories"("profile_id", "direction", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "money_categories_profile_id_direction_name_key" ON "money_categories"("profile_id", "direction", "name");

-- CreateIndex
CREATE INDEX "money_entries_profile_id_entry_date_idx" ON "money_entries"("profile_id", "entry_date");

-- CreateIndex
CREATE INDEX "money_entries_profile_id_direction_entry_date_idx" ON "money_entries"("profile_id", "direction", "entry_date");

-- CreateIndex
CREATE INDEX "money_entries_category_id_entry_date_idx" ON "money_entries"("category_id", "entry_date");

-- CreateIndex
CREATE INDEX "subscriptions_profile_id_cancelled_at_next_charge_date_idx" ON "subscriptions"("profile_id", "cancelled_at", "next_charge_date");

-- CreateIndex
CREATE INDEX "important_dates_profile_id_event_date_idx" ON "important_dates"("profile_id", "event_date");

-- CreateIndex
CREATE INDEX "tasks_profile_id_goal_id_idx" ON "tasks"("profile_id", "goal_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habits" ADD CONSTRAINT "habits_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "habit_logs" ADD CONSTRAINT "habit_logs_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_check_ins" ADD CONSTRAINT "daily_check_ins_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_categories" ADD CONSTRAINT "money_categories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "money_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entries" ADD CONSTRAINT "money_entries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
