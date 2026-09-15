import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";

import { routes } from "@/config/site";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Optional catch-all so Clerk can own its own sub-routes (factor-two, SSO
 * callback, reset password) beneath this path.
 */
export default function SignInPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-title font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-meta text-muted-foreground">
          Sign in to open your command center.
        </p>
      </div>

      <SignIn
        signUpUrl={routes.signUp}
        forceRedirectUrl={routes.overview}
        fallbackRedirectUrl={routes.overview}
      />

      <p className="text-meta text-muted-foreground">
        New here?{" "}
        <Link
          href={routes.signUp}
          className="font-medium text-brand-text underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
