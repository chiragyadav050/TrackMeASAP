import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppMark } from "@/components/layout/app-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { routes, siteConfig } from "@/config/site";
import { OnboardingForm } from "@/features/onboarding/onboarding-form";
import { requireProfileForPage } from "@/server/auth";
import { toProfileDto } from "@/services/profile/profile.service";

export const metadata: Metadata = {
  title: "Set up your Life OS",
};

/**
 * Sits outside the `(app)` group: onboarding deliberately has no sidebar and
 * no command palette, because neither is useful before the profile exists.
 */
export default async function OnboardingPage() {
  const profile = await requireProfileForPage();

  // Re-running setup is not harmful, but landing here by accident is
  // confusing — send finished users back to where the product actually is.
  if (profile.onboardingCompletedAt !== null) {
    redirect(routes.overview);
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="texture-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]"
      />

      <header className="relative flex h-(--spacing-header) items-center justify-between px-5 sm:px-8">
        <AppMark />
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-2xl space-y-8">
          <div className="space-y-2">
            <p className="text-label-caps text-muted-foreground">
              Welcome to {siteConfig.name}
            </p>
            <h1 className="text-title font-semibold tracking-tight text-balance">
              Let&apos;s set up your command center.
            </h1>
            <p className="max-w-lg text-pretty text-muted-foreground">
              Six quick answers. They decide how Life OS reads your day —
              nothing here is busywork.
            </p>
          </div>

          <OnboardingForm profile={toProfileDto(profile)} />
        </div>
      </main>
    </div>
  );
}
