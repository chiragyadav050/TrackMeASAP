import { ChevronsUpDown } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>` styled to match the design system.
 *
 * Chosen over a custom listbox for the settings forms on purpose:
 *   • it is submitted by plain `FormData`, with no hidden-input plumbing;
 *   • its keyboard and screen-reader behaviour is the platform's, which is
 *     better than anything hand-rolled and correct on mobile too;
 *   • it stays fast with the ~400-entry IANA time-zone list, where a virtual
 *     listbox would be the only alternative.
 */
export function NativeSelect({
  className,
  children,
  ...props
}: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-input bg-background py-1.5 pr-8 pl-2.5 text-sm text-foreground transition-colors",
          "hover:border-border-strong",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          "dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>

      <ChevronsUpDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
