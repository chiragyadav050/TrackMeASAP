# Architecture

How Life OS is put together, and why. Written so that a future phase can add a
feature module without re-litigating any of these decisions.

---

## Guiding principles

1. **The server owns identity.** Nothing anywhere accepts a user id from the
   client. Every entry point derives the actor from the Clerk session.
2. **Business logic lives outside React.** Components render; services decide.
3. **Server Components by default.** A component becomes a Client Component
   only when it genuinely needs interactivity or a browser API.
4. **Honest surfaces.** A control that implies working functionality must
   have working functionality. Placeholders say what they are.
5. **Errors are two-faced.** Every error carries a technical message for the
   logs and a separate, safe message for the user.

---

## Directory layout

```text
prisma/
  schema.prisma          Single source of truth for the data model
  migrations/            Applied, checksummed migration history

src/
  app/                   Routes only — thin, delegating to features/services
    (marketing)/         Public landing page
    (auth)/              Sign-in and sign-up (Clerk owns the sub-routes)
    (app)/               Authenticated surfaces, wrapped in the app shell
    onboarding/          Authenticated but deliberately outside the shell
    api/                 Route handlers (health, Clerk webhook)
    globals.css          The design system: tokens, base layer, utilities

  components/
    ui/                  shadcn/ui primitives (generated; edit sparingly)
    common/              Cross-surface presentation (PageHeader, EmptyState…)
    layout/              The application shell
    form/                Form controls wired for accessibility and FormData
    theme/               Theme provider and toggle
    command/             ⌘K palette

  features/              Feature-scoped UI + server actions
    overview/
    onboarding/
    settings/

  services/              Business logic. No React, no request objects.
    profile/             Profile schema + service
    ai/                  AI provider interface (Phase 8 implements it)

  server/                Server-only infrastructure
    db.ts                Lazy Prisma singleton
    auth.ts              The authentication boundary
    action.ts            Server action factory (auth → limit → validate → run)
    api.ts               Route handler wrapper + response envelope

  lib/                   Pure, framework-agnostic utilities
    errors.ts            Error taxonomy
    logger.ts            Structured logging with redaction
    time.ts              Time-zone and time-of-day maths
    rate-limit.ts        RateLimiter interface + in-memory implementation

  config/                Typed configuration
    env.schema.ts        Zod schemas (pure, no process.env access)
    env.server.ts        Server env — `server-only`
    env.client.ts        Public env
    navigation.ts        The single source of truth for navigation
    phases.ts            The roadmap, as data
    site.ts              Product metadata and typed routes

  types/                 Shared types that cross the client/server boundary
  hooks/                 Client hooks
  generated/prisma/      Prisma output (git-ignored)

tests/
  unit/                  Vitest
  e2e/                   Playwright
  stubs/                 Test doubles for build-time-only modules
```

### The rule that keeps this honest

`src/server/**` and `src/services/**` import `server-only`, which makes the
build fail if they are ever reachable from a Client Component.

This is not theoretical — it caught a real bug during Phase 1. A form imported
its `ActionState` type from `src/server/action.ts`, which dragged Prisma and
`pg` into the browser bundle. The fix was `src/types/action.ts`: a module that
holds the types both sides need and imports nothing from `server/`.

**Types that cross the boundary belong in `src/types/`.**

---

## Frontend architecture

### Server/Client split

| Concern                   | Kind   | Why                             |
| ------------------------- | ------ | ------------------------------- |
| App shell, pages, layouts | Server | No interactivity; ships zero JS |
| Sidebar nav, breadcrumbs  | Client | Needs `usePathname`             |
| Command palette           | Client | Global keyboard listener        |
| Theme toggle, user menu   | Client | Local state, Clerk hooks        |
| Forms                     | Client | `useActionState`                |

The shell itself (`AppShell`) is a Server Component. Only the interactive
islands inside it hydrate.

### The Server/Client boundary and `navigation.ts`

Nav items hold a `LucideIcon` — a function, which cannot be serialised across
the RSC boundary. Client components therefore **import the config directly**
rather than receiving nav items as props. Server Components may still render
`item.icon` themselves; rendering is fine, passing is not.

