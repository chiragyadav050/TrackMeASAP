"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KEYBOARD_SHORTCUTS } from "@/features/tasks/use-task-shortcuts";

type ShortcutsDialogProps = {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

/**
 * The shortcut reference, opened with `?`.
 *
 * Reads from the same `KEYBOARD_SHORTCUTS` list the README documents, so the
 * in-app help and the docs cannot drift apart.
 */
export function ShortcutsDialog({
  isOpen,
  onOpenChange,
}: ShortcutsDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while you are typing in a field.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y divide-border-subtle">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.description}
              className="flex items-center justify-between gap-4 py-2"
            >
              <dt className="text-meta">{shortcut.description}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-label text-muted-foreground"
                  >
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
