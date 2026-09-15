import { clerkMiddleware } from "@clerk/nextjs/server";

import { routes } from "@/config/site";

/**
 * Clerk request context.
 *
 * Named `proxy.ts`: Next.js 16 renamed the `middleware` file convention to
 * `proxy`. Same request-interception semantics, current name.
 *
 * This file deliberately does NOT decide what is protected. Clerk 7
 * deprecated `createRouteMatcher` for exactly the reason that matters here:
 * path-pattern matching can diverge from how Next.js actually resolves a
 * request, leaving a protected resource reachable because a regex did not
 * match the URL that reached it.
 *
 * Instead, every protected resource guards itself against the session:
 *
 *   • pages and layouts  → `requireProfileForPage()` (redirects to sign-in)
 *   • server actions     → `createAuthenticatedAction` → `requireProfile()`
 *   • route handlers     → `requireProfile()` / `requireAuthUserId()`
 *
 * The guard therefore sits on the data, not on the URL. All this middleware
 * does is make the session available to those checks.
 */
export default clerkMiddleware(
  // No-op handler: this middleware attaches the session and makes no
  // authorization decision of its own. See the note above.
  async () => {},
  {
    // Keep Clerk's own redirects inside the application instead of bouncing
    // users to its hosted Account Portal on a *.accounts.dev domain.
    signInUrl: routes.signIn,
    signUpUrl: routes.signUp,
  },
);

export const config = {
  matcher: [
    // Everything except Next.js internals and static assets, unless a search
    // param is present (which can carry an auth handshake).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
