"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_GROUPS, isNavItemActive } from "@/config/navigation";
import { CURRENT_PHASE } from "@/config/phases";
import { cn } from "@/lib/utils";

type SidebarNavProps = {
  /** Called after a navigation, so the mobile sheet can close itself. */
  readonly onNavigate?: () => void;
};

/**
 * The navigation list, shared by the desktop sidebar and the mobile sheet.
 *
 * Items whose feature lands in a later phase are marked with a small phase
 * number rather than being hidden or disabled: the surface is genuinely
 * reachable today, it just has nothing in it yet.
 */
export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-5 py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="space-y-1">
          <h2 className="text-label-caps px-3 py-1 text-muted-foreground/80">
            {group.label}
          </h2>

          <ul className="space-y-px">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = isNavItemActive(pathname, item);
              const isUpcoming = item.phase > CURRENT_PHASE;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    // Anchors the first-run tour. Derived from the route so a
                    // renamed label never silently detaches a tour step.
                    data-tour={item.href.replace("/", "")}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-meta transition-colors",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      isActive
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {/* The active marker is a shape, not just a colour, so the
                        current page is identifiable without relying on hue. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary transition-opacity",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />

                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        isActive
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden
                    />

                    <span className="truncate">{item.label}</span>

                    {isUpcoming ? (
                      <span
                        className="ml-auto shrink-0 text-label text-muted-foreground/70 tabular-nums"
                        title={`Arrives in Phase ${item.phase}`}
                      >
                        P{item.phase}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
