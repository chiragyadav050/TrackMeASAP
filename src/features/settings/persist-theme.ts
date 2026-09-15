"use client";

import { persistThemePreferenceAction } from "@/features/settings/actions";
import type { ThemePreference } from "@/types/profile";

/**
 * Client-side adapter for the theme-persistence action.
 *
 * `ThemeToggle` is shared with public pages, where there is no session to
 * persist to, so it takes persistence as an optional callback rather than
 * importing a server action directly. This is that callback for the
 * authenticated shell.
 *
 * Errors are swallowed on purpose: the theme has already changed locally and
 * the action logs its own failures server-side.
 */
export function persistThemePreference(preference: ThemePreference): void {
  void persistThemePreferenceAction({ themePreference: preference });
}
