import "server-only";

import { z } from "zod";

import { localDateKey } from "@/lib/time";
import { db } from "@/server/db";
import { getAcademicOverview } from "@/services/academics/academic.query";
import {
  getGoalDetail,
  listGoals,
  listHabits,
} from "@/services/life/habit.query";
import { getLifeOverview } from "@/services/life/life.query";
import {
  getMoneySummary,
  listImportantDates,
  listSubscriptions,
} from "@/services/life/money.query";
import {
  createGoal,
  createGoalMilestone,
  setGoalProgress,
  setGoalStatus,
} from "@/services/life/goal.service";
import { createHabit, logHabit } from "@/services/life/habit.service";
import { createMoneyEntry } from "@/services/life/money.service";
import { saveDailyCheckIn } from "@/services/life/money.service";
import {
  getCalendarView,
  getFreeTime,
  listReminders,
} from "@/services/schedule/calendar.query";
import { createEvent, deleteEvent } from "@/services/schedule/calendar.service";
import {
  createReminder,
  deleteReminder,
} from "@/services/schedule/reminder.service";
import {
  getTodayView,
  listTasks,
  searchTasks,
} from "@/services/task/task.query";
import {
  createTask,
  deleteTask,
  rescheduleTask,
  setTaskArchived,
  setTaskCompletion,
  setTaskPriority,
  updateTask,
} from "@/services/task/task.service";
import {
  createProject,
  createProjectTask,
  createBlocker,
  resolveBlocker,
  setProjectStatus,
} from "@/services/work/work.service";
import {
  getProjectDetail,
  getWorkOverview,
  listProjects,
} from "@/services/work/work.query";
import { registerTool } from "@/services/ai/tool-registry";

