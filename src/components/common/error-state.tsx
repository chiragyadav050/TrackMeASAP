"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/site";

type ErrorStateProps = {
  readonly title?: string;
  readonly description?: string;
  readonly onRetry?: () => void;
  /**
   * Next.js error digest. Safe to show: it is an opaque id that maps to the
   * full stack trace in the server logs and reveals nothing by itself.
   */
  readonly digest?: string;
};

/**
 * The user-facing face of a crash.
 *
 * Deliberately shows no `error.message`. Raw messages leak internals like
 * `PrismaClientKnownRequestError P2002`, which mean nothing to a user and
 * something to an attacker. The digest is the bridge to the real detail in
 * the logs.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This surface failed to load. The error has been logged — trying again often resolves it.",
  onRetry,
  digest,
}: ErrorStateProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div
        className="mb-4 flex size-11 items-center justify-center rounded-xl border border-danger-muted bg-danger-muted text-danger"
        aria-hidden
      >
        <TriangleAlert className="size-5" />
      </div>

      <h1 className="text-heading font-semibold tracking-tight">{title}</h1>

      <p className="mt-2 max-w-sm text-pretty text-muted-foreground">
        {description}
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button onClick={onRetry}>
            <RotateCw className="size-4" />
            Try again
          </Button>
        ) : null}

        <Button
          variant="outline"
          render={<Link href={routes.overview}>Back to Overview</Link>}
        />
      </div>

      {digest ? (
        <p className="mt-6 font-mono text-label text-muted-foreground">
          Reference: {digest}
        </p>
      ) : null}
    </div>
  );
}