### Design system

Defined entirely in `src/app/globals.css`. Direction: _quiet instrument_ —
dense, fast and professional, in the lineage of Linear and Raycast.

- **Depth from surfaces, not shadows.** `--surface`, `--surface-raised`,
  `--surface-sunken` plus hairline borders. Shadows appear only on true
  overlays.
- **Semantic colour.** The brand indigo means "active / primary action" and
  nothing else. Status colours always ship alongside an icon or a word, so
  meaning never rests on hue alone.
- **Type carries hierarchy.** A deliberate scale (`--text-display` → `--text-label`)
  with tight tracking at the top, rather than boxing everything in cards.
- **Contrast is checked, not assumed.** Primary-on-white and muted-foreground
  are tuned to ≥4.5:1 in both themes; the ratios are noted inline in the CSS.

### Theming

`next-themes` with `attribute="class"`. It injects a blocking pre-paint script,
which is what eliminates the flash of the wrong theme — this requires
`suppressHydrationWarning` on `<html>`.

Two stores, deliberately:

- **localStorage** is authoritative at runtime (instant, offline-safe).
- **`Profile.themePreference`** is the durable copy, so the choice follows the
  user to a new device. The toggle writes back via a fire-and-forget action.

---

## Server architecture

### The three entry points

Every one of them re-derives identity from the Clerk session.

| Entry point   | Guard                       | Failure mode        |
| ------------- | --------------------------- | ------------------- |
| Page / layout | `requireProfileForPage()`   | Redirect to sign-in |
| Server action | `createAuthenticatedAction` | Typed error state   |
| Route handler | `requireProfile()`          | 401 JSON envelope   |

### Server actions

`createAuthenticatedAction` is the only sanctioned way to write a mutation. It
runs five steps in a fixed order:

1. **Authenticate** — `requireProfile()`; identity from the session, never the payload
2. **Rate limit** — keyed by the authenticated profile id
3. **Validate** — Zod, against the raw `FormData`
4. **Execute** — the handler, with typed input and a scoped logger
5. **Normalise** — technical detail to the logs, safe copy to the user

It returns a `useActionState`-compatible discriminated union, so forms get
field-level errors with no bespoke plumbing.

> `unstable_rethrow(error)` runs first in the catch block. `redirect()` and
> `notFound()` signal control flow by throwing; without this, a handler that
> navigates would silently become a generic error toast.

### Route handlers

One envelope, always:

```jsonc
// success
{ "success": true,  "data": { … }, "error": null }
// failure
{ "success": false, "data": null,  "error": { "code": "…", "message": "…" } }
```

`error.message` is always the user-safe copy. Technical detail never crosses
the wire.

### Error taxonomy

`AppError` carries `code`, a technical `message`, a safe `userMessage`, an HTTP
`status`, and optional `fieldErrors`. `toAppError()` normalises anything
thrown; unknown throwables collapse to a generic `INTERNAL`, which is how
`PrismaClientKnownRequestError P2002` reaches the logs but never the screen.

### Logging

`src/lib/logger.ts`. One JSON object per line in production, readable lines in
development. `child()` attaches scope (`{ action: "profile.updatePreferences" }`).

Redaction is a **security control**: keys matching `password`, `secret`,
`token`, `apikey`, `authorization`, `cookie`, `session`, `credential`,
`signature` or `database_url` are replaced with `[redacted]`, recursively,
before anything is written. It is unit-tested.

### Rate limiting

`RateLimiter` is an interface; Phase 1 ships an in-memory fixed-window
implementation. It is honest about its limitation — **it does not coordinate
across processes**. A Redis-backed implementation can be dropped in without
touching a single call site.

---

## Database architecture

### Prisma 7

Prisma 7 moved the connection URL out of `schema.prisma`:

- `prisma.config.ts` holds the URL for the **CLI** (migrate, studio).
- The **application** connects through the `@prisma/adapter-pg` driver adapter
  in `src/server/db.ts`.

### The client is lazy

`db` is a `Proxy` that constructs the real client on first property access.
Two reasons:

