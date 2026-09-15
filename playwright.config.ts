// Loads .env so the config and the Clerk detection helper see the same
// values the application will.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { isRealClerkInstance } from "./tests/e2e/clerk-env";

/**
 * End-to-end configuration.
 *
 * The suite runs against a real `next build && next start`, not the dev
 * server, so what is tested is what would ship.
 *
 * AUTHENTICATION. Signed-in journeys use `@clerk/testing`, Clerk's own
 * supported testing path: a `setup` project signs in ONCE against the real
 * development instance and saves the session, which every other project then
 * reuses. Clerk is never stubbed — a test asserting that a stub behaves like
 * a stub proves nothing.
 *
 * With no real Clerk instance configured the setup project is skipped and the
 * authenticated specs skip themselves (see `clerk-env.ts`), leaving the
 * anonymous journey — landing page, auth surfaces, 404, and the fact that
 * every protected route refuses anonymous access — which needs no keys.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global.setup.ts",
  fullyParallel: true,
  // A `.only` left in a test file must fail CI rather than silently shrink it.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Signs in once; everything below reuses the session it saves.
    ...(isRealClerkInstance()
      ? [{ name: "setup", testMatch: /auth\.setup\.ts/ }]
      : []),

    ...["chromium", "firefox", "webkit", "mobile-chrome"].map((name) => ({
      name,
      use: {
        ...devices[
          name === "chromium"
            ? "Desktop Chrome"
            : name === "firefox"
              ? "Desktop Firefox"
              : name === "webkit"
                ? "Desktop Safari"
                : "Pixel 7"
        ],
        // Present only when a real instance signed in; otherwise the specs
        // that need it skip themselves.
        ...(isRealClerkInstance()
          ? { storageState: "tests/e2e/.auth/user.json" }
          : {}),
      },
      ...(isRealClerkInstance() ? { dependencies: ["setup"] } : {}),
    })),
  ],

  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    // Reuse whatever is already running locally; always start fresh in CI.
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
