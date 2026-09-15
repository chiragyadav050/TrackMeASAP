# Development

Day-to-day workflow, conventions, and the things that will otherwise cost you
an hour.

---

## Clerk setup

**The repository ships with placeholder Clerk keys that do not work.** They are
syntactically valid — enough for the server to boot and for protected routes to
demonstrably redirect — but no real Clerk instance stands behind them.

### What breaks without real keys

A Clerk development key (`pk_test_…`) makes the middleware perform a
**handshake**: when the `__clerk_db_jwt` dev-browser cookie is missing, the
browser is redirected to the instance's Frontend API host to obtain it. With
the placeholder key that host does not exist, so Clerk answers:

```json
{ "errors": [{ "message": "Invalid host", "code": "host_invalid" }] }
```

and the browser lands on `*.clerk.accounts.dev` instead of the app. Server-side
requests (curl, the health endpoint, Playwright's `request` fixture) are
unaffected — only browsers are.

### Fixing it

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com).
2. **API Keys** → copy both values into `.env`:

   ```bash
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_…"   # public
   CLERK_SECRET_KEY="sk_test_…"                    # secret, never expose
   ```

3. Restart the dev server. Sign-up, sign-in and the full browser E2E suite all
   start working; nothing in the code needs to change.

### Optional: the deletion webhook

Only needed if you want `user.deleted` handled while the user is away.

1. Dashboard → **Webhooks** → add an endpoint at
   `https://<your-host>/api/webhooks/clerk`
2. Subscribe to `user.created`, `user.updated`, `user.deleted`
3. Copy the signing secret into `CLERK_WEBHOOK_SIGNING_SECRET`

Without it the route answers 503 and the application stays correct via
just-in-time provisioning.

---

## Database

### Making a schema change

```bash
# 1. Edit prisma/schema.prisma
# 2. Create and apply the migration
pnpm db:migrate --name add_task_model
# 3. The client regenerates automatically; if not:
pnpm db:generate
```

### Prisma 7 gotchas

- **The URL is not in `schema.prisma`.** It lives in `prisma.config.ts` for the
  CLI, and in the `@prisma/adapter-pg` adapter for the app.
- **The client is generated to `src/generated/prisma`** and is git-ignored.
  `postinstall` regenerates it, so a fresh clone works after `pnpm install`.
- **`@prisma/client-runtime-utils` is a direct dependency.** With pnpm's
  isolated `node_modules`, generated code inside `src/` cannot resolve a
  transitive dependency of `@prisma/client`, so it is declared explicitly.
- **Migration SQL is excluded from Prettier.** Reformatting it would break the
  checksum Prisma compares against applied migrations.

### Resetting local data

```bash
pnpm exec prisma migrate reset   # drops, recreates, re-applies. Destroys data.
```

---

## Conventions

### Where does this code go?

| If it…                                    | It belongs in…                |
| ----------------------------------------- | ----------------------------- |
| renders something                         | `components/` or `features/`  |
| decides something about the domain        | `services/`                   |
| touches the database                      | `services/` (via `server/db`) |
| resolves who is asking                    | `server/auth.ts`              |
| is a pure function with no framework ties | `lib/`                        |
| is a constant the whole app reads         | `config/`                     |
| crosses the client/server boundary        | `types/`                      |

### Working on tasks

Read `docs/ARCHITECTURE.md` § "Phase 2 — Tasks and Today" first. The rules
that will bite you if you skip it:

1. **`profileId` is always the first argument** to a service function, and it
   always comes from the session. Never read the session inside a service.
2. **Put business rules in `task.derive.ts` or `task.prioritization.ts`.**
   Both are pure — no Prisma, no React, no `server-only` — which is why they
   are testable with plain objects. If you find yourself computing "is this
   overdue" in a component, it belongs there instead.
3. **Never compute a date on the client.** `Date#getHours()` reads the
   browser's zone. The server puts finished strings on `TaskDto`
   (`dueLabel`, `overdueLabel`, `dueDateInput`, …); render those.
4. **Overdue is derived, never stored.** Use `isOverdue()` in code and
   `buildTaskWhere()` when the database has to filter by it.