- **One pool.** Dev hot-reload re-evaluates modules; caching on `globalThis`
  (which the module registry cannot invalidate) keeps exactly one pool.
- **Import ≠ connect.** Importing a service for its pure functions must not
  read `DATABASE_URL` or open a socket. This is what lets `next build` compile
  the graph without runtime secrets, and unit tests run without a database.

### Schema conventions for future phases

Phase 1 models only `Profile`. Every future user-owned entity must:

1. Carry a **required `profileId`** referencing `Profile.id`, with
   `onDelete: Cascade`.
2. Have a **`@@index([profileId, …])`** so per-user queries stay selective.
3. Use `snake_case` column names via `@map`, and a plural `@@map` table name.
4. Store times as **minutes since local midnight** (`Int`, 0–1439) where a
   wall-clock time is meant, and `DateTime` only for real instants.

```prisma
model Task {
  id        String   @id @default(cuid())
  profileId String   @map("profile_id")
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  // …
  @@index([profileId, dueAt])
  @@map("tasks")
}
```

Ownership is enforced in the service layer: every query is scoped by the
`profileId` resolved from the session, which is what makes an insecure direct
object reference structurally impossible.

---

## Authentication architecture

### Identity

`Profile.clerkUserId` is the only identifier used to resolve a user. Email is
stored for display and support **only** — users change it, and two accounts can
legitimately share one over time.

### Protection lives on the resource, not the URL

`src/proxy.ts` (Next 16 renamed `middleware` → `proxy`) attaches the Clerk
session and **makes no authorization decision**.

Clerk 7 deprecated `createRouteMatcher` for a real reason: path-pattern
matching can diverge from how Next.js actually resolves a request, leaving a
resource reachable because a regex did not match. So the guard sits on the
data — `requireProfileForPage()` in layouts, `requireProfile()` in actions and
handlers.

The `(app)` layout is what actually protects the twelve authenticated pages:
Next renders a layout around its children, so its redirect runs before any
child page's code does.

### User synchronisation — two mechanisms

**Just-in-time (primary).** `ensureProfile()` upserts on the first
authenticated request. Needs no external configuration and cannot silently
fall behind the way a missed webhook can. It refreshes the Clerk-owned mirror
fields (email, avatar) and never touches user-owned settings.

**Webhook (optional).** `/api/webhooks/clerk` handles what happens while the
user is _not_ here — chiefly `user.deleted`, so their data goes promptly rather
than at a next sign-in that never comes. Requires
`CLERK_WEBHOOK_SIGNING_SECRET`; without it the route answers 503 and the app
still works correctly on JIT sync alone.

The payload is attacker-controlled until `verifyWebhook()` returns, so nothing
is read from the body before the signature is checked.

---

## Future architecture

### AI (Phase 8)

`src/services/ai/provider.ts` defines the boundary **today** with no
implementation, no SDK and no API key. The interface exists now because the
assistant will eventually be invoked from at least three places — the AI
surface, the Telegram bot, and background planning jobs — and three parallel
ad-hoc integrations is the failure mode worth preventing.

```text
AiProvider (interface)        ← defined in Phase 1
  ├── GeminiProvider          ← Phase 8
  ├── OpenAIProvider          ← future
  └── ClaudeProvider          ← future
```

`getAiProvider()` throws `AiProviderNotConfiguredError` until one is
registered. Failing loudly — rather than returning a stub that invents an
answer — is deliberate: nothing may present fabricated AI output as real.

Phase 8 adds: Gemini Flash, function/tool calling, structured outputs, an AI
memory store, context retrieval, and an explicit action-confirmation step
before the assistant mutates anything.

### Telegram (Phase 7)

Will land as `src/services/telegram/`, with a webhook route under
`src/app/api/webhooks/telegram/`. A Telegram account will map to a `Profile`
through a linking code — never through a phone number or email, for the same
reason email is not an identifier today.

### Background jobs (Phase 6+)

Reminders and proactive planning need scheduled execution. The intended shape
is a `JobQueue` interface in `src/services/jobs/`, with a BullMQ + Redis
implementation behind it, mirroring how `RateLimiter` is structured. Nothing
is installed until the phase that needs it.

