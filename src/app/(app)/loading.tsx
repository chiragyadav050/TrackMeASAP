import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streaming fallback for authenticated pages.
 *
 * Mirrors the real layout — a header block, then the Overview tile grid — so
 * the page settles into place instead of jumping when content arrives. The
 * shell around it stays interactive throughout.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2 lg:row-span-2" />
        <Skeleton className="h-34 rounded-xl" />
        <Skeleton className="h-34 rounded-xl" />
        <Skeleton className="h-34 rounded-xl" />
        <Skeleton className="h-34 rounded-xl" />
        <Skeleton className="h-24 rounded-xl lg:col-span-3" />
      </div>
    </div>
  );
}