5. **Use the action factories.** `createAuthenticatedAction` for `<form>`
   posts, `createAuthenticatedCommand` for typed arguments. Both give you
   auth, rate limiting, validation and safe errors; hand-rolling one gives you
   none of them.

### Working on academics

Read `docs/ARCHITECTURE.md` § "Phase 3 — Academics" first. The rules that will
bite you if you skip it:

1. **DATE-ONLY vs INSTANT.** Semester dates and `assignedAt` are `@db.Date` —
   no zone, anchored at UTC midnight, converted with `toDateOnly()`. Class
   times, deadlines and exams are real instants converted **from** the
   profile's zone with `toInstant()`. Mixing them ships a system that is a day
   out for anyone east of Greenwich.
2. **Attendance arithmetic lives in `attendance.calculator.ts`.** It is pure
   and has 40 tests. Do not recompute a percentage anywhere else — the UI
   renders what the calculator returned.
3. **Excused classes are excluded from BOTH sides** of the percentage. Zero
   eligible classes yields `null`, never 0%.
4. **Never attach attendance to a `ClassSchedule`.** It attaches to a
   `ClassSession` — the rule versus the fact. See the architecture note.
5. **Work status and submission status are independent.** Completing an
   assignment does not submit it; submitting does not complete it. "Graded" is
   `marksObtained != null`, not a status.
6. **Exam preparation is a plain completed/total count.** Importance shapes
   the priority engine, not the headline figure.

### Adding a task field

```text
1. prisma/schema.prisma          add the column (+ an index if it will be queried)
2. pnpm db:migrate --name …
3. task.schema.ts                add it to the Zod schemas
4. task.service.ts               write it
5. types/task.ts + task.query.ts add it to TaskDto and the mapper
6. components/task-dialog.tsx    add the control
7. tests                         unit for the rule, integration for the write
```

### The `server-only` rule

`src/server/**` and `src/services/**` import `server-only`. If a Client
Component reaches them, **the build fails** — which is the point.

If you need a _type_ from a server module in a form, put the type in
`src/types/` instead. This is not hypothetical: `ActionState` used to live in
`src/server/action.ts`, and importing it from a form pulled Prisma and `pg`
into the browser bundle.

### Writing a server action

Never hand-roll one. Use the factory:

```ts
"use server";

export const doSomethingAction = createAuthenticatedAction({
  name: "domain.doSomething", // used for logs and the rate-limit bucket
  schema: someZodSchema,
  handler: async (input, { profile, logger }) => {
    const result = await someService(profile.id, input);
    revalidatePath("/", "layout");
    return toSomeDto(result);
  },
});
```

You get authentication, per-profile rate limiting, validation, structured
logging and safe error messages for free — and consistently.

### Writing a service function

Take identity as an **explicit argument**. Never read the session inside a
service. That keeps services testable and makes it structurally impossible to
write one that trusts a client-supplied id.

```ts
// Good
export async function updateThing(profileId: string, input: Input) { … }

// Wrong — now the service depends on request context
export async function updateThing(input: Input) {
  const { userId } = await auth();
}
```

### Errors

Never put a raw `error.message` in front of a user. Throw an `AppError` with a
`userMessage`, or let `toAppError()` collapse it to the generic one.

```ts
throw notFound("Subject");
throw validationFailed({ title: ["Required."] });
throw forbidden();
```

### Logging

```ts
const log = logger.child({ service: "task" });
log.info("Task created", { taskId: task.id });
```

Never log a raw request body, a token, or anything from `process.env`. The
redactor catches the obvious keys, but it is a safety net, not a licence.

---

## Testing

### The three test layers

| Layer       | Command                 | Needs                        | Covers                                                                                                     |
| ----------- | ----------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Unit        | `pnpm test`             | nothing                      | Pure logic: time maths, prioritisation, derivations, schemas, redaction                                    |
| Integration | `pnpm test:integration` | PostgreSQL                   | The service layer against a real database: CRUD, **ownership**, subtasks, bulk, Today grouping, statistics |
| E2E         | `pnpm test:e2e`         | PostgreSQL + real Clerk keys | Browser journeys against a production build                                                                |

`pnpm test:all` runs the first two.

### Unit tests — Vitest

```bash
pnpm test            # run once
pnpm test:watch      # watch
pnpm test:coverage   # with coverage
```

