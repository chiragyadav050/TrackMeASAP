import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getClientEnv } from "@/config/env.client";
import { routes, siteConfig } from "@/config/site";
import { clerkAppearance } from "@/lib/clerk-appearance";

import "./globals.css";

/**
 * Both faces are self-hosted by `next/font`, so there is no render-blocking
 * request to a font CDN and no layout shift from a late swap.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  // Nothing here should ever be indexed alongside a user's private data, and
  // the marketing surface is not a public product yet.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfe" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f13" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY } = getClientEnv();

  return (
    // `suppressHydrationWarning` is required by next-themes: its pre-paint
    // script mutates the class list before React hydrates, and without this
    // React would warn about the intentional mismatch on every load.
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh`}>
        <ClerkProvider
          publishableKey={NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
          appearance={clerkAppearance}
          // Keep Clerk's own redirects inside the app rather than sending
          // users to its hosted Account Portal.
          signInUrl={routes.signIn}
          signUpUrl={routes.signUp}
        >
          <ThemeProvider>
            <TooltipProvider delay={250}>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
