import { Compass } from "lucide-react";
import Link from "next/link";

import { AppMark } from "@/components/layout/app-mark";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/config/navigation";
import { routes } from "@/config/site";

export const metadata = {
  title: "Page not found",
};

/**
 * 404.
 *
 * Useful rather than decorative: it lists every real surface so a mistyped or
 * stale URL still ends somewhere productive. Links work whether or not the
 * visitor is signed in — the middleware handles that.
 */
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="flex h-(--spacing-header) items-center px-5 sm:px-8">
        <AppMark href={routes.home} />
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-lg">
          <div
            className="mb-5 flex size-11 items-center justify-center rounded-xl border border-border bg-surface-sunken text-muted-foreground"
            aria-hidden
          >
            <Compass className="size-5" />
          </div>

          <p className="text-label-caps text-muted-foreground">Error 404</p>

          <h1 className="mt-1.5 text-title font-semibold tracking-tight">
            That page does not exist.
          </h1>

          <p className="mt-2 text-pretty text-muted-foreground">
            The link may be out of date, or the surface may not have been built
            yet. Here is everything that does exist:
          </p>

          <nav aria-label="All surfaces" className="mt-6 space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.id}>
                <h2 className="text-label-caps text-muted-foreground">
                  {group.label}
                </h2>

                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-meta underline-offset-4 transition-colors hover:text-brand-text hover:underline"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <Button
            className="mt-8"
            render={<Link href={routes.overview}>Back to Overview</Link>}
          />
        </div>
      </main>
    </div>
  );
}
