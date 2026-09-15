import { describe, expect, test } from "vitest";

import { createInMemoryRateLimiter } from "@/lib/rate-limit";

/** A controllable clock, so nothing here depends on real elapsed time. */
function createClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("createInMemoryRateLimiter", () => {
  test("allows requests up to the limit and refuses the next one", async () => {
    const clock = createClock();
    const limiter = createInMemoryRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: clock.now,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await limiter.check("profile:a");
      expect(result.allowed).toBe(true);
    }

    const blocked = await limiter.check("profile:a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  test("counts down the remaining allowance", async () => {
    const limiter = createInMemoryRateLimiter({
      limit: 3,
      windowMs: 60_000,
      now: createClock().now,
    });

    expect((await limiter.check("profile:a")).remaining).toBe(2);
    expect((await limiter.check("profile:a")).remaining).toBe(1);
    expect((await limiter.check("profile:a")).remaining).toBe(0);
  });

  test("keys are isolated, so one user cannot exhaust another's budget", async () => {
    const limiter = createInMemoryRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: createClock().now,
    });

    expect((await limiter.check("profile:a")).allowed).toBe(true);
    expect((await limiter.check("profile:a")).allowed).toBe(false);
    expect((await limiter.check("profile:b")).allowed).toBe(true);
  });

  test("resets once the window has elapsed", async () => {
    const clock = createClock();
    const limiter = createInMemoryRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    expect((await limiter.check("profile:a")).allowed).toBe(true);
    expect((await limiter.check("profile:a")).allowed).toBe(false);

    clock.advance(60_000);

    expect((await limiter.check("profile:a")).allowed).toBe(true);
  });

  test("reports a retry-after of at least one second while blocked", async () => {
    const clock = createClock();
    const limiter = createInMemoryRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: clock.now,
    });

    await limiter.check("profile:a");

    const blocked = await limiter.check("profile:a");
    expect(blocked.retryAfterSeconds).toBe(60);

    // Even at the very end of the window, never advertise a 0s retry — a
    // client that honoured it would immediately be refused again.
    clock.advance(59_900);
    const nearReset = await limiter.check("profile:a");
    expect(nearReset.allowed).toBe(false);
    expect(nearReset.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  test("reports retryAfterSeconds as 0 when the request is allowed", async () => {
    const limiter = createInMemoryRateLimiter({
      limit: 5,
      windowMs: 60_000,
      now: createClock().now,
    });

    expect((await limiter.check("profile:a")).retryAfterSeconds).toBe(0);
  });
});
