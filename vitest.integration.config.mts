import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Integration test configuration.
 *
 * These tests run the real service layer against a REAL PostgreSQL database —
 * no mocked Prisma, no stubbed queries. That is the point: the rules worth
 * testing here (ownership scoping, cascade deletes, enum defaults, the
 * generated WHERE clauses) live in the boundary between our code and the
 * database, which a mock cannot exercise.
 *
 * They are a separate project from the unit tests so `pnpm test` stays fast
 * and requires no database.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    // Every file shares one database. Running them in parallel would let one
    // file's cleanup delete another's fixtures mid-assertion.
    fileParallelism: false,
    // Schema work and cold connections make the first test slower than a
    // pure-function one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
