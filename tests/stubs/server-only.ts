/**
 * Test stub for the `server-only` package.
 *
 * The real module throws the moment it is imported from anything that could
 * reach the client bundle. Vitest is neither, so importing it would fail
 * every test of a server module for no safety benefit. Aliased in
 * `vitest.config.ts`.
 */
export {};
