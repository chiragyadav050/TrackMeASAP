import { describe, expect, test } from "vitest";

import { deriveDisplayName } from "@/server/auth";

/**
 * `deriveDisplayName` is the pure part of the auth layer, and the part most
 * likely to break: Clerk applications can be configured with any subset of
 * name, username and email, so every fallback rung has to hold.
 *
 * The session-dependent helpers (`requireProfile`, `ensureProfile`) are
 * exercised end-to-end by the Playwright suite rather than against a mocked
 * Clerk, which would only assert that the mock behaves like the mock.
 */

const EMPTY = {
  firstName: null,
  lastName: null,
  username: null,
  primaryEmailAddress: null,
};

describe("deriveDisplayName", () => {
  test("prefers the full name", () => {
    expect(
      deriveDisplayName({
        ...EMPTY,
        firstName: "Chirag",
        lastName: "Yadav",
        username: "chirag",
        primaryEmailAddress: { emailAddress: "chirag@example.com" },
      }),
    ).toBe("Chirag Yadav");
  });

  test("uses whichever name part exists", () => {
    expect(deriveDisplayName({ ...EMPTY, firstName: "Chirag" })).toBe("Chirag");
    expect(deriveDisplayName({ ...EMPTY, lastName: "Yadav" })).toBe("Yadav");
  });

  test("falls back to the username when no name is set", () => {
    expect(
      deriveDisplayName({
        ...EMPTY,
        username: "chirag",
        primaryEmailAddress: { emailAddress: "chirag@example.com" },
      }),
    ).toBe("chirag");
  });

  test("falls back to the email local part when only an email exists", () => {
    expect(
      deriveDisplayName({
        ...EMPTY,
        primaryEmailAddress: { emailAddress: "chirag.yadav@example.com" },
      }),
    ).toBe("chirag.yadav");
  });

  test("never returns an empty string for a phone-only or OAuth-only user", () => {
    expect(deriveDisplayName(EMPTY)).toBe("There");
  });

  test("ignores whitespace-only values instead of treating them as names", () => {
    expect(
      deriveDisplayName({
        ...EMPTY,
        firstName: "   ",
        lastName: "  ",
        username: "  ",
        primaryEmailAddress: { emailAddress: "fallback@example.com" },
      }),
    ).toBe("fallback");
  });

  test("trims a padded username", () => {
    expect(deriveDisplayName({ ...EMPTY, username: "  chirag  " })).toBe(
      "chirag",
    );
  });
});
