# Life OS

A personal Life OS / student command center: one place for college, work,
projects, tasks, habits, health and finance — eventually with an AI assistant
that has real context on all of it.

> **Current status: all ten phases implemented.**
>
> Tasks and Today, Academics, Work and Projects, Goals/Habits/Life,
> Reminders + Calendar + background workers, a Telegram bot, an AI agent with
> 45 typed tools, computed planning, and proactive intelligence.
>
> **Nothing in this app shows invented data.** Where a feature needs a
> credential that is not configured — a Telegram bot token, a Gemini API key —
> the surface says so plainly and does nothing, rather than showing a
> plausible-looking answer. See `FINAL_TEST_REPORT.md` for exactly what has
> been verified and what has not.

---

## Technology

| Layer          | Choice                                          |
| -------------- | ----------------------------------------------- |
| Framework      | Next.js 16 (App Router, React 19, Turbopack)    |
| Language       | TypeScript 5, `strict` mode                     |
| Styling        | Tailwind CSS v4, shadcn/ui, Lucide icons        |
| Database       | PostgreSQL 17 + Prisma 7 (`@prisma/adapter-pg`) |
| Authentication | Clerk                                           |
| Validation     | Zod 4                                           |
| Unit tests     | Vitest                                          |
| E2E tests      | Playwright                                      |
| Background     | BullMQ + Redis (optional)                       |
| AI             | Gemini via a provider interface (optional)      |
| Tooling        | pnpm, ESLint 9, Prettier 3                      |

---

## Local setup

### 1. Prerequisites

- **Node.js 20+** (developed on 24.13)
- **pnpm 9+**
- **PostgreSQL 17** running locally

```bash
# macOS
brew install postgresql@17
brew services start postgresql@17
```

### 2. Install

```bash
pnpm install
```

`postinstall` runs `prisma generate`, which writes the typed client to
`src/generated/prisma` (git-ignored).

### 3. Create the database

```bash
createdb life_os
psql -d postgres -c "CREATE ROLE life_os LOGIN PASSWORD 'life_os_dev_password' CREATEDB;"
psql -d postgres -c "ALTER DATABASE life_os OWNER TO life_os;"
```

### 4. Configure the environment

```bash
cp .env.example .env
```

Then fill in the values below.

| Variable                            | Scope           | Required | Purpose                                  |
| ----------------------------------- | --------------- | -------- | ---------------------------------------- |
| `DATABASE_URL`                      | server secret   | yes      | PostgreSQL connection string for Prisma  |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **public**      | yes      | Clerk frontend key (safe in the browser) |
| `CLERK_SECRET_KEY`                  | server secret   | yes      | Clerk backend key — **never** expose     |
| `NEXT_PUBLIC_APP_URL`               | **public**      | yes      | Absolute origin of this deployment       |
| `LOG_LEVEL`                         | server          | no       | `debug` \| `info` \| `warn` \| `error`   |
| `CLERK_WEBHOOK_SIGNING_SECRET`      | server secret   | no       | Only if you enable `/api/webhooks/clerk` |
| `SKIP_ENV_VALIDATION`               | build-time only | no       | `1` to compile without runtime secrets   |

Every variable is validated at startup (`src/config/env.schema.ts`). A missing
or malformed value fails immediately with a message naming **every** problem at
once, not one per restart.

> ### ⚠️ Clerk keys are required
>
> The `.env` created by this repo contains **placeholder Clerk values that do
> not work**. They are syntactically valid so the app boots and so protected
> routes demonstrably redirect — but **sign-up and sign-in will not function**,
> and a browser cannot load any page, until you paste real keys from
> [dashboard.clerk.com](https://dashboard.clerk.com) → your application →
> **API Keys**. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#clerk-setup).

### 5. Migrate and run

```bash
pnpm db:migrate     # apply migrations
pnpm dev            # http://localhost:3000
```

---

## Commands

### Development

| Command      | Does                                  |
| ------------ | ------------------------------------- |
| `pnpm dev`   | Dev server with Turbopack             |
| `pnpm build` | Production build (includes typecheck) |
| `pnpm start` | Serve the production build            |

### Quality

| Command             | Does                      |
| ------------------- | ------------------------- |
| `pnpm typecheck`    | `tsc --noEmit`            |
| `pnpm lint`         | ESLint                    |
| `pnpm lint:fix`     | ESLint with autofix       |
| `pnpm format`       | Prettier, writing changes |
| `pnpm format:check` | Prettier, verifying only  |

### Database

| Command            | Does                                     |
| ------------------ | ---------------------------------------- |
| `pnpm db:generate` | Regenerate the Prisma client             |
| `pnpm db:migrate`  | Create + apply a migration (development) |
| `pnpm db:deploy`   | Apply pending migrations (production)    |
| `pnpm db:studio`   | Prisma Studio                            |
| `pnpm db:validate` | Validate the schema                      |

### Tests

| Command              | Does                                       |
| -------------------- | ------------------------------------------ |
| `pnpm test`          | Vitest unit tests                          |
| `pnpm test:watch`    | Vitest in watch mode                       |
| `pnpm test:coverage` | Unit tests with a coverage report          |
| `pnpm test:e2e`      | Playwright against a real production build |
| `pnpm test:e2e:ui`   | Playwright in UI mode                      |

---

## Documentation

| Document                                | Covers                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frontend, server, database, auth, and future AI/jobs        |
| [ROADMAP.md](docs/ROADMAP.md)           | Phases 1–10 and what each delivers                          |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md)   | Day-to-day workflow, conventions, testing, debugging        |
| [SECURITY.md](docs/SECURITY.md)         | Security model, checklist, and known gaps                   |
| [test_phase1.txt](test_phase1.txt)      | Phase 1 verification results — what passed and what did not |
| [test_phase2.txt](test_phase2.txt)      | Phase 2 verification results                                |
| [test_phase3.txt](test_phase3.txt)      | Phase 3 verification results                                |

