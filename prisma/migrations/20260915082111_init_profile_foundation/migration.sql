-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WeekStart" AS ENUM ('SUNDAY', 'MONDAY', 'SATURDAY');

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "week_start" "WeekStart" NOT NULL DEFAULT 'MONDAY',
    "theme_preference" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "working_hours_start" INTEGER NOT NULL DEFAULT 540,
    "working_hours_end" INTEGER NOT NULL DEFAULT 1020,
    "study_hours_start" INTEGER NOT NULL DEFAULT 1140,
    "study_hours_end" INTEGER NOT NULL DEFAULT 1320,
    "onboarding_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_clerk_user_id_key" ON "profiles"("clerk_user_id");

-- CreateIndex
CREATE INDEX "profiles_onboarding_completed_at_idx" ON "profiles"("onboarding_completed_at");
