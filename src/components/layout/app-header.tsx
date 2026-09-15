"use client";

import { CommandTrigger } from "@/components/command/command-trigger";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { persistThemePreference } from "@/features/settings/persist-theme";
import type { ProfileDto } from "@/types/profile";
import type { NotificationDto } from "@/types/schedule";
import { NotificationBell } from "@/features/schedule/components/notification-bell";

type AppHeaderProps = {
  readonly profile: ProfileDto;
  readonly notifications: readonly NotificationDto[];
  readonly unreadCount: number;
};

/**
 * Sticky application header: location on the left, tools on the right.
 *
 * Stays a thin 56px bar at every breakpoint — on a dense productivity surface
 * vertical space belongs to the user's data, not to chrome.
 */
export function AppHeader({
  profile,
  notifications,
  unreadCount,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-(--spacing-header) shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <MobileNav />

      <Separator orientation="vertical" className="h-4 lg:hidden" />

      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <CommandTrigger />
        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
        />
        <ThemeToggle onPersist={persistThemePreference} />
        <UserMenu profile={profile} />
      </div>
    </header>
  );
}
