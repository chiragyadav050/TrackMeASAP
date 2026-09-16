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
        /*
          A ringed mark rather than a plain bordered square. The offset ring
          reads as deliberate punctuation on an otherwise blank surface, which
          is the whole job here: an empty state has to look designed, or it
          looks broken.
        */
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-surface-sunken text-muted-foreground ring-1 ring-border-subtle ring-offset-4 ring-offset-surface",
            size === "compact" ? "size-9" : "size-12",
          )}
          aria-hidden
        >
          <Icon className={size === "compact" ? "size-4" : "size-5"} />
        </div>
      ) : null}

      <div className={cn("space-y-1.5", size === "page" && "pt-1")}>
        <p
          className={cn(
            "text-foreground",
            size === "page"
              ? // The display face earns its place here: on a full-page empty
                // state the title is the only thing to look at, so it should
                // carry the product's voice rather than sit at body weight.
                "font-display text-heading"
              : "font-medium",
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
