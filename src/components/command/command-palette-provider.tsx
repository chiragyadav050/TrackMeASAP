"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CommandPalette } from "@/components/command/command-palette";
import { useTaskDialog } from "@/features/tasks/task-dialog-provider";

type CommandPaletteContextValue = {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly setOpen: (next: boolean) => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

/**
 * Owns the ⌘K / Ctrl+K palette for the authenticated shell.
 *
 * Keeping the open state in context means any surface can raise the palette
 * (the header button today; a "create task" affordance in Phase 2) without
 * each one mounting its own dialog.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const { openCreate } = useTaskDialog();

  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) {
        return;
      }

      // Stop the browser's own ⌘K (search bar focus) from also firing.
      event.preventDefault();
      setOpen((current) => !current);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ isOpen, open, close, setOpen }),
    [isOpen, open, close],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette
        isOpen={isOpen}
        onOpenChange={setOpen}
        onCreateTask={() => openCreate()}
      />
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const context = useContext(CommandPaletteContext);

  if (!context) {
    throw new Error(
      "useCommandPalette must be used inside a <CommandPaletteProvider>",
    );
  }

  return context;
}