/**
 * The AI's capabilities.
 *
 * Every handler below calls an APPLICATION SERVICE. None touches Prisma to
 * mutate anything, and none accepts a profile id — the executor injects the
 * caller's own profile, so the model has no way to name whose data to touch.
 *
 * RISK LEVELS are assigned by what an action costs if the model is wrong:
 *   SAFE        reads, and additive writes a user can trivially undo
 *   MODERATE    edits to existing data
 *   DESTRUCTIVE deletes and cancellations — CONFIRMATION REQUIRED
 *
 * Registration happens once, at module load, in `registerAllTools()`.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");
const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

let isRegistered = false;

/** Idempotent: importing this module twice must not double-register. */
export function registerAllTools(): void {
  if (isRegistered) {
    return;
  }

  isRegistered = true;

  // -------------------------------------------------------------------------
  // Reading — the day
  // -------------------------------------------------------------------------

  registerTool({
    name: "today.get",
    description:
      "Everything due today: tasks, overdue items, and today's statistics. Use this before answering any question about what the user should do now.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at today",
    handler: async (_args, { profile, now }) => {
      const view = await getTodayView(profile, now);

      // Deliberately a projection, not the raw DTO: the model does not need
      // ids, positions or timestamps, and a smaller payload is a cheaper and
      // more accurate prompt.
      return {
        date: view.dateLabel,
        statistics: view.statistics,
        overdue: view.overdue.map(summariseTask),
        dueToday: view.dueToday.map(summariseTask),
        completedToday: view.completedToday.length,
        nextBestAction: view.nextBestAction
          ? {
              ...summariseTask(view.nextBestAction.task),
              // The REASONS the engine gave, verbatim. The model relays them;
              // it does not invent its own justification for the choice.
              whyThisOne: view.nextBestAction.reasons,
            }
          : null,
      };
    },
  });

  registerTool({
    name: "agenda.get",
    description:
      "The calendar for a range: classes, exams, deadlines, events. Use for questions about when something is, or whether the user is free.",
    schema: z.object({
      date: dateSchema.optional(),
      view: z.enum(["DAY", "WEEK", "MONTH", "AGENDA"]).default("AGENDA"),
    }),
    risk: "SAFE",
    summarise: (args) => `Look at the calendar (${args.view.toLowerCase()})`,
    handler: async (args, { profile, now }) => {
      const view = await getCalendarView(
        profile,
        args.date ?? localDateKey(now, profile.timeZone),
        args.view,
        now,
      );

      return {
        range: view.rangeLabel,
        conflicts: view.conflicts.map((conflict) => ({
          between: [conflict.firstTitle, conflict.secondTitle],
          overlapMinutes: conflict.overlapMinutes,
        })),
        days: view.days
          .filter((day) => day.entries.length > 0)
          .map((day) => ({
            day: day.weekdayLabel,
            entries: day.entries.map((entry) => ({
              title: entry.title,
              time: entry.timeLabel,
              source: entry.source,
            })),
          })),
      };
    },
  });

  registerTool({
    name: "freetime.get",
    description:
      "Usable gaps in the user's working hours on a given day. Use before suggesting when to do something.",
    schema: z.object({
      date: dateSchema,
      minimumMinutes: z.number().int().min(5).max(480).default(30),
    }),
    risk: "SAFE",
    summarise: (args) => `Find free time on ${args.date}`,
    handler: async (args, { profile, now }) => {
      const slots = await getFreeTime(
        profile,
        args.date,
        args.minimumMinutes,
        now,
      );

      return slots.map((slot) => ({
        when: slot.label,
        minutes: slot.minutes,
      }));
    },
  });

  // -------------------------------------------------------------------------
  // Reading — tasks
  // -------------------------------------------------------------------------

  registerTool({
    name: "task.list",
    description: "The user's tasks, optionally filtered.",
    schema: z.object({
      view: z
        .enum(["ACTIVE", "TODAY", "OVERDUE", "UPCOMING", "COMPLETED", "ALL"])
        .default("ACTIVE"),
      priority: priority.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    risk: "SAFE",
    summarise: (args) => `List ${args.view.toLowerCase()} tasks`,
    handler: async (args, { profile, now }) => {
      const tasks = await listTasks(
        profile,
        { view: args.view, priority: args.priority, sort: "SMART" } as never,
        now,
      );

      return tasks.slice(0, args.limit).map(summariseTask);
    },
  });

  registerTool({
    name: "task.search",
    description: "Find tasks by title or description.",
    schema: z.object({
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    risk: "SAFE",
    summarise: (args) => `Search tasks for "${args.query}"`,
    handler: async (args, { profile }) => {
      const results = await searchTasks(profile, args.query, args.limit);
      return results.map(summariseTask);
    },
  });

  // -------------------------------------------------------------------------
  // Reading — academics, work, life
  // -------------------------------------------------------------------------

  registerTool({
    name: "academics.overview",
    description:
      "Semester, subjects, attendance percentages and risk, assignment counts and upcoming exams.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at academics",
    handler: async (_args, { profile }) => getAcademicOverview(profile),
  });

  registerTool({
    name: "attendance.get",
    description:
      "Attendance per subject, including how many classes can still be missed.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Check attendance",
    handler: async (_args, { profile }) => {
      const overview = await getAcademicOverview(profile);
      return overview.attendance;
    },
  });

  registerTool({
    name: "work.overview",
    description: "Workspaces, active projects, blockers and at-risk projects.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at work",
    handler: async (_args, { profile, now }) => {
      const view = await getWorkOverview(profile, now);

      return {
        blocked: view.blockedProjects.map((project) => project.name),
        atRisk: view.atRiskProjects.map((project) => project.name),
        overdueTasks: view.totalOverdueTasks,
        projects: view.projects.map((project) => ({
          name: project.name,
          health: project.health,
          progressPercent: project.progressPercent,
          target: project.targetLabel,
        })),
      };
    },
  });

  registerTool({
    name: "project.list",
    description: "The user's projects with health and progress.",
    schema: z.object({
      view: z
        .enum(["ACTIVE", "ALL", "PLANNED", "BLOCKED", "COMPLETED"])
        .default("ACTIVE"),
    }),
    risk: "SAFE",
    summarise: (args) => `List ${args.view.toLowerCase()} projects`,
    handler: async (args, { profile, now }) => {
      const projects = await listProjects(
        profile,
        { view: args.view, sort: "TARGET_DATE" } as never,
        now,
      );

      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        health: project.health,
        progressPercent: project.progressPercent,
        openBlockers: project.openBlockerCount,
      }));
    },
  });

  registerTool({
    name: "project.get",
    description: "One project in detail: milestones, blockers and tasks.",
    schema: z.object({ projectId: z.string().min(1) }),
    risk: "SAFE",
    summarise: () => "Look at a project",
    handler: async (args, { profile, now }) => {
      const detail = await getProjectDetail(profile, args.projectId, now);

      if (!detail) {
        return { error: "No such project." };
      }

      return {
        name: detail.project.name,
        health: detail.project.health,
        milestones: detail.milestones.map((milestone) => ({
          title: milestone.title,
          status: milestone.status,
          due: milestone.dueLabel,
        })),
        blockers: detail.blockers
          .filter((blocker) => !blocker.isResolved)
          .map((blocker) => blocker.reason),
        openTasks: detail.tasks.filter((task) => !task.isCompleted).length,
      };
    },
  });

  registerTool({
    name: "habit.list",
    description: "Habits with streaks, completion rates and today's state.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at habits",
    handler: async (_args, { profile, now }) => {
      const habits = await listHabits(profile, {}, now);

      return habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        kind: habit.kind,
        dueToday: habit.isDueToday,
        todayStatus: habit.todayStatus,
        currentStreak: habit.currentStreak,
        completionRate30: habit.completionRate30,
        daysClean: habit.daysClean,
      }));
    },
  });

  registerTool({
    name: "goal.list",
    description: "Goals with progress and whether they are on pace.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at goals",
    handler: async (_args, { profile, now }) => {
      const goals = await listGoals(profile, {}, now);

      return goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        progressPercent: goal.progressPercent,
        pace: goal.pace,
        target: goal.targetLabel,
      }));
    },
  });

  registerTool({
    name: "goal.get",
    description: "One goal with its milestones and linked habits.",
    schema: z.object({ goalId: z.string().min(1) }),
    risk: "SAFE",
    summarise: () => "Look at a goal",
    handler: async (args, { profile, now }) => {
      const detail = await getGoalDetail(profile, args.goalId, now);
      return detail ?? { error: "No such goal." };
    },
  });

  registerTool({
    name: "life.overview",
    description:
      "The whole life picture: goals, habits, today's check-in, money this month and upcoming dates.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at the life overview",
    handler: async (_args, { profile, now }) => getLifeOverview(profile, now),
  });

  registerTool({
    name: "money.summary",
    description: "Income, spending, net and per-category budgets for a month.",
    schema: z.object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.")
        .optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Look at money for ${args.month ?? "this month"}`,
    handler: async (args, { profile, now }) =>
      getMoneySummary(profile, args.month, now),
  });

  registerTool({
    name: "subscription.list",
    description: "Recurring charges and when they are next due.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "List subscriptions",
    handler: async (_args, { profile, now }) =>
      listSubscriptions(profile, false, now),
  });

  registerTool({
    name: "dates.upcoming",
    description:
      "Birthdays, anniversaries and other important dates coming up.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Look at upcoming dates",
    handler: async (_args, { profile, now }) =>
      listImportantDates(profile, now),
  });

  registerTool({
    name: "reminder.list",
    description: "Scheduled reminders.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "List reminders",
    handler: async (_args, { profile, now }) => listReminders(profile, {}, now),
  });

  // -------------------------------------------------------------------------
  // Writing — additive (SAFE)
  // -------------------------------------------------------------------------

  registerTool({
    name: "task.create",
    description: "Capture a new task.",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      priority: priority.default("MEDIUM"),
      dueDate: dateSchema.optional(),
      dueTime: timeSchema.optional(),
      estimatedMinutes: z.number().int().min(1).max(1440).optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Create task "${args.title}"`,
    handler: async (args, { profile }) => {
      const task = await createTask(profile.id, profile.timeZone, {
        title: args.title,
        description: args.description,
        priority: args.priority,
        category: "PERSONAL",
        energy: "MEDIUM",
        dueDate: args.dueDate,
        dueTime: args.dueTime,
        estimatedMinutes: args.estimatedMinutes,
      } as never);

      return { id: task.id, title: task.title };
    },
  });

  registerTool({
    name: "task.complete",
    description: "Mark a task complete.",
    schema: z.object({ taskId: z.string().min(1) }),
    risk: "MODERATE",
    summarise: () => "Mark a task complete",
    handler: async (args, { profile, now }) => {
      const task = await setTaskCompletion(profile.id, args.taskId, true, now);
      return { id: task.id, title: task.title };
    },
  });

  registerTool({
    name: "task.reschedule",
    description: "Move a task's due date.",
    schema: z.object({
      taskId: z.string().min(1),
      dueDate: dateSchema,
      dueTime: timeSchema.optional(),
    }),
    risk: "MODERATE",
    summarise: (args) => `Reschedule a task to ${args.dueDate}`,
    handler: async (args, { profile }) => {
      const task = await rescheduleTask(profile.id, profile.timeZone, {
        taskId: args.taskId,
        dueDate: args.dueDate,
        dueTime: args.dueTime,
      } as never);

      return { id: task.id, title: task.title };
    },
  });

  registerTool({
    name: "task.setPriority",
    description: "Change a task's priority.",
    schema: z.object({ taskId: z.string().min(1), priority }),
    risk: "MODERATE",
    summarise: (args) =>
      `Set a task to ${args.priority.toLowerCase()} priority`,
    handler: async (args, { profile }) => {
      const task = await setTaskPriority(
        profile.id,
        args.taskId,
        args.priority,
      );
      return { id: task.id, title: task.title };
    },
  });

  registerTool({
    name: "task.update",
    description: "Edit a task's title or description.",
    schema: z.object({
      taskId: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
    }),
    risk: "MODERATE",
    summarise: () => "Edit a task",
    handler: async (args, { profile }) => {
      const task = await updateTask(profile.id, profile.timeZone, {
        taskId: args.taskId,
        title: args.title,
        description: args.description,
      } as never);

      return { id: task.id, title: task.title };
    },
  });

  registerTool({
    name: "reminder.create",
    description: "Set a reminder at a specific date and time.",
    schema: z.object({
      title: z.string().min(1).max(200),
      date: dateSchema,
      time: timeSchema,
      recurrence: z
        .enum(["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
        .default("NONE"),
    }),
    risk: "SAFE",
    summarise: (args) =>
      `Set a reminder "${args.title}" for ${args.date} at ${args.time}`,
    handler: async (args, { profile }) => {
      const reminder = await createReminder(profile.id, profile.timeZone, {
        title: args.title,
        remindDate: args.date,
        remindTime: args.time,
        recurrence: args.recurrence,
        weekdays: [],
      } as never);

      return { id: reminder.id, title: reminder.title };
    },
  });

  registerTool({
    name: "event.create",
    description: "Add an event to the calendar.",
    schema: z.object({
      title: z.string().min(1).max(200),
      date: dateSchema,
      startTime: timeSchema.optional(),
      endTime: timeSchema.optional(),
      isAllDay: z.boolean().default(false),
      location: z.string().max(200).optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Add "${args.title}" to the calendar on ${args.date}`,
    handler: async (args, { profile }) => {
      const event = await createEvent(profile.id, profile.timeZone, {
        title: args.title,
        kind: "PERSONAL",
        startDate: args.date,
        startTime: args.startTime,
        endTime: args.endTime,
        isAllDay: args.isAllDay,
        isBusy: true,
        location: args.location,
      } as never);

      return { id: event.id, title: event.title };
    },
  });

  registerTool({
    name: "habit.create",
    description: "Start tracking a new habit.",
    schema: z.object({
      name: z.string().min(1).max(100),
      kind: z.enum(["BUILD", "QUIT"]).default("BUILD"),
      cadence: z.enum(["DAILY", "WEEKLY", "SPECIFIC_DAYS"]).default("DAILY"),
      targetPerPeriod: z.number().int().min(1).max(7).default(1),
      weekdays: z.array(z.number().int().min(1).max(7)).default([]),
    }),
    risk: "SAFE",
    summarise: (args) => `Start tracking the habit "${args.name}"`,
    handler: async (args, { profile }) => {
      const habit = await createHabit(profile.id, profile.timeZone, {
        name: args.name,
        kind: args.kind,
        cadence: args.cadence,
        targetPerPeriod: args.targetPerPeriod,
        weekdays: args.weekdays,
      } as never);

      return { id: habit.id, name: habit.name };
    },
  });

  registerTool({
    name: "habit.log",
    description: "Record a habit as done or deliberately missed on a date.",
    schema: z.object({
      habitId: z.string().min(1),
      date: dateSchema,
      isCompleted: z.boolean().default(true),
    }),
    risk: "MODERATE",
    summarise: (args) =>
      `Record a habit as ${args.isCompleted ? "done" : "missed"} on ${args.date}`,
    handler: async (args, { profile }) => {
      await logHabit(profile.id, {
        habitId: args.habitId,
        logDate: args.date,
        isCompleted: args.isCompleted,
      } as never);

      return { logged: true };
    },
  });

  registerTool({
    name: "goal.create",
    description: "Set a new goal.",
    schema: z.object({
      title: z.string().min(1).max(200),
      category: z
        .enum([
          "ACADEMIC",
          "CAREER",
          "HEALTH",
          "FINANCE",
          "SKILL",
          "PERSONAL",
          "RELATIONSHIP",
          "OTHER",
        ])
        .default("PERSONAL"),
      timeframe: z
        .enum(["WEEK", "MONTH", "QUARTER", "SEMESTER", "YEAR", "LONG_TERM"])
        .default("MONTH"),
      targetValue: z.number().min(0).optional(),
      unit: z.string().max(30).optional(),
      targetDate: dateSchema.optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Set the goal "${args.title}"`,
    handler: async (args, { profile }) => {
      const goal = await createGoal(profile.id, args as never);
      return { id: goal.id, title: goal.title };
    },
  });

  registerTool({
    name: "goal.setProgress",
    description: "Update a measured goal's current value.",
    schema: z.object({
      goalId: z.string().min(1),
      currentValue: z.number().min(0),
    }),
    risk: "MODERATE",
    summarise: (args) => `Set goal progress to ${args.currentValue}`,
    handler: async (args, { profile }) => {
      const goal = await setGoalProgress(
        profile.id,
        args.goalId,
        args.currentValue,
      );

      return { id: goal.id, currentValue: goal.currentValue };
    },
  });

  registerTool({
    name: "goal.setStatus",
    description: "Change a goal's status.",
    schema: z.object({
      goalId: z.string().min(1),
      status: z.enum(["ACTIVE", "ACHIEVED", "PAUSED", "ABANDONED"]),
    }),
    risk: "MODERATE",
    summarise: (args) => `Mark a goal as ${args.status.toLowerCase()}`,
    handler: async (args, { profile }) => {
      const goal = await setGoalStatus(profile.id, args.goalId, args.status);
      return { id: goal.id, status: goal.status };
    },
  });

  registerTool({
    name: "goalMilestone.create",
    description: "Add a milestone to a goal.",
    schema: z.object({
      goalId: z.string().min(1),
      title: z.string().min(1).max(200),
      dueDate: dateSchema.optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Add the milestone "${args.title}"`,
    handler: async (args, { profile }) => {
      const milestone = await createGoalMilestone(profile.id, args as never);
      return { id: milestone.id, title: milestone.title };
    },
  });

  registerTool({
    name: "checkin.save",
    description: "Record how a day went. Every field is optional.",
    schema: z.object({
      date: dateSchema,
      mood: z.enum(["VERY_LOW", "LOW", "NEUTRAL", "GOOD", "GREAT"]).optional(),
      energy: z.number().int().min(1).max(5).optional(),
      stress: z.number().int().min(1).max(5).optional(),
      sleepMinutes: z.number().int().min(0).max(1440).optional(),
      notes: z.string().max(2000).optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Record a check-in for ${args.date}`,
    handler: async (args, { profile }) => {
      await saveDailyCheckIn(profile.id, {
        checkInDate: args.date,
        mood: args.mood,
        energy: args.energy,
        stress: args.stress,
        sleepMinutes: args.sleepMinutes,
        notes: args.notes,
      } as never);

      return { saved: true };
    },
  });

  registerTool({
    name: "money.record",
    description: "Record money spent or received.",
    schema: z.object({
      description: z.string().min(1).max(200),
      /** A decimal string, so no float ever reaches the money pipeline. */
      amount: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/, "Use an amount like 249.50"),
      direction: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE"),
      date: dateSchema,
    }),
    risk: "MODERATE",
    summarise: (args) =>
      `Record ${args.direction === "INCOME" ? "income" : "spending"} of ${args.amount} for "${args.description}"`,
    handler: async (args, { profile }) => {
      const entry = await createMoneyEntry(profile.id, {
        description: args.description,
        amount: args.amount,
        direction: args.direction,
        currency: "INR",
        entryDate: args.date,
      } as never);

      return { id: entry.id };
    },
  });

  registerTool({
    name: "project.create",
    description: "Create a project inside a workspace.",
    schema: z.object({
      workspaceId: z.string().min(1),
      name: z.string().min(1).max(120),
      description: z.string().max(4000).optional(),
      priority: priority.default("MEDIUM"),
      targetEndDate: dateSchema.optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Create the project "${args.name}"`,
    handler: async (args, { profile }) => {
      const project = await createProject(profile.id, profile.timeZone, {
        ...args,
        status: "PLANNED",
      } as never);

      return { id: project.id, name: project.name };
    },
  });

  registerTool({
    name: "project.addTask",
    description: "Add a task to a project.",
    schema: z.object({
      projectId: z.string().min(1),
      title: z.string().min(1).max(200),
      priority: priority.default("MEDIUM"),
      dueDate: dateSchema.optional(),
    }),
    risk: "SAFE",
    summarise: (args) => `Add the task "${args.title}" to a project`,
    handler: async (args, { profile }) =>
      createProjectTask(profile.id, profile.timeZone, args as never),
  });

  registerTool({
    name: "project.setStatus",
    description: "Change a project's status.",
    schema: z.object({
      projectId: z.string().min(1),
      status: z.enum([
        "PLANNED",
        "ACTIVE",
        "PAUSED",
        "BLOCKED",
        "COMPLETED",
        "CANCELLED",
      ]),
    }),
    risk: "MODERATE",
    summarise: (args) => `Mark a project as ${args.status.toLowerCase()}`,
    handler: async (args, { profile }) => {
      const project = await setProjectStatus(
        profile.id,
        args.projectId,
        args.status,
      );

      return { id: project.id, status: project.status };
    },
  });

  registerTool({
    name: "project.addBlocker",
    description: "Record something that is blocking a project.",
    schema: z.object({
      projectId: z.string().min(1),
      reason: z.string().min(1).max(500),
    }),
    risk: "MODERATE",
    summarise: (args) => `Mark a project blocked: "${args.reason}"`,
    handler: async (args, { profile }) => {
      const blocker = await createBlocker(profile.id, args as never);
      return { id: blocker.id };
    },
  });

  registerTool({
    name: "project.resolveBlocker",
    description: "Mark a blocker resolved.",
    schema: z.object({
      blockerId: z.string().min(1),
      note: z.string().max(500).optional(),
    }),
    risk: "MODERATE",
    summarise: () => "Resolve a project blocker",
    handler: async (args, { profile }) => {
      await resolveBlocker(profile.id, args.blockerId, args.note);
      return { resolved: true };
    },
  });

  // -------------------------------------------------------------------------
  // DESTRUCTIVE — never executed without explicit user confirmation
  // -------------------------------------------------------------------------

  registerTool({
    name: "task.delete",
    description:
      "Permanently delete a task. Prefer task.archive — deletion cannot be undone.",
    schema: z.object({ taskId: z.string().min(1) }),
    risk: "DESTRUCTIVE",
    summarise: () => "Permanently delete a task",
    handler: async (args, { profile }) => {
      await deleteTask(profile.id, args.taskId);
      return { deleted: true };
    },
  });

  registerTool({
    name: "task.archive",
    description:
      "Archive a task: it leaves every active view but stays retrievable.",
    schema: z.object({ taskId: z.string().min(1) }),
    risk: "MODERATE",
    summarise: () => "Archive a task",
    handler: async (args, { profile }) => {
      await setTaskArchived(profile.id, args.taskId, true);
      return { archived: true };
    },
  });

  registerTool({
    name: "reminder.delete",
    description: "Delete a reminder.",
    schema: z.object({ reminderId: z.string().min(1) }),
    risk: "DESTRUCTIVE",
    summarise: () => "Delete a reminder",
    handler: async (args, { profile }) => {
      await deleteReminder(profile.id, args.reminderId);
      return { deleted: true };
    },
  });

  registerTool({
    name: "event.delete",
    description: "Delete a calendar event.",
    schema: z.object({ eventId: z.string().min(1) }),
    risk: "DESTRUCTIVE",
    summarise: () => "Delete a calendar event",
    handler: async (args, { profile }) => {
      await deleteEvent(profile.id, args.eventId);
      return { deleted: true };
    },
  });

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  registerTool({
    name: "memory.remember",
    description:
      "Remember a durable fact or preference about the user between conversations. Use sparingly, for things that will still matter next week.",
    schema: z.object({
      content: z.string().min(1).max(500),
      kind: z
        .enum(["PREFERENCE", "FACT", "PATTERN", "GOAL_CONTEXT"])
        .default("FACT"),
    }),
    risk: "SAFE",
    summarise: (args) => `Remember: "${args.content}"`,
    handler: async (args, { profile, conversationId }) => {
      // The one place a tool writes directly, because AIMemory has no service
      // of its own — it exists solely for the assistant. Ownership still comes
      // from the injected profile, never from the model.
      const memory = await db.aIMemory.create({
        data: {
          profileId: profile.id,
          kind: args.kind,
          content: args.content,
          sourceConversationId: conversationId,
        },
      });

      return { id: memory.id };
    },
  });

  registerTool({
    name: "memory.list",
    description: "What the assistant currently remembers about the user.",
    schema: z.object({}),
    risk: "SAFE",
    summarise: () => "Review remembered facts",
    handler: async (_args, { profile }) => {
      const memories = await db.aIMemory.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      return memories.map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        content: memory.content,
      }));
    },
  });

  registerTool({
    name: "memory.forget",
    description: "Delete something the assistant remembers.",
    schema: z.object({ memoryId: z.string().min(1) }),
    risk: "DESTRUCTIVE",
    summarise: () => "Forget a remembered fact",
    handler: async (args, { profile }) => {
      // Scoped delete: another user's memory id simply matches nothing.
      const result = await db.aIMemory.deleteMany({
        where: { id: args.memoryId, profileId: profile.id },
      });

      return { deleted: result.count > 0 };
    },
  });
}

/** Trims a task DTO to what a model actually needs. */
function summariseTask(task: {
  id: string;
  title: string;
  priority: string;
  dueLabel: string | null;
  isOverdue: boolean;
  isCompleted: boolean;
}) {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    due: task.dueLabel,
    isOverdue: task.isOverdue,
    isCompleted: task.isCompleted,
  };
}
