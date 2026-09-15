# Roadmap

Ten phases. Each one ships something usable on its own; none of them require
rewriting what came before.

**All ten phases are now implemented.** See `FINAL_TEST_REPORT.md` for what is
verified, what is not, and why.

This file is mirrored in code at `src/config/phases.ts`, which is what the
in-app placeholders read from — so "coming in Phase N" copy can never drift
from this document.

---

## Phase 1 — Foundation ✅ **complete**

The scaffolding everything else stands on.

- Next.js 16 App Router, strict TypeScript, Tailwind v4, shadcn/ui
- PostgreSQL + Prisma 7 with a driver adapter and a lazy client singleton
- Clerk authentication, with protection on resources rather than URL patterns
- `Profile` model, just-in-time user provisioning, optional deletion webhook
- Typed, validated environment configuration split into server and public
- The Life OS design system: tokens, type scale, light/dark, motion
- Application shell: sidebar, mobile navigation, header, breadcrumbs, user menu
- Onboarding flow and a settings screen that writes to the database
- ⌘K command palette
- Error boundaries, 404, loading skeletons, honest empty states
- Server action and route handler patterns with auth, validation, rate
  limiting, structured logging and safe error messages
- Unit tests (Vitest) and E2E scaffolding (Playwright)

---

## Phase 2 — Tasks + Today ✅ **complete**

The first surface with real data in it.

- `Task`, `Subtask` and `ActivityEvent` models, with ownership scoped to
  `Profile` and indexes matching the queries that actually run
- Full CRUD: create, edit, complete, reopen, archive, restore, delete
- Quick capture (one line, Enter to save) plus a full dialog for details
- Subtasks with ordering and progress — completing all of them SUGGESTS
  completing the parent rather than doing it silently
- Filtering (status, priority, category, date), seven sort orders, and search
  across title, description and notes — all held in the URL
- Bulk complete / reopen / archive / reprioritise / reschedule
- Derived overdue state, computed from the clock in the user's own zone
- The Today page: greeting, next best action, overdue, due today, upcoming,
  completed and a real progress figure
- `TaskPrioritizationService` — deterministic, explainable, not AI
- Overview dashboard wired to real task data
- Keyboard shortcuts (`c`, `t`, `g`, `?`) and task search in ⌘K
- Activity log written for every meaningful mutation

## Phase 3 — Academics ✅ **complete**

The college management layer.

- Eleven models: `Semester`, `Subject`, `ClassSchedule`, `ClassSession`,
  `AttendanceRecord`, `Assignment`, `Assessment`, `Exam`, `ExamTopic`,
  `StudySession`, `AcademicNote` (plus `Attachment` metadata)
- **Two-layer timetable** — a recurring rule generates real class
  occurrences; attendance attaches to the occurrence, so cancelling one
  Monday or moving a slot mid-term never rewrites history
- Attendance with a fully tested calculator: percentage, how many classes can
  still be missed, how many must be attended, and four risk bands
- Per-subject attendance thresholds (labs and theory papers differ)
- **Assignments separate WORK status from SUBMISSION status** — finishing and
  handing in are different events
- Assignment → Task conversion as a reference, not a copy
- Quizzes/tests (`Assessment`) and exams with syllabus topic checklists
- Explainable exam preparation percentage
- Study session logging with weekly and per-subject aggregation
- `AcademicPriorityService` — deterministic, explainable, not AI
- Academics overview, semester dashboard, subject pages, attendance board,
  study board and an internal academic calendar
- Academic work surfaced on Today and the Overview dashboard
- Global search across semesters, subjects, assignments, exams, tests and notes
- `Task.subjectId` is now a real foreign key (`onDelete: SetNull`)

## Phase 4 — Work + Projects ✅ **complete**

> Groundwork already in place: `Task.projectId` is a nullable, indexed,
> unconstrained column — exactly what `subjectId` was before Phase 3 turned
> it into a real relation. The Phase 4 migration does the same for projects.

- `Project` with milestones and notes
- Work commitments tracked next to study, not in a separate tool
- Tasks gain an optional project association

## Phase 5 — Habits + Goals + Life ✅ **complete**

- `Habit` with streaks and flexible schedules
- `Goal` trees, with tasks and habits linked to the outcome they serve
- Health basics: sleep, movement, energy
- Weekend planning
- `Expense` tracking and simple budgets

## Phase 6 — Reminders + Calendar ✅ **complete**

- A unified calendar across classes, deadlines, work and personal events
- A reliable reminder engine
- **Introduces background jobs** — a `JobQueue` interface with a Redis-backed
  implementation

## Phase 7 — Telegram ✅ **complete**

- A Telegram bot for capture and review from anywhere
- Account linking via a one-time code (never by phone number or email)
- Daily briefings and reminder delivery

## Phase 8 — Gemini AI Agent ✅ **complete**

The first phase that calls a model. The boundary it plugs into already exists
(`src/services/ai/provider.ts`), and so does the history it will need to
reason over (`ActivityEvent`, written since Phase 2).

- `GeminiProvider` implementing `AiProvider`
- Function/tool calling over real Life OS operations
- Structured outputs for anything that feeds code rather than a human
- AI memory and context retrieval
- **Explicit confirmation before the assistant mutates anything**
- Available in-app and through the Telegram bot

## Phase 9 — AI Planning ✅ **complete**

> Groundwork already in place: `TaskPrioritizationService` is the
> deterministic ranking the planner extends. Its scores are explainable by
> design so an AI layer can be compared against a known baseline.

- Automated day and week plans built from real commitments
- Revision scheduling that works backwards from exam dates
- Workload balancing across study, work and rest
- Plans are proposals: always reviewable, always editable

## Phase 10 — Proactive Life Intelligence ✅ **complete**

- Notices attendance drifting toward a threshold before it is a problem
- Flags deadline collisions early
- Spots habit and energy patterns worth knowing about
- Weekly reviews generated from what actually happened

---

## Standing constraints

These hold for every phase.

1. **No fabricated data.** No sample rows, no invented statistics, no
   simulated AI output. Empty states tell the truth.
2. **Every user-owned record is scoped to a `Profile`**, and ownership is
   enforced server-side on every read and write.
3. **No dependency before the phase that uses it.**
4. **Interfaces before implementations** for anything with a plausible second
   implementation (AI providers, job queues, rate limiters).
5. **Tests and documentation ship with the phase**, not after it.
