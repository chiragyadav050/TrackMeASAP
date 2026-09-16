import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppMark } from "@/components/layout/app-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS } from "@/config/navigation";
import { CURRENT_PHASE, getPhase } from "@/config/phases";
import { routes, siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.tagline}`,
  description: siteConfig.description,
};

/**
 * Public landing page.
 *
 * States exactly what is built and what is not. No invented metrics, no
 * testimonials, no screenshots of features that do not exist yet.
 */
export default function LandingPage() {
  const phase = getPhase(CURRENT_PHASE);

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Texture keeps the large empty areas from reading as unfinished, and
          fades out before it can compete with the type. */}
      <div
        aria-hidden
        className="texture-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]"
      />

      <header className="relative flex h-(--spacing-header) items-center justify-between px-5 sm:px-8">
        <AppMark />

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={routes.signIn}>Sign in</Link>}
          />
        </div>
      </header>

      <main className="relative flex flex-1 flex-col justify-center px-5 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Badge variant="secondary" className="mb-6">
            Phase {phase.id} · {phase.name}
          </Badge>

          <h1 className="text-display font-semibold text-balance">
            Your entire life,
            <br />
            <span className="text-muted-foreground">one command center.</span>
          </h1>

          <p className="mt-6 max-w-xl text-pretty text-muted-foreground">
            {siteConfig.description}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              render={<Link href={routes.signUp}>Get started</Link>}
            />
            <Button
              size="lg"
              variant="outline"
              render={
                <Link href={routes.signIn}>
                  Sign in
                  <ArrowRight data-icon="inline-end" className="size-4" />
                </Link>
              }
            />
          </div>

          <section
            aria-labelledby="surfaces-heading"
            className="mt-16 border-t border-border pt-8"
          >
            <h2
              id="surfaces-heading"
              className="text-label-caps text-muted-foreground"
            >
              What Life OS holds
            </h2>

            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
              {NAV_GROUPS.map((group) => (
                <div key={group.id} className="space-y-1.5">
                  <dt className="text-meta font-medium">{group.label}</dt>
                  <dd className="text-meta text-muted-foreground">
                    {group.items.map((item) => item.label).join(" · ")}
                  </dd>
                </div>
              ))}
            </dl>

            {/*
              This read "Phase {phase.id} ships the foundation: accounts, the
              application shell, theming and the command palette" — Phase 1's
              sentence wearing whatever number the config currently held. At
              Phase 10 it told every visitor to the PUBLIC landing page that
              the product was an empty shell. The second sentence, "everything
              else is on the roadmap and honestly marked as not built yet", had
              been false for nine phases.
            */}
            <p className="mt-8 text-meta text-muted-foreground">
              Every figure in Life OS comes from something you recorded. Where
              there is no data it says so, rather than showing a zero.
            </p>
          </section>
        </div>
      </main>

      <footer className="relative px-5 py-6 text-label text-muted-foreground sm:px-8">
        {siteConfig.name} · Personal project
      </footer>
    </div>
  );
}
