import { describe, expect, test } from "vitest";

import {
  formatEnvIssues,
  parseClientEnv,
  parseServerEnv,
  serverEnvSchema,
} from "@/config/env.schema";

const VALID_SERVER_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pw@localhost:5432/life_os",
  CLERK_SECRET_KEY: "sk_test_abc123",
  LOG_LEVEL: "warn",
};

const VALID_CLIENT_ENV = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc123",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  test("accepts a complete, well-formed environment", () => {
    const env = parseServerEnv(VALID_SERVER_ENV);

    expect(env.DATABASE_URL).toBe(VALID_SERVER_ENV.DATABASE_URL);
    expect(env.CLERK_SECRET_KEY).toBe(VALID_SERVER_ENV.CLERK_SECRET_KEY);
    expect(env.LOG_LEVEL).toBe("warn");
  });

  test("applies defaults for NODE_ENV and LOG_LEVEL when omitted", () => {
    const env = parseServerEnv({
      DATABASE_URL: VALID_SERVER_ENV.DATABASE_URL,
      CLERK_SECRET_KEY: VALID_SERVER_ENV.CLERK_SECRET_KEY,
    });

    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  test("throws when DATABASE_URL is missing", () => {
    expect(() =>
      parseServerEnv({ CLERK_SECRET_KEY: "sk_test_abc123" }),
    ).toThrow(/DATABASE_URL/);
  });

  test("rejects a DATABASE_URL that is not a PostgreSQL connection string", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_SERVER_ENV,
        DATABASE_URL: "mysql://user:pw@localhost:3306/life_os",
      }),
    ).toThrow(/PostgreSQL connection string/);
  });

  test("accepts both postgres:// and postgresql:// schemes", () => {
    for (const url of [
      "postgres://user:pw@localhost:5432/db",
      "postgresql://user:pw@localhost:5432/db",
    ]) {
      expect(() =>
        parseServerEnv({ ...VALID_SERVER_ENV, DATABASE_URL: url }),
      ).not.toThrow();
    }
  });

  test("rejects a Clerk secret key that is not an sk_ key", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_SERVER_ENV,
        // A publishable key pasted into the secret slot is a real mistake,
        // and one that would otherwise fail much later and less clearly.
        CLERK_SECRET_KEY: "pk_test_abc123",
      }),
    ).toThrow(/must start with 'sk_'/);
  });

  test("treats CLERK_WEBHOOK_SIGNING_SECRET as optional", () => {
    const env = parseServerEnv(VALID_SERVER_ENV);
    expect(env.CLERK_WEBHOOK_SIGNING_SECRET).toBeUndefined();
  });

  test("rejects an unknown LOG_LEVEL", () => {
    expect(() =>
      parseServerEnv({ ...VALID_SERVER_ENV, LOG_LEVEL: "verbose" }),
    ).toThrow(/LOG_LEVEL/);
  });

  test("reports every problem at once rather than one per run", () => {
    const result = serverEnvSchema.safeParse({});
    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    const message = formatEnvIssues("server", result.error);

    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("CLERK_SECRET_KEY");
    expect(message).toContain(".env.example");
  });
});

describe("parseClientEnv", () => {
  test("accepts a complete public environment", () => {
    const env = parseClientEnv(VALID_CLIENT_ENV);

    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("pk_test_abc123");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  test("rejects a secret key placed in the publishable slot", () => {
    expect(() =>
      parseClientEnv({
        ...VALID_CLIENT_ENV,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_test_abc123",
      }),
    ).toThrow(/must start with 'pk_'/);
  });

  test("rejects a non-absolute app URL", () => {
    expect(() =>
      parseClientEnv({ ...VALID_CLIENT_ENV, NEXT_PUBLIC_APP_URL: "/app" }),
    ).toThrow(/absolute URL/);
  });

  test("rejects a missing publishable key", () => {
    expect(() =>
      parseClientEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toThrow(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
  });
});
