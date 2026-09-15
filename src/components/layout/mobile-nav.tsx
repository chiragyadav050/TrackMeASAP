"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";

import { AppMark } from "@/components/layout/app-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Navigation for viewports below `lg`, where the persistent sidebar is
 * hidden. Same nav source as the desktop sidebar, so the two can never drift.
 */
export function MobileNav() {
  const pathname = usePathname();

  // The sheet must close on navigation — including browser back/forward,
  // which never fires a link's onClick. Rather than synchronising that with
  // an effect (a second render pass, and flagged by the React Compiler), the
  // route the sheet was opened on is stored alongside the open flag and the
  // pair is adjusted during render. This is React's documented pattern for
  // state that depends on a prop changing.
  const [sheet, setSheet] = useState({ isOpen: false, openedOn: pathname });

  if (sheet.openedOn !== pathname) {
    setSheet({ isOpen: false, openedOn: pathname });
  }

  const isOpen = sheet.isOpen;

  const setIsOpen = useCallback(
    (next: boolean) => {
      setSheet({ isOpen: next, openedOn: pathname });
    },
    [pathname],
  );

  const close = useCallback(() => setIsOpen(false), [setIsOpen]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </Button>
        }
      />

      <SheetContent side="left" className="w-[17rem] px-0">
        <SheetHeader className="px-4 pb-0">
          <SheetTitle className="text-left">
            <AppMark />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Jump to any area of Life OS.
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-y-auto px-2">
          <SidebarNav onNavigate={close} />
        </div>

        <p className="mt-auto border-t border-border-subtle px-5 py-3 text-label text-muted-foreground">
          Press{" "}
          <kbd className="rounded border border-border bg-muted px-1 font-mono">
            ⌘K
          </kbd>{" "}
          to search from anywhere.
        </p>
      </SheetContent>
    </Sheet>
  );
}