### Integrations

Google Calendar, Drive, Gmail, Resend and S3 all belong in `src/services/<name>/`
behind an interface, configured through `env.schema.ts`. **No dependency is
installed before the phase that uses it** — the dependency list should describe
what the app does, not what it might one day do.

---

# Phase 2 — Tasks and Today

## Directory additions

```text
src/
  services/task/
    task.schema.ts          Zod input schemas (isomorphic)
    task.derive.ts          PURE: overdue, today, labels. No Prisma, no React.
    task.prioritization.ts  PURE: deterministic scoring and ranking
    task.service.ts         Mutations. Every function takes profileId first.
    task.query.ts           Reads, filters, statistics, the Today view
  services/activity/
    activity.service.ts     Append-only audit log
  features/tasks/
    actions.ts              Server actions and commands
    task-dialog-provider.tsx  Shell-level dialog + `c`/`?` shortcuts
    use-task-shortcuts.ts   Keyboard handling
    components/             Row, list, filters, quick capture, dialog, subtasks
  features/today/
    today-workspace.tsx     The Today page body
    next-best-action.tsx    The single recommendation
  types/task.ts             TaskDto and friends
```

## The layering rule

```text
page (Server Component)
  → task.query.ts        reads, scoped by profileId
  → task.service.ts      writes, scoped by profileId
       ↓ both call
    task.derive.ts + task.prioritization.ts   (pure, no I/O)
```

`derive` and `prioritization` import nothing from Prisma, React or
`server-only`. That is what makes the rules that actually matter — what counts
as overdue, what should be done next — testable with plain objects and
impossible to reimplement by accident inside a component.

## Task ownership

Every function in `task.service.ts` and `task.query.ts` takes `profileId` (or
a whole `Profile`) as its **first argument**, and that value always originates
from the Clerk session. No function reads the ambient session itself, which
makes it structurally impossible to write one that trusts a client-supplied
owner.

Two enforcement patterns, chosen per operation:

| Pattern                                                    | Used by              | Why                                                                                                                 |
| ---------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `requireOwnedTask(profileId, taskId)` → throws `NOT_FOUND` | single-row mutations | Needs the row anyway; one indexed lookup                                                                            |
| `updateMany({ where: { id: { in: ids }, profileId } })`    | bulk operations      | Ownership is in the WHERE clause, so foreign ids simply do not match — no per-id round trip, no partial application |

**`NOT_FOUND`, never `FORBIDDEN`.** A 403 would confirm that an id exists and
belongs to somebody, turning the API into an id oracle.

`Subtask` carries a denormalised `profileId` so a subtask mutation proves
ownership with one indexed lookup instead of joining through its parent — an
authorization check should not depend on a join.

This is covered by `tests/integration/task-authorization.test.ts`: every
operation is invoked with the wrong profile and must both refuse _and_ leave
the victim's row untouched, against two real profiles in a real database.

## Date and time handling

The single most important rule in Phase 2: **"today" is a function of the
user's zone, not the server's.**

- **Stored** as absolute UTC instants (`dueAt`, `completedAt`).
- **Interpreted** through `Profile.timeZone` on every read.
- **Never** derived on the client — `Date#getHours()` reads the _browser's_
  zone, which is wrong the moment it differs from the configured one.

The whole mechanism is two functions in `src/lib/time.ts`:

- `zoneOffsetMs(date, tz)` — formats the instant in the zone and re-reads
  those parts as UTC; the difference is the offset. Offset-agnostic, so
  `+05:30` and `+05:45` need no special cases.
- `instantFromLocalTime(y, m, d, minutes, tz)` — two passes, because the
  offset needed to answer the question depends on the answer. The second pass
  re-reads the offset at the candidate instant, which is what keeps times near
  a DST boundary from landing an hour out.

Everything else (`startOfLocalDay`, `endOfLocalDay`, `addLocalDays`,
`localDayDifference`) is built on those. 29 unit tests cover Asia/Kolkata
(+05:30), Asia/Kathmandu (+05:45) and both American DST transitions.

