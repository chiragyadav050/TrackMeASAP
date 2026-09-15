import { z } from "zod";

/**
 * Environment schemas.
 *
 * This module is deliberately side-effect free: it never touches
 * `process.env`. That keeps it trivially unit-testable and lets the
 * server/client entrypoints decide *when* validation runs.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * An optional variable whose EMPTY STRING means "not configured".
 *
 * `VAR=""` is how a `.env` file says "I am not using this", and it is what
 * `.env.example` ships. Plain `.optional()` does not cover it: an empty
 * string is still a string, so it reaches the format check and fails — which
 * would make the app refuse to boot for every user who has not set up a
 * Telegram bot. The blank is normalised to `undefined` BEFORE validation, so
 * a value that IS present is still held to its full format.
 */
function optionalSecret<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

/**
 * Server-only configuration. Anything in here is a secret or an
 * infrastructure detail and must never reach the client bundle.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://)",
    ),

  CLERK_SECRET_KEY: z
    .string()
    .min(1, "CLERK_SECRET_KEY is required")
    .startsWith(
      "sk_",
      "CLERK_SECRET_KEY must start with 'sk_' — copy it from the Clerk dashboard",
    ),

  /** Only required when the Clerk webhook endpoint is enabled. */
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1).optional(),

  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

  /**
   * Direct (non-pooled) connection, used ONLY by the Prisma CLI for
   * migrations. Required by Supabase, where DATABASE_URL points at the
   * transaction pooler; unnecessary for a plain local Postgres.
   */
  DIRECT_URL: optionalSecret(z.string().min(1)),

  /**
   * Background processing (Phase 6). OPTIONAL: without it the app is fully
   * usable and only scheduled reminder firing stops.
   */
  REDIS_URL: optionalSecret(z.string().min(1)),

  /**
   * Telegram (Phase 7). Both OPTIONAL — the bot is an add-on, and the web app
   * does not depend on it.
   *
   * These are secrets. They are validated for SHAPE only; no part of either
   * value is ever logged, returned from an API, or sent to the client.
   */
  TELEGRAM_BOT_TOKEN: optionalSecret(
    z
      .string()
      .regex(
        /^\d+:[A-Za-z0-9_-]{30,}$/,
        "TELEGRAM_BOT_TOKEN should look like 123456:ABC-DEF… — copy it from BotFather",
      ),
  ),

  /**
   * Proves an inbound webhook really came from Telegram. Separate from the
   * bot token because the webhook URL is effectively public.
   */
  /**
   * Gemini (Phase 8). OPTIONAL — with no key the assistant reports itself
   * offline rather than inventing answers.
   */
  GEMINI_API_KEY: optionalSecret(z.string().min(20)),

  TELEGRAM_WEBHOOK_SECRET: optionalSecret(
    z
      .string()
      .min(
        32,
        "TELEGRAM_WEBHOOK_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`",
      ),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Public configuration. Values here are inlined into the JavaScript sent to
 * the browser, so they must contain nothing sensitive.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required")
    .startsWith(
      "pk_",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must start with 'pk_' — copy it from the Clerk dashboard",
    ),

  NEXT_PUBLIC_APP_URL: z.url("NEXT_PUBLIC_APP_URL must be an absolute URL"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Turns a Zod failure into an operator-facing message that names every broken
 * variable at once, rather than failing one at a time across restarts.
 */
export function formatEnvIssues(
  scope: "server" | "client",
  error: z.ZodError,
): string {
  const lines = error.issues.map((issue) => {
    const variable = issue.path.join(".") || "(root)";
    return `  • ${variable}: ${issue.message}`;
  });

  return [
    `Invalid ${scope} environment configuration:`,
    ...lines,
    "",
    "Fix your .env file — see .env.example for the full list of variables.",
  ].join("\n");
}

/**
 * Parses and validates the server environment. Throws with an aggregated,
 * human-readable message when anything is missing or malformed.
 */
export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(formatEnvIssues("server", result.error));
  }

  return result.data;
}

/**
 * Parses and validates the public environment.
 *
 * Callers must pass explicit `process.env.NEXT_PUBLIC_*` literals: Next.js
 * inlines public variables by matching the literal text, so a dynamic lookup
 * such as `process.env[key]` would resolve to `undefined` in the browser.
 */
export function parseClientEnv(source: Record<string, unknown>): ClientEnv {
  const result = clientEnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(formatEnvIssues("client", result.error));
  }

  return result.data;
}
