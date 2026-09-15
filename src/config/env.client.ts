import { parseClientEnv, type ClientEnv } from "@/config/env.schema";

/**
 * Validated public environment, safe to import from client components.
 *
 * The `process.env.NEXT_PUBLIC_*` references below are written out literally
 * on purpose — Next.js performs a textual substitution at build time, so a
 * computed lookup would be `undefined` in the browser.
 */

let cached: ClientEnv | null = null;

export function getClientEnv(): ClientEnv {
  cached ??= parseClientEnv({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });

  return cached;
}