### All-day tasks

`isAllDay` exists because a date-only task is otherwise indistinguishable from
one due at local midnight — and would be reported overdue for the entire day
it is actually due. `effectiveDeadline()` therefore returns the **end** of the
local day for an all-day task, and the exact instant for a timed one.

### The client never computes a date

`TaskDto` is a **view model**. The server produces every date-derived string —
`dueLabel` ("Today", "Friday", "2 Nov"), `overdueLabel` ("2 days overdue"),
`dueTimeLabel`, and the raw `dueDateInput` / `dueTimeInput` values the edit
form's `<input type="date">` needs. The client renders strings and never owns
a second copy of the maths.

## The prioritisation engine

`task.prioritization.ts` answers "what should I do now?" with arithmetic, not
a model. It is deliberately explainable: `scoreTask` returns both a score and
the `reasons` behind it, which the Today page renders as chips.

Weights are named constants, roughly ordered:

```text
urgency   overdue (500 + 25/day, capped at 14 days)
          > due today (300) > tomorrow (150) > this week (80) > later (20)
          > undated (0)
priority  URGENT 400 > HIGH 250 > MEDIUM 120 > LOW 40
status    in progress +120   blocked −400
effort    ≤15 min +30        ≥180 min −20
```

`rankTasks` breaks ties on due date, then creation time, then id — a total,
stable order, so the list does not reshuffle between refreshes.

`selectNextBestAction` additionally excludes `BLOCKED` tasks outright:
recommending something the user has said they cannot proceed with would be
actively unhelpful.

**Overdue is never stored.** A boolean column would be wrong the moment the
clock passed the deadline and would need a job to keep it true. It is derived
in `isOverdue()`, and expressed as a query (`buildTaskWhere`) when the
database needs to filter by it.

## Server actions

Phase 1 shipped `createAuthenticatedAction` for `<form>` posts. Phase 2 adds
`createAuthenticatedCommand` for actions called with a typed argument —
ticking a checkbox, choosing a priority from a menu, a bulk reschedule. Same
five guarantees (authenticate → rate limit → validate → execute → normalise);
the only difference is that the payload arrives as an object instead of
`FormData`, so structured input keeps its types end to end.

Both treat their input as equally untrusted.

## Optimistic updates

Only completion is optimistic, and only in `TaskRow`. The checkbox flips
immediately, the mutation follows, and **a failure rolls the row back and
surfaces an error** — a silent failure that leaves the UI lying about
persisted state is the thing optimistic updates most often get wrong.

