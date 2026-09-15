import "dotenv/config";

/**
 * Integration test bootstrap.
 *
 * Points the application's Prisma client at the dedicated TEST database
 * before anything imports it. `src/server/db.ts` builds its client lazily on
 * first property access, so reassigning `DATABASE_URL` here — in a setup file
 * that runs before any test module — is sufficient and requires no special
 * test-only wiring inside the app.
 *
 * REFUSING TO RUN AGAINST THE DEV DATABASE IS DELIBERATE. These tests
 * truncate tables. A misconfigured `TEST_DATABASE_URL` that happened to point
 * at `life_os` would silently destroy real data, so the guard below fails
 * loudly instead.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error(
    [
      "TEST_DATABASE_URL is not set.",
      "",
      "Integration tests need their own database — they truncate tables.",
      "Add this to .env (see .env.example):",
      "",
      '  TEST_DATABASE_URL="postgresql://life_os:…@localhost:5432/life_os_test?schema=public"',
      "",
      "Then create and migrate it:",
      "  createdb -O life_os life_os_test",
      "  pnpm db:test:setup",
    ].join("\n"),
  );
}

if (process.env.DATABASE_URL && testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must not equal DATABASE_URL — these tests delete data.",
  );
}

if (!/test/i.test(testDatabaseUrl)) {
  throw new Error(
    `Refusing to run: TEST_DATABASE_URL ("${testDatabaseUrl.replace(
      /:\/\/[^@]*@/,
      "://***@",
    )}") does not contain "test". Guard against pointing at a real database.`,
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
// Keep the suite output readable; the logger is exercised by its own tests.
process.env.LOG_LEVEL = "error";
