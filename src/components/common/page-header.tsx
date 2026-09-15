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
 * Hierarchy here comes from scale and weight — a large tight-tracked title
 * against small muted supporting text — rather than from wrapping the header
 * in yet another card.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <div className="text-label-caps text-muted-foreground">{eyebrow}</div>
        ) : null}

        <h1 className="text-title font-semibold tracking-tight">{title}</h1>

        {description ? (
          <p className="max-w-2xl text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
