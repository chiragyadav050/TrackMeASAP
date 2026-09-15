import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";

import { routes } from "@/config/site";

export const metadata: Metadata = {
  title: "Create your account",
};

export default function SignUpPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-title font-semibold tracking-tight">
          Create your account
        </h1>
        <p className="text-meta text-muted-foreground">
          Two minutes of setup, then everything lives in one place.
        </p>
      </div>

      <SignUp
        signInUrl={routes.signIn}
        forceRedirectUrl={routes.onboarding}
        fallbackRedirectUrl={routes.onboarding}
      />

      <p className="text-meta text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={routes.signIn}
          className="font-medium text-brand-text underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
