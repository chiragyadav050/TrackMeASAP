"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: "has mounted" changes exactly once, at hydration. */
const subscribe = (): (() => void) => () => {};
const getSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

/**
 * `false` during SSR and the first client render, `true` afterwards.
 *
 * Implemented with `useSyncExternalStore` rather than the more familiar
 * `useState` + `useEffect(() => setMounted(true))`. The effect version calls
 * `setState` synchronously inside an effect, which triggers a second render
 * pass on every mount and is flagged by the React Compiler. This version
 * gives React the server and client answers directly, so there is no
 * cascading render at all.
 *
 * The narrow, legitimate use is rendering something that genuinely cannot be
 * known on the server — the resolved theme, the browser's time zone. Reach
 * for it only then; using it to skip SSR wholesale would throw away the
 * performance the server components are there to provide.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
