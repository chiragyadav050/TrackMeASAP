"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/common/error-state";

/**
 * Route-level error boundary. Catches render and data-fetching failures below
 * the root layout, keeping the shell and navigation intact.
 */
export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has already logged this with full context; this is the
    // browser-side record, which is all the client is allowed to know.
    console.error("Route error boundary caught an error", {
      digest: error.digest,
    });
  }, [error]);

  return <ErrorState onRetry={reset} digest={error.digest} />;
}
