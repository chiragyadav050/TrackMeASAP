import type { Route } from "next";

/**
 * Static product metadata. Kept in one place so titles, descriptions and
 * marketing copy never drift between the shell, the landing page and
 * document metadata.
 */
export const siteConfig = {
  name: "Life OS",
  shortName: "Life OS",
  tagline: "Your entire life, one command center.",
  description:
    "Life OS unifies college, work, projects, habits, health and finance into a single calm, fast command center — with an AI assistant that actually knows your life.",
} as const;

/**
 * The bare path of an optional catch-all segment.
 *
 * Clerk owns its own sub-routes (SSO callback, second factor, password
 * reset), so sign-in and sign-up are `[[...sign-in]]` / `[[...sign-up]]`
 * segments. Those match `/sign-in` and `/sign-up` perfectly well at runtime,
 * but `typedRoutes` only enumerates the parameterised form
 * (`"/sign-in/[[...sign-in]]"`), so the zero-segment case has to be asserted.
 *
 * This is the only route assertion in the application; every other entry in
 * `routes` is checked against the real route tree by `satisfies` below.
 */
const bareCatchAllPath = (path: `/${string}`): Route => path as Route;

/**
 * Routes that Clerk and the middleware treat specially. Centralised so the
 * middleware matcher, the redirect targets and the navigation guards can
 * never disagree with each other.
 *
 * `satisfies Record<string, Route>` makes `typedRoutes` check every value
 * against the real route tree, so a typo or a deleted page is a build error
 * rather than a dead link found in production.
 */
export const routes = {
  home: "/",
  signIn: bareCatchAllPath("/sign-in"),
  signUp: bareCatchAllPath("/sign-up"),
  onboarding: "/onboarding",
  overview: "/overview",
  settings: "/settings",
} as const satisfies Record<string, Route>;
