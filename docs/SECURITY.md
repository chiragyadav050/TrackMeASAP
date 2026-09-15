# Security

The security model as built in Phase 1, the checklist every change is held to,
and an honest list of what is **not** done yet.

---

## Threat model

Life OS holds one person's coursework, schedule, health notes and finances.
The things that matter most:

1. **Cross-tenant access** — one user reading or writing another's data.
2. **Secret exposure** — a server key reaching the browser or the logs.
3. **Session compromise** — handled by Clerk, but our own redirect and
   cookie behaviour must not undermine it.
4. **Injection** — untrusted input reaching the database or the DOM.

---

## Authentication and authorization

### Identity comes from the session, always

No endpoint, action or service accepts a user id from the client. Every entry
point resolves the actor from the Clerk session:

| Entry point   | Guard                       | Anonymous gets      |
| ------------- | --------------------------- | ------------------- |
| Page / layout | `requireProfileForPage()`   | Redirect to sign-in |
| Server action | `createAuthenticatedAction` | Typed error state   |
| Route handler | `requireProfile()`          | 401 envelope        |

### Protection is on the resource, not the URL

`src/proxy.ts` attaches the session and makes **no** authorization decision.

This is deliberate, and matches Clerk 7's deprecation of `createRouteMatcher`:
path-pattern matching can diverge from how Next.js actually resolves a request,
leaving a resource reachable because a regex did not match the URL that got
there. Guarding the data instead removes that entire class of bug.

The `(app)` layout is what protects the twelve authenticated pages — Next.js
renders a layout around its children, so its redirect runs before any child
page's code does.

### Insecure direct object references

Structurally prevented: services take `profileId` as an explicit argument, and
that value comes from the session. There is no code path where a request body
can name the record owner.

Every owned entity — `Task`, `Subtask`, `ActivityEvent`, and the eleven
academic models added in Phase 3 — carries a required `profileId` with
`onDelete: Cascade`, and every query is scoped by it. Two enforcement
patterns:

- **Single-row mutations** call `requireOwnedTask(profileId, taskId)`, whose
  WHERE clause contains both — so a foreign id matches nothing.
- **Bulk operations** put ownership directly in `updateMany`'s WHERE clause,
  so foreign ids cannot be touched even when mixed into a legitimate request.

Nested entities — `Subtask`, `ExamTopic`, `AttendanceRecord` — carry a
**denormalised `profileId`** so their mutations prove ownership with one
indexed lookup rather than a join through the parent. An authorization check
should not depend on a join being written correctly.

Guards that accept a parent id (creating a subject under a semester, an
assignment under a subject, a study session against an exam) verify the parent
too. Without that, a legitimate id in one field would smuggle a foreign one
through in another — a case the academic authorization tests exercise
explicitly.

**Failures report `NOT_FOUND`, never `FORBIDDEN`.** A 403 would confirm that
an id exists and belongs to somebody, turning the API into an id oracle.

This is verified, not assumed. `tests/integration/task-authorization.test.ts`
and `tests/integration/academics-authorization.test.ts` invoke **every**
operation on every owned entity with the wrong profile, against two real
profiles in a real database, asserting both that the call refuses and that the
victim's row is byte-for-byte unchanged.

---

## Secrets

### Split by reachability, enforced by the compiler

| Module                     | Contains                           | Guard         |
| -------------------------- | ---------------------------------- | ------------- |
| `src/config/env.server.ts` | `DATABASE_URL`, `CLERK_SECRET_KEY` | `server-only` |
| `src/config/env.client.ts` | `NEXT_PUBLIC_*` only               | —             |

`server-only` makes the **build fail** if a secret-bearing module becomes
reachable from a Client Component. This is not decorative — it caught a real
leak during Phase 1 (a form importing a type from `src/server/action.ts` pulled
the whole database graph toward the browser bundle).

An E2E test (`api.spec.ts`) additionally asserts that no `sk_`, no
`postgresql://` and no `DATABASE_URL` string appears in the served HTML.

### Validation at the boundary

Every variable is checked by Zod at startup. `CLERK_SECRET_KEY` must start with
`sk_`; `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` must start with `pk_` — so pasting
one into the other's slot fails immediately and loudly rather than at some
later, more confusing point.

### Never committed

`.gitignore` excludes `.env` and `.env.*` except `.env.example`, plus `*.pem`
and `*.key`.

> The `.env` in this repository contains **non-functional placeholder** Clerk
> values and a local-only database password. No real credential has been
> committed.

---

## Input validation

Everything crossing a trust boundary is parsed by Zod before use:

- Server actions validate raw `FormData` (`createAuthenticatedAction` step 3)
- Typed commands validate their argument identically
  (`createAuthenticatedCommand`) — an argument from the client is exactly as
  untrusted as a request body
- Bulk operations bound their batch size (`MAX_BULK_TASKS`), so one request
  cannot be turned into an unbounded write
- `reorderSubtasks` requires the submitted ids to be _exactly_ the task's own
  subtasks, rejecting rather than partially applying — a smuggled foreign id
  cannot reattach another user's subtask
- Environment variables are validated at startup
- Webhook payloads are **signature-verified before the body is read**

Client-side validation exists for feedback only. The server check is the one
that counts, and it re-runs the identical schema.

