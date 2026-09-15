"use client";

import { useSyncExternalStore } from "react";

import { detectTimeZone } from "@/lib/time";

/** The browser's zone does not change during a session. */
const subscribe = (): (() => void) => () => {};

/**
 * The browser's IANA time zone, or `serverFallback` while rendering on the
 * server and during hydration.
 *
 * `useSyncExternalStore` is the right tool here: the browser's zone really is
 * external state that the server cannot see. Reading it this way avoids both
 * a hydration mismatch (the server render uses the fallback) and the
 * `setState`-inside-an-effect pattern the React Compiler rejects.
 *
 * `getSnapshot` returns a string, so React's `Object.is` comparison is stable
 * across renders and this cannot loop.
 */
export function useDetectedTimeZone(serverFallback: string): string {
  return useSyncExternalStore(subscribe, detectTimeZone, () => serverFallback);
}
