import { describe, expect, test } from "vitest";

import { __testing } from "@/lib/logger";

const { redact, shouldRedact } = __testing;

/**
 * The logger's redaction is a security control, not a nicety: it is the thing
 * standing between "we log request context" and "we logged a session token".
 */
describe("shouldRedact", () => {
  test("matches secret-bearing keys case-insensitively", () => {
    for (const key of [
      "password",
      "Password",
      "CLERK_SECRET_KEY",
      "sessionToken",
      "authorization",
      "Cookie",
      "apiKey",
      "api_key",
      "DATABASE_URL",
      "dbCredential",
      "svix-signature",
    ]) {
      expect(shouldRedact(key), key).toBe(true);
    }
  });

  test("leaves ordinary keys alone", () => {
    for (const key of ["profileId", "code", "route", "count", "timeZone"]) {
      expect(shouldRedact(key), key).toBe(false);
    }
  });
});

describe("redact", () => {
  test("replaces secret values while keeping the surrounding context", () => {
    const result = redact({
      profileId: "abc123",
      password: "hunter2",
      CLERK_SECRET_KEY: "sk_live_realkey",
    }) as Record<string, unknown>;

    expect(result.profileId).toBe("abc123");
    expect(result.password).toBe("[redacted]");
    expect(result.CLERK_SECRET_KEY).toBe("[redacted]");
  });

  test("reaches into nested objects", () => {
    const result = redact({
      request: { headers: { authorization: "Bearer abc" }, path: "/overview" },
    }) as { request: { headers: Record<string, unknown>; path: string } };

    expect(result.request.headers.authorization).toBe("[redacted]");
    expect(result.request.path).toBe("/overview");
  });

  test("reaches into arrays", () => {
    const result = redact([{ token: "abc" }, { id: "keep" }]) as Record<
      string,
      unknown
    >[];

    expect(result[0].token).toBe("[redacted]");
    expect(result[1].id).toBe("keep");
  });

  test("serialises Errors without losing the stack", () => {
    const error = new Error("connect ECONNREFUSED");
    const result = redact(error) as Record<string, unknown>;

    expect(result.name).toBe("Error");
    expect(result.message).toBe("connect ECONNREFUSED");
    expect(result.stack).toBeTypeOf("string");
  });

  test("truncates beyond the depth limit instead of recursing forever", () => {
    const deep = { a: { b: { c: { d: { e: "too deep" } } } } };
    const result = redact(deep) as Record<string, never>;

    expect(JSON.stringify(result)).toContain("[truncated]");
    expect(JSON.stringify(result)).not.toContain("too deep");
  });

  test("passes primitives through untouched", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
