"use client";

import { Bell, BellOff, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  dismissNotificationCommand,
  markAllNotificationsReadCommand,
  markNotificationReadCommand,
} from "@/features/schedule/actions";
import { NOTIFICATION_KIND_LABELS } from "@/features/schedule/components/schedule-badges";
import { cn } from "@/lib/utils";
import type { NotificationDto } from "@/types/schedule";

/**
 * The notification bell.
 *
 * The badge shows UNREAD count only. A count that includes everything ever
 * received would never fall to zero, and a badge that never clears is one the
 * user stops looking at.
 */
export function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: readonly NotificationDto[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    fallback: string,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? fallback);
        return;
      }

      router.refresh();
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            className="relative"
          >
            <Bell className="size-4" />

            {unreadCount > 0 ? (
              <span
                className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-danger text-[10px] font-medium text-white tabular-nums"
                aria-hidden
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </Button>
        }
      />

      <PopoverContent align="end" className="w-80 p-0">
        <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
          <h2 className="text-meta font-medium">Notifications</h2>

          {unreadCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    markAllNotificationsReadCommand({ notificationIds: [] }),
                  "Couldn't mark them read.",
                )
              }
            >
              <Check className="size-3.5" />
              Mark all read
            </Button>
          ) : null}
        </header>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <BellOff className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-meta text-muted-foreground">Nothing yet.</p>
            <p className="text-label text-muted-foreground">
              Reminders and alerts will appear here when they fire.
            </p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y divide-border-subtle overflow-y-auto">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  "group px-3 py-2.5",
                  !notification.isRead && "bg-surface-sunken",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-muted-foreground">
                      {NOTIFICATION_KIND_LABELS[notification.kind] ??
                        notification.kind}{" "}
                      · {notification.timeLabel}
                    </p>

                    {notification.href ? (
                      <Link
                        href={notification.href as never}
                        className="block truncate text-meta underline-offset-4 hover:underline"
                        onClick={() =>
                          notification.isRead
                            ? undefined
                            : run(
                                () =>
                                  markNotificationReadCommand({
                                    notificationId: notification.id,
                                  }),
                                "Couldn't mark it read.",
                              )
                        }
                      >
                        {notification.title}
                      </Link>
                    ) : (
                      <p className="truncate text-meta">{notification.title}</p>
                    )}

                    {notification.body ? (
                      <p className="mt-0.5 text-label text-muted-foreground">
                        {notification.body}
                      </p>
                    ) : null}
                  </div>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Dismiss "${notification.title}"`}
                    disabled={isPending}
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      run(
                        () =>
                          dismissNotificationCommand({
                            notificationId: notification.id,
                          }),
                        "Couldn't dismiss it.",
                      )
                    }
                  >
                    <Check className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
