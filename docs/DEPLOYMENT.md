# Deployment

Vercel for the app, Supabase for the database. Supabase is already migrated
and hardened; what remains is hosting.

The real values for everything below are in `.env.vercel` on the machine that
built this. That file is gitignored and must stay that way.

---

## 1. Environment variables

Set all ten in the Vercel dashboard, for **Production, Preview and
Development**. The app validates them at boot and refuses to start if one is
missing, so a typo fails loudly rather than at 3am.

| Variable                            | Notes                                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | Supabase **transaction pooler** (port 6543), with `?pgbouncer=true&connection_limit=1`. Serverless opens many short connections; the direct port runs out. |
| `DIRECT_URL`                        | Supabase **direct** connection (port 5432). Migrations only — they need features the pooler does not offer.                                                |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Public by design.                                                                                                                                          |
| `CLERK_SECRET_KEY`                  | Secret.                                                                                                                                                    |
| `NEXT_PUBLIC_APP_URL`               | The real deployed URL. Used to build absolute links in notifications, so a wrong value produces broken links rather than an error.                         |
| `LOG_LEVEL`                         | `info` in production.                                                                                                                                      |
| `TELEGRAM_BOT_TOKEN`                | Secret. Omit to disable the bot cleanly.                                                                                                                   |
| `TELEGRAM_WEBHOOK_SECRET`           | Any long random string. Telegram echoes it back and the webhook rejects anything else.                                                                     |
| `GEMINI_API_KEY`                    | Secret. Omit to disable the AI assistant cleanly.                                                                                                          |
| `CRON_SECRET`                       | Vercel sends it to `/api/cron`. **Without it the route refuses every request and no reminder ever fires.**                                                 |

The password in both database URLs contains `@`, which must be
percent-encoded as `%40` or the URL parses as the wrong host.

## 2. Build settings

Defaults are correct. `pnpm build` runs `prisma generate` first, so the client
is always built against the committed schema.

Migrations do **not** run automatically — deliberately. A failed migration
mid-deploy is far worse than a deploy that starts a moment later. Run them
yourself, from a machine with `DIRECT_URL` set:

```bash
pnpm exec prisma migrate deploy
```

## 3. Cron

`vercel.json` declares both schedules; Vercel picks them up on deploy.

| Path                      | Schedule     | Does                                                                                                          |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `/api/cron?job=reminders` | every minute | fires due reminders, flushes any held by quiet hours                                                          |
| `/api/cron?job=proactive` | hourly       | the proactive scan — acts at most once per local day per person, so hourly just gives every timezone its turn |

Verify after deploying:

```bash
curl -i https://<your-app>/api/cron          # expect 401
```

A 401 is the correct answer — it proves the endpoint is closed to the public.
Vercel's own invocations appear under the project's Cron tab.

## 4. Telegram webhook

Once the URL is live:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<your-app>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## 5. Clerk production instance

The committed keys are `pk_test_`/`sk_test_` — a Clerk **development**
instance. It works, but it is rate-limited, shows a development banner, and is
not meant for other people. Before sharing the app: create a production
instance in Clerk, point it at the deployed domain, and replace both keys.

---

## What runs where

`pnpm worker` (BullMQ + Redis) is the local/VPS path and needs a process that
stays alive — which Vercel does not have. The cron route above replaces it.
Both call the identical functions in `src/server/jobs.ts`, so the two
deployment styles cannot drift apart.

`REDIS_URL` is therefore **not** set on Vercel. That is intentional, not an
omission.

### One honest degradation

`src/lib/rate-limit.ts` counts in process memory. Each serverless instance
keeps its own counter, so the effective limit is roughly `limit × instances`
rather than `limit`, and a cold start resets it.

This is a throttle, not a security control — every mutation is independently
authorised by an ownership check in its service, so a caller who evades the
limiter still cannot reach another user's data. Moving it to Redis is the fix
if it ever guards something metered.