---

### Keyboard shortcuts

| Key             | Does                                                   |
| --------------- | ------------------------------------------------------ |
| `c`             | Capture a new task                                     |
| `t`             | Go to Today                                            |
| `g`             | Go to Tasks                                            |
| `?`             | Show the shortcut reference                            |
| `⌘K` / `Ctrl+K` | Command palette — navigate, switch theme, search tasks |
| `⌘↵`            | Escalate quick capture to the full dialog              |
| `Esc`           | Dismiss a dialog, or clear quick capture               |

Shortcuts are ignored whenever you are typing in a field.

---

## What exists right now

**Built and working — Phase 3 (academics)**

- Semesters, with exactly one current at a time (enforced by a database
  constraint, not just application code)
- Subjects with per-subject attendance thresholds, faculty and credits
- A two-layer timetable: recurring rules generate real class occurrences, so
  cancelling one Monday or moving a slot mid-term never rewrites history
- Attendance marking with a fully tested calculator — percentage, how many
  more classes you can miss, how many you must attend, and four risk bands
- Assignments that track **work** and **submission** separately, with marks
- One-click conversion of an assignment into a task that appears on Today
- Quizzes and class tests, exams with syllabus topic checklists, and an
  explainable preparation percentage
- Study session logging with weekly, daily and per-subject totals
- A deterministic academic priority engine that explains its ranking
- An internal academic calendar combining classes, deadlines, tests and exams
- Academic work surfaced on Today and the Overview dashboard
- Global search across semesters, subjects, assignments, exams, tests and notes

**Built and working — Phase 2 (tasks)**

- Create tasks by typing one line and pressing Enter, or via a full dialog
  with priority, category, due date and time, estimate, energy and notes
- Edit, complete, reopen, archive, restore and permanently delete
- Subtasks with ordering and a progress indicator — finishing every step
  _suggests_ completing the parent rather than doing it silently
- Filter by status, priority, category and date; seven sort orders; search
  across title, description and notes — all held in the URL and shareable
- Bulk complete, reopen, archive, reprioritise and reschedule
- Reschedule presets (today, tomorrow, this weekend, next week) plus a
  custom date
- **Today**: greeting, next best action, overdue, due today, upcoming,
  completed and a real completion percentage
- A deterministic, explainable "next best action" — arithmetic, not AI
- Overview dashboard driven by real task data
- Every date resolved in your configured time zone, including half-hour
  offsets and daylight-saving transitions

**Built and working — Phase 1 (foundation)**

- Clerk sign-up / sign-in / sign-out, with every protected surface guarded
  server-side
- Automatic Profile provisioning on first authenticated request
- A six-question onboarding flow (name, time zone, week start, working hours,
  study hours, theme)
- The application shell: desktop sidebar, mobile sheet navigation, sticky
  header, breadcrumbs, user menu
- Light / dark / system theming, persisted per user, with no flash on load
- ⌘K command palette for navigation and theme switching
- A settings screen that writes back to the database
- Error boundaries, a genuinely useful 404, loading skeletons and honest empty
  states

**Not built yet** — every one of these has a placeholder that names the phase
that delivers it: Calendar (the unified one), Work, Projects, Habits, Health,
Finance, the AI assistant, and the Telegram bot.

File attachments are also unbuilt: the `Attachment` table and a
`StorageProvider` interface exist, but no provider is registered and no upload
UI is exposed.

---

## Optional services

Life OS works fully without either of these. Each is additive, and each
surface says so when its dependency is absent.

### Background worker (Phase 6)

Reminders fire on a schedule, and the proactive scan runs, only while a worker
is running.

```bash
brew services start redis      # or any Redis
# .env
REDIS_URL="redis://localhost:6379"

pnpm worker                    # long-running: sweeps + scans on a schedule
pnpm worker:once               # one pass, then exit — works without Redis
```

Without `REDIS_URL` the app is fully usable; only scheduled firing stops.

### Telegram bot (Phase 7)

```bash
# .env — get the token from @BotFather
TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
# openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET="..."
```

The webhook FAILS CLOSED: with no `TELEGRAM_WEBHOOK_SECRET` configured, every
request to `/api/telegram/webhook` is refused.

### AI assistant (Phase 8)

```bash
# .env
GEMINI_API_KEY="..."
```

With no key the AI page reports itself offline and its input is disabled. It
never invents a reply.

---

## Testing

```bash
pnpm test              # 537 unit tests
pnpm test:integration  # 447 tests against a real PostgreSQL database
pnpm exec playwright test   # E2E; browser specs skip without real Clerk keys
```

Integration tests need their own database and refuse to run against the dev
one:

```bash
createdb -O life_os life_os_test
pnpm db:test:setup
```
