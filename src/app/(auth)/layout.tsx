import Link from "next/link";
import type { ReactNode } from "react";

import { AppMark } from "@/components/layout/app-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { routes, siteConfig } from "@/config/site";

/**
 * Frame for the sign-in and sign-up surfaces.
 *
 * A single centred column rather than the marketing/product split most auth
 * pages use — there is no marketing to do here, only a form to get out of the
 * way of.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="texture-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />

      <header className="relative flex h-(--spacing-header) items-center justify-between px-5 sm:px-8">
        <AppMark href={routes.home} />
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="relative px-5 py-6 text-center text-label text-muted-foreground">
        <Link
          href={routes.home}
          className="transition-colors hover:text-foreground"
        >
          Back to {siteConfig.name}
        </Link>
      </footer>
    </div>
  );
}
