/**
 * Rate limiting abstraction.
 *
 * Phase 1 ships a single in-memory implementation, which is correct for a
 * single-process deployment and honest about its limits: it does not
 * coordinate across instances. The `RateLimiter` interface exists so that a
 * Redis-backed limiter can be dropped in later (Phase 7+) without touching
 * any call site.
 */

export type RateLimitResult = {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets. `0` when the request was allowed. */
  readonly retryAfterSeconds: number;
};

export type RateLimiter = {
  /**
   * @param key Caller-scoped identity, e.g. `profile:${id}:update-preferences`.
   *            Must never be attacker-controlled on its own.
   */
  check(key: string): Promise<RateLimitResult>;
};

export type FixedWindowOptions = {
  /** Maximum requests permitted inside one window. */
  readonly limit: number;
  readonly windowMs: number;
  /** Injectable clock; keeps the limiter deterministic under test. */
  readonly now?: () => number;
};

type WindowState = {
  count: number;
  resetAt: number;
};

/**
 * Fixed-window counter held in process memory.
 *
 * Entries are evicted lazily on access plus opportunistically when the map
 * grows past `MAX_TRACKED_KEYS`, so a long-lived process cannot leak memory
 * from one-off keys.
 */
export function createInMemoryRateLimiter(
  options: FixedWindowOptions,
): RateLimiter {
  const MAX_TRACKED_KEYS = 10_000;
  const now = options.now ?? (() => Date.now());
  const windows = new Map<string, WindowState>();

  const evictExpired = (currentTime: number): void => {
    for (const [key, state] of windows) {
      if (state.resetAt <= currentTime) {
        windows.delete(key);
      }
    }
  };

  return {
    check(key: string): Promise<RateLimitResult> {
      const currentTime = now();
      const existing = windows.get(key);

      if (!existing || existing.resetAt <= currentTime) {
        if (windows.size >= MAX_TRACKED_KEYS) {
          evictExpired(currentTime);
        }

        windows.set(key, {
          count: 1,
          resetAt: currentTime + options.windowMs,
        });

        return Promise.resolve({
          allowed: true,
          remaining: options.limit - 1,
          retryAfterSeconds: 0,
        });
      }

      if (existing.count >= options.limit) {
        return Promise.resolve({
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - currentTime) / 1000),
          ),
        });
      }

      existing.count += 1;

      return Promise.resolve({
        allowed: true,
        remaining: options.limit - existing.count,
        retryAfterSeconds: 0,
      });
    },
  };
}

/**
 * Default limiter for authenticated mutations. Generous enough that no real
 * user notices it, tight enough to stop a runaway client or a scripted abuse
 * loop from hammering the database.
 *
 * SERVERLESS CAVEAT (Vercel). This counter lives in PROCESS MEMORY, so each
 * serverless instance keeps its own. Under load the effective limit becomes
 * roughly `limit × instances` rather than `limit`, and a cold start resets
 * it. That is a deliberate, documented trade-off rather than an oversight:
 *
 *   • It is NOT a security control. Every mutation is independently
 *     authorised by an ownership check in its service — a caller who evades
 *     the limiter still cannot touch another user's data.
 *   • Its job is to stop a runaway loop from melting the database, and it
 *     still does that, because each instance is individually capped.
 *
 * Making it exact would mean a shared store (Redis). If this ever guards
 * something where the precise number matters — a paid API, an email sender —
 * move it to Redis then, and not before.
 */
export const mutationRateLimiter: RateLimiter = createInMemoryRateLimiter({
  limit: 30,
  windowMs: 60_000,
});
