"use client";

import { Search } from "lucide-react";

import { useCommandPalette } from "@/components/command/command-palette-provider";
import { Button } from "@/components/ui/button";

/**
 * Header affordance that opens the ⌘K palette.
 *
 * Shows the real shortcut so the keyboard path is discoverable rather than
 * hidden behind documentation.
 */
export function CommandTrigger() {
  const { open } = useCommandPalette();

  return (
    <>
      {/* Wide viewports: a search-field-shaped button that advertises ⌘K. */}
      <Button
        variant="outline"
        size="sm"
        onClick={open}
        data-tour="command-palette"
        className="hidden w-56 justify-start gap-2 font-normal text-muted-foreground sm:flex"
      >
        <Search className="size-3.5" aria-hidden />
        <span>Search…</span>
        <kbd className="ml-auto rounded border border-border bg-muted px-1 py-px font-mono text-[10px] leading-4 text-muted-foreground">
          ⌘K
        </kbd>
      </Button>

      {/* Narrow viewports: icon only; the shortcut is irrelevant on touch. */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={open}
        className="sm:hidden"
        aria-label="Search"
      >
        <Search className="size-4" />
      </Button>
    </>
  );
}
