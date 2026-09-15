import type { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";

/**
 * Derived from `ClerkProvider` rather than imported from `@clerk/types`,
 * which is deprecated as a direct dependency. This stays correct across Clerk
 * upgrades because it is the exact type the prop already accepts.
 */
type Appearance = NonNullable<
  ComponentProps<typeof ClerkProvider>["appearance"]
>;

/**
 * Makes Clerk's hosted components adopt the Life OS design system.
 *
 * Only Tailwind classes built from our own tokens are used, so the forms
 * re-theme automatically in dark mode instead of needing a second palette.
 */
export const clerkAppearance: Appearance = {
  // Styling is done entirely through `elements`. The `layout` block is
  // deliberately unused: two versions of Clerk's shared types are present in
  // the tree and the one `ClerkProvider` resolves to does not accept it.
  // Everything it would have configured (hiding Clerk's own header and logo,
  // block-style social buttons) is achieved below anyway.
  elements: {
    rootBox: "w-full",
    cardBox: "w-full shadow-none border-none",
    card: "bg-transparent shadow-none border-none p-0 gap-5",
    header: "hidden",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 h-9 text-sm font-medium normal-case shadow-none rounded-lg transition-colors",
    formFieldInput:
      "bg-background border-input text-foreground h-9 rounded-lg text-sm shadow-none",
    formFieldLabel: "text-foreground text-meta font-medium",
    socialButtonsBlockButton:
      "border-border bg-background hover:bg-muted text-foreground h-9 rounded-lg text-sm normal-case shadow-none transition-colors",
    dividerLine: "bg-border",
    dividerText: "text-muted-foreground text-label-caps",
    footer: "hidden",
    footerAction: "hidden",
    identityPreviewEditButton: "text-brand-text",
    formResendCodeLink: "text-brand-text",
    otpCodeFieldInput: "border-input bg-background text-foreground rounded-lg",
  },
};
