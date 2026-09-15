import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { routes } from "@/config/site";
import { requireProfileForPage } from "@/server/auth";
import { toProfileDto } from "@/services/profile/profile.service";
import { listNotifications } from "@/services/schedule/calendar.query";
import { countUnread } from "@/services/schedule/notification.service";

/**
 * The gate for every authenticated surface.
 *
 * This layout — not a path pattern in the proxy — is what actually protects
 * the pages beneath it. Next.js renders a layout around its children, so the
 * redirect below runs before any child page's code does.
 *
 * Three things happen here, in order:
 *   1. `requireProfileForPage()` derives identity from the Clerk session and
 *      sends anonymous visitors to sign-in.
 *   2. The Profile is provisioned on first sight (just-in-time user sync).
 *   3. Users who have not finished onboarding are sent there, so no surface
 *      has to cope with a half-configured profile.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfileForPage();

  if (profile.onboardingCompletedAt === null) {
    redirect(routes.onboarding);
  }

  // The bell lives in the shell, so its data is fetched once per navigation
  // here rather than by every page that happens to render a header.
  const [notifications, unreadCount] = await Promise.all([
    listNotifications(profile, 15),
    countUnread(profile.id),
  ]);

  return (
    <AppShell
      profile={toProfileDto(profile)}
      notifications={notifications}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