---

## Webhooks

`/api/webhooks/clerk` is publicly reachable by necessity. Therefore:

- The payload is attacker-controlled until `verifyWebhook()` returns. Nothing
  is read from the body before the Svix signature is checked.
- Without `CLERK_WEBHOOK_SIGNING_SECRET` the route refuses every request; it
  never processes an unverified one.
- Failures log a warning and return a generic message — the response never
  discloses which check failed. An E2E test asserts the response body contains
  no mention of `svix`, `signing`, `secret` or a stack trace.

---

## Output safety

### Errors never leak internals

`AppError` carries a technical `message` for logs and a separate `userMessage`
for humans. `toAppError()` collapses unknown throwables to a generic internal
error, which is precisely how `PrismaClientKnownRequestError P2002` reaches the
logs and never the screen.

Error boundaries render only a Next.js **digest** — an opaque id that maps to
the full trace server-side.

### Database-level invariants

Some rules are too important to leave to application code. "At most one
current semester per profile" is enforced by a **partial unique index**
(`WHERE is_current`) written by hand in the migration, in addition to the
service transaction that maintains it. A future code path that forgets to
clear the previous flag fails loudly instead of silently leaving an account
with two current semesters and a dashboard that picks one at random.

### File attachments are not implemented

`Attachment` stores metadata; no `StorageProvider` is registered, no upload
endpoint exists, and no UI offers it. `getStorageProvider()` throws rather
than accepting an upload and quietly dropping it — a file the user believes is
saved but is not would be worse than no attachments at all.

When a provider is added: pre-signed URLs only (uploads must not pass through
the application server), the profile id must be part of the key namespace, and
`STORAGE_LIMITS` caps size and MIME type.

### The activity log is not a second copy of user content

`ActivityEvent.metadata` stores changed field **names** and coarse values
only — never a full entity snapshot and never task notes or descriptions.
Without that rule the audit table would quietly become an unguarded duplicate
of the user's private content.

### Logs never leak secrets

`src/lib/logger.ts` redacts values whose key matches `password`, `secret`,
`token`, `apikey`, `authorization`, `cookie`, `session`, `credential`,
`signature` or `database_url`, recursively, before writing. Unit-tested as a
security control, not as a nicety.

### XSS

No `dangerouslySetInnerHTML` anywhere in the codebase. React escapes by
default and nothing here opts out.

---

## HTTP headers

Set in `next.config.ts` for every response:

| Header                      | Value                                                          |
| --------------------------- | -------------------------------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                                      |
| `X-Frame-Options`           | `DENY`                                                         |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                              |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                          |

`X-Powered-By` is disabled — the framework version is not advertised. All of
the above are asserted by an E2E test.

---

## Rate limiting

`createAuthenticatedAction` throttles every mutation per authenticated profile
(30 requests / 60s by default).

**Known limitation, stated plainly:** the Phase 1 limiter is in-memory and
therefore **per-process**. It stops a runaway client or a scripted loop against
a single instance. It does **not** coordinate across a multi-instance
deployment. `RateLimiter` is an interface precisely so a Redis-backed
implementation can replace it without touching a call site — planned for
Phase 6, when Redis arrives for background jobs.

---

## Not done yet

Listed so nobody assumes otherwise.

| Gap                                   | Why                                                                                                                                                                                             | When                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **No Content-Security-Policy**        | A useful CSP needs a per-request nonce generated in the proxy, plus Clerk's origins allow-listed. A half-applied CSP is worse than none — it creates false confidence and breaks in production. | Before first deploy |
| **Distributed rate limiting**         | In-memory only; see above.                                                                                                                                                                      | Phase 6             |
| **No audit log**                      | Nothing writes a security-event trail yet.                                                                                                                                                      | Phase 5+            |
| **No CSRF token**                     | Next.js server actions carry built-in origin checks, and there are no cookie-authenticated custom `POST` forms. Revisit if one is added.                                                        | As needed           |
| **Dependency scanning not automated** | `pnpm audit` is run manually.                                                                                                                                                                   | With CI             |
| **No account-deletion self-service**  | Deletion flows through Clerk + the webhook.                                                                                                                                                     | Phase 5+            |

---

## Checklist for every change

Before merging anything that touches data or auth:

- [ ] Identity derived from the Clerk session, never from client input
- [ ] Ownership enforced server-side (`profileId` scoping on reads _and_ writes)
- [ ] All external input validated with Zod at the boundary
- [ ] No secret reachable from a Client Component (`pnpm build` proves it)
- [ ] No raw `error.message` rendered to a user
- [ ] Nothing sensitive logged — no bodies, tokens or env values
- [ ] Mutations go through `createAuthenticatedAction` (so they are rate limited)
- [ ] New env vars added to `env.schema.ts` **and** `.env.example`, with the
      public/secret split correct
- [ ] No new `dangerouslySetInnerHTML`
- [ ] `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass

### Escalate immediately if

- A secret may have been committed → rotate it first, then remove it from
  history
- A query is discovered without `profileId` scoping
- Any user input reaches a raw SQL string

---

## Reporting

This is a personal project with no public deployment. If it gains one, add a
disclosure contact here before the first external user.