Scope is the pure layers: environment validation, error normalisation, time
maths, rate limiting, navigation resolution, profile schemas, and the pure
parts of the auth helpers.

Things needing a live Clerk session or a database are **not** unit-tested with
mocks. A test that asserts a mock behaves like the mock proves nothing; those
paths belong in Playwright where they run for real.

`server-only` is aliased to `tests/stubs/server-only.ts` — the real module
throws outside an RSC context, and that guard is enforced by the Next.js build
anyway.

Environment is `node` by default. The two files that need a DOM (the
keyboard-shortcut guard, and the presentational badge components) opt in with
a `@vitest-environment jsdom` docblock rather than making every file pay for
jsdom startup.

### Integration tests — Vitest against real PostgreSQL

```bash
createdb -O life_os life_os_test     # once
pnpm db:test:setup                   # applies migrations to TEST_DATABASE_URL
pnpm test:integration
```

They run the genuine service layer against a genuine database. That is the
point: ownership scoping, cascade deletes, enum defaults and the generated
WHERE clauses all live in the boundary between our code and PostgreSQL, and a
mocked Prisma would assert none of them.

`tests/integration/setup.ts` **refuses to run** unless `TEST_DATABASE_URL` is
set, differs from `DATABASE_URL`, and contains the word `test`. These tests
delete rows; a misconfigured URL pointing at the dev database would destroy
real data silently.

Fixtures create two profiles per file, because most of what is being proven is
that one cannot reach the other's data.

Every date-sensitive test passes a **fixed `now`**. A test that reads the real
clock is a test that fails at midnight, and day-boundary correctness is
exactly what this module is for.

### End-to-end tests — Playwright

```bash
pnpm test:e2e        # headless, against a real production build
pnpm test:e2e:ui     # interactive
```

The suite builds and serves the app with `next build && next start`, so what is
tested is what would ship.

Two files, deliberately split:

| File            | Needs Clerk? | Covers                                                                               |
| --------------- | ------------ | ------------------------------------------------------------------------------------ |
| `api.spec.ts`   | No           | Health + live DB, webhook signature rejection, security headers, no-secret-in-bundle |
| `smoke.spec.ts` | **Yes**      | Landing page, auth surfaces, route protection, 404, theming, responsive, a11y        |

`smoke.spec.ts` **skips entirely** unless a real Clerk instance is configured
(detected in `tests/e2e/clerk-env.ts` by decoding the publishable key). With
placeholder keys the browser never reaches the app, so those tests would be
testing Clerk's error page.

Skipping loudly is the honest outcome. The alternative — mocking Clerk — would
produce a green suite that proves nothing.

Once you add real keys, `pnpm test:e2e` runs all 30 tests with no code change.

#### Signed-in E2E (not yet wired)

Testing an _authenticated_ journey needs `@clerk/testing`:

```bash
pnpm add -D @clerk/testing
```

Then add a global setup calling `clerkSetup()`, and use
`setupClerkTestingToken()` in a fixture. This requires a real Clerk **test**
instance and a test user, so it is deliberately left for whoever has those
credentials rather than stubbed out now.

---

## Debugging

| Symptom                                           | Cause                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Module not found: Can't resolve 'util/types'`    | A Client Component imported a `server-only` module. Follow the import trace in the build output. |
| Browser redirects to `*.clerk.accounts.dev`       | Placeholder Clerk keys — see the top of this file.                                               |
| `Invalid server environment configuration`        | `.env` is missing or malformed. The message names every problem at once.                         |
| Prisma cannot find `@prisma/client-runtime-utils` | Run `pnpm install`; it is a direct dependency for a reason.                                      |
| Theme flashes on load                             | `suppressHydrationWarning` was removed from `<html>`.                                            |
| A server action silently shows a generic error    | Something threw. Check the server log for the matching `action:` entry.                          |

### Log levels

```bash
LOG_LEVEL=debug pnpm dev   # includes Prisma queries
```

---

## Before you call it done

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

All seven. Two are non-negotiable and often skipped:

- **`pnpm build`** runs its own typecheck and is the only thing that verifies
  the client/server boundary. A type imported from `src/server/**` into a form
  is a build failure and nothing else catches it.
- **`pnpm test:integration`** is the only layer that proves ownership scoping
  actually holds against a real database.