The override is cleared by comparing against the incoming prop during render
(React's documented pattern for derived state), not by an effect.

Everything else waits for the server: priority, reschedule, archive and delete
are either destructive or infrequent enough that a brief pending state beats a
rollback.

## Activity log

`ActivityEvent` is append-only and written for create, update, complete,
reopen, archive, unarchive, delete and reschedule. Nothing reads it in the UI
yet — it exists because history cannot be reconstructed retroactively, and
Phase 8's assistant will need to answer "what happened this week".

Two rules it enforces:

1. **Metadata stays small and non-sensitive** — changed field _names_ and
   coarse values, never a full snapshot and never task notes. The log must not
   become a second, unguarded copy of the user's private content.
2. **Logging never breaks the mutation it describes.** A failed audit write is
   logged and swallowed; failing a user's task completion over an audit row
   would be worse than losing the row.

## Indexes

Chosen from the queries in `task.query.ts`, not sprinkled across every column:

| Index                                               | Serves                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `(profileId, archivedAt, status, dueAt)`            | active list, Today, Overdue                                                      |
| `(profileId, archivedAt, priority, dueAt)`          | smart sort, priority filter                                                      |
| `(profileId, archivedAt, createdAt)`                | recently-created / updated sorts                                                 |
| `(profileId, completedAt)`                          | completed-today statistics                                                       |
| `(profileId, subjectId)` / `(profileId, projectId)` | Phase 3 / 4, indexed now so the columns are usable the moment those modules land |

## Statistics

Computed from source data on every request, never stored. A cached count is a
count that can be wrong, and four indexed `COUNT`s are far cheaper than the
machinery needed to keep a materialised figure honest.

One subtlety: the denominator is what was **due** today; the numerator is what
was **completed** today. Completing something that was not due today can
therefore exceed the denominator, so `computeCompletionPercent` clamps to 100
rather than reporting "140% complete".

## Keyboard shortcuts

| Key             | Does                                      |
| --------------- | ----------------------------------------- |
| `c`             | Capture a new task                        |
| `t`             | Go to Today                               |
| `g`             | Go to Tasks                               |
| `?`             | Show the shortcut reference               |
| `⌘K` / `Ctrl+K` | Command palette (also searches tasks)     |
| `⌘↵`            | Escalate quick capture to the full dialog |
| `Esc`           | Dismiss a dialog, or clear quick capture  |

Single-key shortcuts are only safe because of `isTypingTarget()`, which
ignores the keystroke whenever focus is in an input, textarea, select or
anything `contenteditable`, and whenever a modifier is held. A bare `c` that
fires mid-sentence is worse than no shortcut at all, so that guard is unit
tested directly.

The dialog and the shortcuts live in `TaskDialogProvider` at the **shell**
level, not per page — which is why ⌘K's "New task" works from any surface and
why Tasks and Today do not each maintain their own copy of dialog state.

## Filter state lives in the URL

`/tasks?status=OVERDUE&priority=HIGH&sort=DUE_DATE` is shareable, survives a
refresh and works with the back button. It also means the Server Component
reads the filters and does the querying, instead of shipping the whole task
list to the client to filter there. A hand-edited URL cannot break the page:
the same Zod schema parses it, and an invalid value falls back to the default.

---

# Phase 3 — Academics

## Directory additions

```text
src/
  services/academics/
    attendance.calculator.ts  PURE: the whole attendance arithmetic
    academic.derive.ts        PURE: overdue, preparation, study, semester
    academic.priority.ts      PURE: deterministic academic ranking
    academic.dates.ts         DATE-ONLY vs instant conversion
    academic.ownership.ts     One guard per entity, all NOT_FOUND
    academic.schema.ts        Zod input schemas
    academic.activity.ts      Academic entity names for the Phase 2 audit log
    semester.service.ts       Semester + subject mutations
    timetable.service.ts      Schedules, occurrences, generation
    attendance.service.ts     Marking + aggregation
    assignment.service.ts     Assignments + the Task bridge
    exam.service.ts           Exams, topics, assessments
    study.service.ts          Study sessions + subject notes
    academic.query.ts         Reads, dashboards, the AI-ready surface
    academic.search.ts        Global search
  services/storage/
    provider.ts               Interface only — no bytes stored anywhere yet
  features/academics/         Actions + UI
  features/today/academic-panel.tsx
  types/academics.ts
```

## Date-only vs absolute instant

The distinction that matters most in this phase, stated once in
`schema.prisma` and enforced by `academic.dates.ts`:

| Concept                                                               | Column type      | Why                                                                                                                                |
| --------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Semester start/end, assignment `assignedAt`, schedule validity window | `@db.Date`       | A calendar date with no clock time and no zone. Postgres stores a `date`, so there is no midnight-rollover ambiguity to get wrong. |
| Class times, exam times, deadlines, study sessions                    | `DateTime` (UTC) | A real instant, converted **from** the profile's zone on write and rendered **in** it on read.                                     |

`toDateOnly()` anchors at UTC midnight so the value round-trips unchanged;
applying a zone offset there would push "1 January" into December for anyone
west of Greenwich. `toInstant()` goes through `instantFromLocalTime()` — the
same two-pass, DST-correct helper Phase 2 built.

## The two-layer timetable

```text
ClassSchedule   A RULE.  "Cloud Computing, every Monday 10:00–11:00."
     ↓ generates
ClassSession    A FACT.  "Cloud Computing on Monday 21 September."
     ↓ carries
AttendanceRecord
```

Collapsing these into one table is the obvious shortcut and the reason
timetable features usually break by mid-semester. Attendance is a statement
about a specific day; a timetable is a statement about a pattern. With the
split:

- **Cancelling one Monday** sets that SESSION to `CANCELLED` (and deletes any
  attendance on it — attendance for a class that did not happen is not a fact
  about the student). The rule is untouched; next Monday still generates.
- **Changing the slot mid-term** closes the old rule with `effectiveTo` and
  opens a new one with `effectiveFrom`. Sessions already generated, and the
  attendance hanging off them, are unaffected.
- **Deleting a rule** uses `onDelete: SetNull`, so past classes survive as
  ad-hoc records rather than vanishing with their attendance.

Generation is **idempotent** — `@@unique([scheduleId, startAt])` plus
`skipDuplicates`, so re-running over an overlapping range creates nothing new.

## Attendance rules

All of it lives in `attendance.calculator.ts` — pure, and covered by 40 unit
tests including the floating-point boundary cases.

**1. Eligible = PRESENT + ABSENT.** `EXCUSED` is excluded from both the
numerator and the denominator. This matches how duty leave, medical leave and
approved absence are normally treated: the class is struck from the record
rather than forgiven. Counting excused as present would let a student with two
attended classes and twenty medical leaves report 100%.

**2. Percentage = present / eligible × 100.** With zero eligible classes it is
`null`, not zero — a new subject has not failed its requirement, it has no
data, and every surface says so.

**3. Unmarked classes count for nothing.** That is why `AttendanceRecord` is a
separate row rather than a column on `ClassSession`: "not marked yet" and
"marked absent" are different facts.

**4. No rounding in the maths.** Rounding is applied at the very end, for
display only. A student at 74.9% is never told they are safe.

### The two questions students actually ask

```text
How many more can I miss?      present / (eligible + k) ≥ threshold
                               ⇒ k = floor(present / threshold − eligible)

How many must I attend?        (present + n) / (eligible + n) ≥ threshold
                               ⇒ n = ceil((threshold × eligible − present) / (1 − threshold))
```

Both clamp at 0. `mustAttend` returns `null` when the target is unreachable
(a 100% requirement already broken) rather than advising something impossible.

### Risk bands

Defined in terms of the student's actual MARGIN, not a fixed percentage-point
gap — ten points of cushion means something very different at five classes
than at fifty:

| Band       | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `UNKNOWN`  | Nothing marked. A real answer, not a failure.                           |
| `SAFE`     | At or above the threshold with ≥2 classes of slack                      |
| `WATCH`    | At or above it, but 0–1 absences from dropping below                    |
| `AT_RISK`  | Below it, recoverable within the classes that remain                    |
| `CRITICAL` | Below it and NOT recoverable — or below it with no remaining-class data |

Thresholds are **per subject** (`Subject.attendanceThreshold`, default 75),
because labs and theory papers routinely differ and no university rule can be
hard-coded.

## Assignments: two independent states

```text
status            NOT_STARTED → IN_PROGRESS → COMPLETED (or CANCELLED)
                  How far along the WORK is.

submissionStatus  NOT_SUBMITTED → SUBMITTED / LATE / ACCEPTED
                  What the INSTITUTION has received.
```

These move independently and routinely in the wrong order: a report finished
on Tuesday and uploaded on Thursday, or a half-finished draft submitted to
beat a deadline. Collapsing them into one enum makes both unrepresentable.

**"Graded" is not a third state** — it is `marksObtained != null`. A flag
would only give something else to fall out of step with.

`marksObtained` is deliberately **not capped** at `maxMarks`: bonus marks,
moderation and grace marks are common enough that rejecting 22/20 would force
users to record something untrue.

### The overdue rule

An assignment is overdue when its deadline has passed AND it is neither
finished nor handed in. Archived, `CANCELLED`, `COMPLETED`, or any settled
submission state all close it. All-day deadlines are due at the END of their
local day — identical semantics to `Task`, so the two can never disagree about
what "late" means.

## Assignment ↔ Task integration

`Assignment.taskId` is a **reference, not a copy**. The assignment stays the
academic record; the task is the schedulable unit that appears on Today and in
the task list. `Task.subjectId` (a real foreign key since this phase) carries
the academic context.

Creating a task carries across the subject prefix, deadline, all-day flag,
estimate and priority. Editing the assignment mirrors those _schedulable_
facts onto the task.

**What it deliberately does NOT do:** completing the task does not mark the
assignment submitted, and status is never mirrored in either direction.
Finishing the work and handing it in are separate events; conflating them
would tell a student their assignment was in when it was still on their
laptop. Deleting the assignment leaves the task alone, and vice versa.

## Exam preparation

```text
preparation = completed topics / total topics × 100
```

A plain count, on purpose. Weighting by `importance` was considered and
rejected: a student who has covered 5 of 8 topics expects 62.5%, and a
weighted figure reading 71% is harder to trust and impossible to verify at a
glance. Importance and confidence still matter — they drive WHICH topic the
priority engine suggests next — they just do not distort the headline number.

`null` means **preparation tracking has not started**, which every surface
distinguishes from 0% prepared.

## The academic priority engine

`academic.priority.ts` answers "what academic work needs me now?" with
arithmetic. It mirrors `task.prioritization.ts` deliberately — two ranking
engines with different philosophies would produce a Today page that
contradicts itself.

```text
attendance  CRITICAL 480 > AT_RISK 300 > WATCH 90 > SAFE/UNKNOWN 0
proximity   overdue (520 + 22/day, capped 14d) > today 320 > tomorrow 190
            > 2–3 days 120 > this week 70 > later 18 > undated 0
priority    URGENT 220 > HIGH 140 > MEDIUM 70 > LOW 25
exam        base 90, plus (1 − preparation) × 240 × closeness
            (closeness tapers to zero beyond 14 days)
effort      ≤20 min +25   ≥240 min −15
```

Every score carries `reasons`, which the UI renders as chips. A ranking the
user cannot interrogate is indistinguishable from a random pick — and this is
the deterministic baseline Phase 9's planner will be measured against.

Critical attendance outranks an assignment due today: falling below the
requirement can cost a semester, one late assignment usually cannot.

## The AI-ready surface (no AI in this phase)

`academic.query.ts` exports functions already shaped as the typed tools Phase
8 will expose to Gemini — each takes a profile, returns a serialisable DTO,
and reads no ambient state:

```text
getCurrentSemester()      getUpcomingAssignments()   getUpcomingExams()
getAttendanceStatus()     getStudySummary()          getAcademicPriorities()
```

Nothing here calls a model and nothing is generated.

## Ownership

Eleven new owned entities, one guard each in `academic.ownership.ts`, all
putting `profileId` in the WHERE clause and all throwing `NOT_FOUND` rather
than `FORBIDDEN` — a 403 would confirm an id exists and belongs to somebody.

Nested entities (`ExamTopic`, `AttendanceRecord`, `Subtask`) carry a
**denormalised `profileId`** so their guards are a single indexed lookup
rather than a join through the parent. An authorization check should not
depend on a join being written correctly.

Verified by `tests/integration/academics-authorization.test.ts`: every
mutation on every entity invoked with the wrong profile, asserting both that
it refuses and that the victim's row is unchanged.

## One current semester

Enforced in two places:

1. `setCurrentSemester` clears the previous flag inside a transaction.
2. A **partial unique index** — `CREATE UNIQUE INDEX … ON semesters (profile_id) WHERE is_current` — added by hand in the migration SQL.

Prisma cannot express a partial index, and a plain
`@@unique([profileId, isCurrent])` would wrongly forbid a second _non_-current
semester. The index is the guarantee; the transaction is the mechanism. An
integration test bypasses the service entirely to prove the database refuses.

Archiving or deleting the current semester is refused with a `CONFLICT` —
silently leaving an account with no current semester would empty every
academic surface with no explanation.

## Attachments

`Attachment` stores **metadata only**. Phase 3 ships the table and the
`StorageProvider` interface and nothing else: no upload endpoint, no bucket,
no UI. Large files never go into PostgreSQL. The table exists so the phase
that adds a provider does not also have to migrate every entity that wants
attachments.
