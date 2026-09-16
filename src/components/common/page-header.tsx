import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  readonly title: string;
  readonly description?: string;
  /** Right-aligned actions. Kept optional so placeholder pages stay honest. */
  readonly actions?: ReactNode;
  /** Small label above the title, e.g. a section or phase marker. */
  readonly eyebrow?: ReactNode;
  readonly className?: string;
};

/**
 * The standard opening of every application page.
 *
 * Hierarchy comes from SCALE CONTRAST, not from boxing the header in a card.
 * The title sits two full steps above the supporting text in the display
 * serif, which does three things at once: it gives the product a voice, it
 * separates "where am I" from "what is here" at a glance, and it means the
 * dense working UI below can stay quiet without the page reading as flat.
 *
 * The eyebrow is a hairline rule plus a caps label rather than another line of
 * text. A rule is cheaper to scan than a word and gives the block a top edge,
 * which is what stops a large title from floating.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 pb-2 sm:flex-row sm:items-end sm:justify-between sm:gap-8",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow ? (
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="h-px w-6 shrink-0 bg-border-strong" />
            <span className="text-label-caps tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </span>
          </div>
        ) : null}

        <h1 className="font-display text-title text-balance text-foreground">
          {title}
        </h1>

        {description ? (
          <p className="max-w-xl text-meta leading-relaxed text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2 sm:pb-1">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
