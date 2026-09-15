import { describe, expect, test } from "vitest";

import {
  AppError,
  forbidden,
  internal,
  isAppError,
  notFound,
  rateLimited,
  toAppError,
  toUserMessage,
  unauthorized,
  validationFailed,
} from "@/lib/errors";

describe("error constructors", () => {
  test("map each code to the correct HTTP status", () => {
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound("Profile").status).toBe(404);
    expect(validationFailed({ name: ["Required"] }).status).toBe(422);
    expect(rateLimited(30).status).toBe(429);
    expect(internal("boom").status).toBe(500);
  });

  test("carry field errors through validation failures", () => {
    const error = validationFailed({ timeZone: ["That is not a zone."] });

    expect(error.fieldErrors).toEqual({ timeZone: ["That is not a zone."] });
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  test("keep the technical detail separate from the user message", () => {
    const error = unauthorized("No Clerk session token on the request");

    expect(error.message).toBe("No Clerk session token on the request");
    expect(error.userMessage).toBe("You need to sign in to continue.");
  });
});

describe("toAppError", () => {
  test("returns an AppError unchanged", () => {
    const original = notFound("Profile");
    expect(toAppError(original)).toBe(original);
  });

  test("collapses an unknown Error into a generic internal error", () => {
    const prismaLike = new Error(
      "Unique constraint failed on the fields: (`clerk_user_id`)",
    );
    prismaLike.name = "PrismaClientKnownRequestError";

    const converted = toAppError(prismaLike);

    expect(converted.code).toBe("INTERNAL");
    expect(converted.status).toBe(500);
    // The detail survives for the logs …
    expect(converted.message).toContain("PrismaClientKnownRequestError");
    // … but must never reach the user.
    expect(converted.userMessage).not.toContain("PrismaClient");
    expect(converted.userMessage).not.toContain("clerk_user_id");
  });

  test("handles non-Error throwables", () => {
    const converted = toAppError("just a string");

    expect(isAppError(converted)).toBe(true);
    expect(converted.code).toBe("INTERNAL");
    expect(converted.message).toContain("just a string");
  });

  test("preserves the original as `cause` for log correlation", () => {
    const original = new Error("connect ECONNREFUSED 127.0.0.1:5432");
    expect(toAppError(original).cause).toBe(original);
  });
});

describe("toUserMessage", () => {
  test("uses the safe copy from an AppError", () => {
    expect(toUserMessage(forbidden())).toBe("You do not have access to this.");
  });

  test("never surfaces details from an unknown throwable", () => {
    const leak = new Error("DATABASE_URL=postgresql://user:hunter2@host/db");
    const message = toUserMessage(leak);

    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("postgresql://");
    expect(message).toBe(
      "Something went wrong on our end. Please try again in a moment.",
    );
  });

  test("falls back to the generic message for a plain value", () => {
    expect(toUserMessage(undefined)).toContain("Something went wrong");
  });
});

describe("AppError", () => {
  test("defaults to the generic user message when none is supplied", () => {
    const error = new AppError({
      code: "INTERNAL",
      message: "internal detail",
    });

    expect(error.userMessage).toContain("Something went wrong");
    expect(error.userMessage).not.toContain("internal detail");
  });

  test("is recognised by isAppError and instanceof alike", () => {
    const error = new AppError({ code: "CONFLICT", message: "duplicate" });

    expect(isAppError(error)).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(error.status).toBe(409);
  });
});
