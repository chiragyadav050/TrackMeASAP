/**
 * A no-op stand-in for the `server-only` package.
 *
 * `server-only` exists to make the Next.js BUNDLER fail if a server module is
 * pulled into a client bundle. Its published entry point throws when imported
 * outside that bundler — including in the worker process, which is about as
 * server-side as code gets.
 *
 * Aliasing it here (see tsconfig.worker.json) keeps the real guard in place
 * for the application build while letting the worker import the same services
 * the web app uses, rather than maintaining a parallel copy that could drift.
 */
export {};
