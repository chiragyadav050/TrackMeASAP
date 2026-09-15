"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Theme root.
 *
 * `next-themes` injects a tiny blocking script into <head> that applies the
 * stored class before first paint, which is what eliminates the flash of the
 * wrong theme. That only works if <html> also carries
 * `suppressHydrationWarning` — see `src/app/layout.tsx`.
 *
 * The server passes the profile's stored preference as `defaultTheme` so a
 * new device picks up the user's choice on first load; after that
 * localStorage is authoritative for instant, offline-safe switching, and the
 * toggle writes back to the database so the two stay in step.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      enableSystem
      disableTransitionOnChange
      storageKey="life-os-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
