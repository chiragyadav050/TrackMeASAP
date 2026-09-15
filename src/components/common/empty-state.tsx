import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  /** `compact` fits inside a dashboard tile; `page` fills a whole surface. */
  readonly size?: "compact" | "page";
  readonly className?: string;
};

/**
 * The honest answer to "there is nothing here yet".
 *
 * Life OS never fills a blank screen with sample rows or invented numbers, so
 * empty states carry real weight: they have to explain what the surface is
 * for and what will make it fill up.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "compact",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "compact" ? "gap-2 px-4 py-8" : "gap-3 px-6 py-16",
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-border-subtle bg-surface-sunken text-muted-foreground",
            size === "compact" ? "size-9" : "size-11",
          )}
          aria-hidden
        >
          <Icon className={size === "compact" ? "size-4" : "size-5"} />
        </div>
      ) : null}

      <div className="space-y-1">
        <p
          className={cn(
            "font-medium text-foreground",
            size === "page" && "text-heading",
          )}
        >
          {title}
        </p>
        <p className="mx-auto max-w-sm text-meta text-pretty text-muted-foreground">
          {description}
        </p>
      </div>

      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
