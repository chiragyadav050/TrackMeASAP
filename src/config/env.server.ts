import "server-only";

import {
  parseServerEnv,
  type ServerEnv,
  type LogLevel,
} from "@/config/env.schema";

/**
 * Validated server environment.
 *
 * Importing this module from anywhere reachable by the client bundle is a
 * build error thanks to `server-only`, so secrets cannot leak by accident.
 *
 * Validation is lazy (first access) rather than at import time so that a
 * container image build can run `next build` without runtime secrets when
 * `SKIP_ENV_VALIDATION=1` is set.
 */

const SKIP_VALIDATION = process.env.SKIP_ENV_VALIDATION === "1";

let cached: ServerEnv | null = null;

function buildServerEnv(): ServerEnv {
  if (SKIP_VALIDATION) {
    // Build-time escape hatch: fall back to inert placeholders so module
    // graphs can be compiled without secrets. Any real use of these values at
    // runtime will fail loudly at the point of use (e.g. the database refuses
    // the connection), which is the behaviour we want.
    return {
      NODE_ENV: (process.env.NODE_ENV as ServerEnv["NODE_ENV"]) ?? "production",
      DATABASE_URL: "postgresql://skipped:skipped@localhost:5432/skipped",
      CLERK_SECRET_KEY: "sk_skipped",
      CLERK_WEBHOOK_SIGNING_SECRET: undefined,
      LOG_LEVEL: (process.env.LOG_LEVEL as LogLevel) ?? "info",
    };
  }

  return parseServerEnv(process.env);
}

export function getServerEnv(): ServerEnv {
  cached ??= buildServerEnv();
  return cached;
}

/** Convenience accessors for the handful of call sites that need one value. */
export const isProduction = (): boolean =>
  getServerEnv().NODE_ENV === "production";

export const isDevelopment = (): boolean =>
  getServerEnv().NODE_ENV === "development";
