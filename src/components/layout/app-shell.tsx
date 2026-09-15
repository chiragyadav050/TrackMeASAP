import type { ReactNode } from "react";

import { CommandPaletteProvider } from "@/components/command/command-palette-provider";
import { AppHeader } from "@/components/layout/app-header";
import { AppMark } from "@/components/layout/app-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { CURRENT_PHASE } from "@/config/phases";
import { TaskDialogProvider } from "@/features/tasks/task-dialog-provider";
import { routes } from "@/config/site";
import type { ProfileDto } from "@/types/profile";
import type { NotificationDto } from "@/types/schedule";

type AppShellProps = {
  readonly profile: ProfileDto;
  /** Recent notifications for the header bell. */
  readonly notifications: readonly NotificationDto[];
  readonly unreadCount: number;
  readonly children: ReactNode;
};

/**
 * The authenticated application frame.
 *
 * A Server Component: the shell itself ships no JavaScript, and only the
 * genuinely interactive pieces inside it (navigation highlighting, the
 * palette, the menus) are client components.
 *
 * The sidebar is fixed on `lg` and above and replaced by a sheet below it —
 * desktop is the primary experience, but nothing here becomes unusable on a
 * 390px screen.
 */
export function AppShell({
  profile,
  notifications,
  unreadCount,
  children,
}: AppShellProps) {
  return (
    <TaskDialogProvider>
      <CommandPaletteProvider>
        <div className="flex min-h-dvh">
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-(--spacing-sidebar) shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
            <div className="flex h-(--spacing-header) shrink-0 items-center px-4">
              <AppMark href={routes.overview} />
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <SidebarNav />
            </div>

            <div className="border-t border-border-subtle px-4 py-3 text-label text-muted-foreground">
              Phase {CURRENT_PHASE}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col lg:pl-(--spacing-sidebar)">
            <AppHeader
              profile={profile}
              notifications={notifications}
              unreadCount={unreadCount}
            />

            <main
              id="main-content"
              className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
            >
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>
        </div>
      </CommandPaletteProvider>
    </TaskDialogProvider>
  );
}
