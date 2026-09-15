import type { Route } from "next";
import Link from "next/link";

import { APP_ICON } from "@/config/navigation";
import { routes, siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type AppMarkProps = {
  readonly href?: Route;
  readonly className?: string;
  /** Hides the wordmark, leaving only the glyph. */
  readonly iconOnly?: boolean;
};

/** The product mark. A single glyph in a tinted well — no logo file needed. */
export function AppMark({ href, className, iconOnly = false }: AppMarkProps) {
  const Icon = APP_ICON;

  const content = (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-primary text-primary-foreground"
        aria-hidden
      >
        <Icon className="size-3.5" />
      </span>

      {iconOnly ? null : (
        <span className="text-meta font-semibold tracking-tight">
          {siteConfig.name}
        </span>
      )}
    </span>
  );

  if (!href) {
    return content;
  }

  return (
    <Link
      href={href}
      className="rounded-md focus-visible:outline-none"
      aria-label={`${siteConfig.name} — go to ${href === routes.home ? "home" : "overview"}`}
    >
      {content}
    </Link>
  );
}
