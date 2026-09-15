import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Unit test configuration.
 *
 * Scope is deliberately the pure layers — environment validation, error
 * normalisation, time maths, rate limiting, navigation resolution, the auth
 * helpers' pure parts. Anything that needs a live Clerk session or a database
 * is covered by the Playwright suite instead, where it can be exercised for
 * real rather than against a mock that proves nothing.
 *
 * `.mts` so Vite's native config loader reads it as ESM.
 */
export default defineConfig({
  // Needed only for the handful of `.test.tsx` files that mount the pure
  // presentational components to assert their accessibility guarantees.
  plugins: [react()],
  resolve: {
    // Native replacement for vite-tsconfig-paths: resolves the `@/*` alias
    // straight from tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // `server-only` throws the moment it is imported outside a React Server
      // Component. That guard is exactly right in the app and useless in a
      // unit test, so it is stubbed here. The boundary is still enforced
      // where it matters — the Next.js build.
      //
      // fileURLToPath, not URL.pathname: the project path may contain spaces,
      // which pathname would leave percent-encoded.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Node by default — almost everything here is pure logic. The one file
    // that needs a DOM opts in with a `@vitest-environment jsdom` docblock,
    // rather than paying to spin up jsdom for all of them.
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/config/**",
        "src/lib/**",
        "src/server/**",
        "src/services/**",
      ],
      exclude: [
        // Thin composition layers with no logic of their own, or modules that
        // cannot load outside a Next.js request context.
        "src/server/db.ts",
        "src/lib/clerk-appearance.ts",
        "src/generated/**",
      ],
    },
  },
});
