import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SectionCardProps = {
  readonly title: string;
  readonly icon?: LucideIcon;
  /** Short right-aligned marker, e.g. "Phase 2". */
  readonly badge?: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
};

/**
 * A titled surface for one dashboard concern.
 *
 * Built from a hairline border and a raised surface token rather than a drop
 * shadow, so a grid of these reads as one panel of instruments instead of a
 * pile of floating boxes.
 */
export function SectionCard({
  title,
  icon: Icon,
  badge,
  description,
  children,
  footer,
  className,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-surface",
        // A whisper of elevation on top of the hairline border. The border
        // still does the structural work; the shadow only separates the panel
        // from the page so a grid of these reads as instruments sitting ON
        // something rather than holes cut into it.
        "elevation-1",
        className,
      )}
    >
      {/*
        The header sits on the sunken tone rather than the card surface. One
        token's worth of difference is enough to read as a distinct band,
        which is what lets the title stay small without getting lost — far
        quieter than the usual heavier border or bolder weight.
      */}
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-sunken/40 px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="flex items-center gap-2 text-meta font-medium tracking-tight">
            {Icon ? (
              <Icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            ) : null}
            <span className="truncate">{title}</span>
          </h2>

          {description ? (
            <p className="text-label text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {badge ? (
          <Badge variant="secondary" className="shrink-0">
            {badge}
          </Badge>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

      {footer ? (
        <footer className="border-t border-border-subtle px-4 py-2.5 text-label text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
