import { expect, test } from "@playwright/test";

/**
 * API-level smoke tests.
 *
 * These run unconditionally: they exercise the real built server and the real
 * PostgreSQL database, and they do not depend on a Clerk browser session.
 */

// Every test here asserts UNAUTHENTICATED behaviour, so the shared signed-in
// session must be discarded — otherwise the "anonymous request" tests would
// be making authenticated ones and proving the opposite of their name.
test.use({ storageState: { cookies: [], origins: [] } });

test("the health endpoint reports the database is reachable", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);

  // Also proves the standard API envelope is what ships.
  const body = await response.json();

  expect(body.success).toBe(true);
  expect(body.error).toBeNull();
  expect(body.data.status).toBe("ok");
  expect(body.data.database).toBe("reachable");

  // Phase 6: worker availability is reported as booleans only — never a URL,
  // queue depth or version, which would make the probe a recon tool.
  expect(typeof body.data.worker.configured).toBe("boolean");
  expect(typeof body.data.worker.reachable).toBe("boolean");
  expect(JSON.stringify(body)).not.toMatch(/redis:\/\/|6379/);
});

test("the health endpoint is never cached", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("the Clerk webhook rejects an unsigned payload", async ({ request }) => {
  // A forged `user.deleted` must not delete anything. Without a valid Svix
  // signature the handler has to refuse before reading the body.
  const response = await request.post("/api/webhooks/clerk", {
    data: { type: "user.deleted", data: { id: "user_attacker" } },
    failOnStatusCode: false,
  });

  expect(response.ok()).toBe(false);

  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.data).toBeNull();

  // The response must not disclose which check failed or any internals.
  expect(JSON.stringify(body)).not.toMatch(/svix|signing|secret|stack/i);
});

test("responses carry the baseline security headers", async ({ request }) => {
  const response = await request.get("/");
  const headers = response.headers();

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["strict-transport-security"]).toContain("max-age=");

  // The framework version must not be advertised.
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("no server secret reaches the client bundle", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  // A regression here would mean a `server-only` module leaked into a client
  // component — exactly the failure the build is configured to prevent.
  expect(html).not.toContain("CLERK_SECRET_KEY");
  expect(html).not.toContain("sk_test_");
  expect(html).not.toContain("sk_live_");
  expect(html).not.toContain("postgresql://");
  expect(html).not.toContain("DATABASE_URL");
});

/**
 * Phase 4 route guards.
 *
 * Runs without a Clerk browser session: an unauthenticated request must never
 * receive project data, whatever the route. A 200 carrying a project name
 * here would mean the page rendered before the auth guard ran.
 */
for (const path of [
  "/work",
  "/projects",
  "/projects/some-made-up-id",
  "/habits",
  "/goals",
  "/goals/some-made-up-id",
  "/health",
  "/finance",
  "/plan",
  "/insights",
]) {
  test(`an anonymous request to ${path} never returns user data`, async ({
    request,
  }) => {
    const response = await request.get(path, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });

    // Either a redirect to sign-in or an error — never a rendered page.
    expect(response.status()).not.toBe(200);

    const body = await response.text();
    expect(body).not.toMatch(
      /workspaceName|openBlockerCount|progressPercent|currentStreak|amountMinor/,
    );
  });
}

/**
 * Phase 7 — Telegram webhook security.
 *
 * The webhook is unauthenticated by necessity (Telegram calls it), so these
 * run unconditionally and are the only thing standing between the endpoint
 * and the open internet.
 */
test("the Telegram webhook refuses a request with no secret header", async ({
  request,
}) => {
  const response = await request.post("/api/telegram/webhook", {
    data: {
      message: { message_id: 1, text: "/today", chat: { id: 123 } },
    },
    failOnStatusCode: false,
  });

  // FAIL CLOSED. No secret configured, or a missing header, must mean refusal
  // — never "accept everything".
  expect(response.status()).toBe(401);

  // And nothing about why.
  expect((await response.text()).length).toBe(0);
});

test("the Telegram webhook refuses a wrong secret header", async ({
  request,
}) => {
  const response = await request.post("/api/telegram/webhook", {
    headers: { "x-telegram-bot-api-secret-token": "not-the-secret" },
    data: {
      message: { message_id: 1, text: "/today", chat: { id: 123 } },
    },
    failOnStatusCode: false,
  });

  expect(response.status()).toBe(401);
});

test("the Telegram webhook does not answer GET", async ({ request }) => {
  // Answering GET would make the endpoint trivially discoverable by a crawler.
  const response = await request.get("/api/telegram/webhook", {
    failOnStatusCode: false,
  });

  expect(response.status()).toBe(405);
});

test("no Telegram secret reaches the client bundle", async ({ request }) => {
  const html = await (await request.get("/")).text();

  expect(html).not.toContain("TELEGRAM_BOT_TOKEN");
  expect(html).not.toContain("TELEGRAM_WEBHOOK_SECRET");
  // A bot token always looks like <digits>:<base64ish>.
  expect(html).not.toMatch(/\b\d{8,}:[A-Za-z0-9_-]{30,}\b/);
});
