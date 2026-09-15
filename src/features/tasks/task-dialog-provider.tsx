"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ShortcutsDialog } from "@/features/tasks/components/shortcuts-dialog";
import { TaskDialog } from "@/features/tasks/components/task-dialog";
import { useTaskShortcuts } from "@/features/tasks/use-task-shortcuts";

type TaskDialogContextValue = {
  /** Opens the create form, optionally pre-filled with a typed title. */
  readonly openCreate: (title?: string) => void;
  readonly openEdit: (taskId: string) => void;
  readonly close: () => void;
};

const TaskDialogContext = createContext<TaskDialogContextValue | null>(null);

type DialogState =
  | { readonly kind: "closed" }
  | { readonly kind: "create"; readonly title: string }
  | { readonly kind: "edit"; readonly taskId: string };

/**
 * Owns the task dialog for the whole authenticated shell.
 *
 * Hoisted here rather than kept inside each page for three reasons: the ⌘K
 * palette can open it from any surface, the `c` shortcut works everywhere,
 * and the Tasks and Today pages stop maintaining two copies of identical
 * dialog state that could drift.
 */
export function TaskDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({ kind: "closed" });
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  const openCreate = useCallback((title = "") => {
    setState({ kind: "create", title });
  }, []);

  const openEdit = useCallback((taskId: string) => {
    setState({ kind: "edit", taskId });
  }, []);

  const close = useCallback(() => setState({ kind: "closed" }), []);

  // `c` and `?` from anywhere in the shell. The hook ignores the keystroke
  // whenever focus is in a text field, so it never eats a letter mid-sentence.
  useTaskShortcuts({
    onCreateTask: () => openCreate(),
    onShowHelp: () => setIsShortcutsOpen(true),
  });

  const value = useMemo<TaskDialogContextValue>(
    () => ({ openCreate, openEdit, close }),
    [openCreate, openEdit, close],
  );

  return (
    <TaskDialogContext.Provider value={value}>
      {children}

      <TaskDialog
        isOpen={state.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
        taskId={state.kind === "edit" ? state.taskId : null}
        initialTitle={state.kind === "create" ? state.title : ""}
      />

      <ShortcutsDialog
        isOpen={isShortcutsOpen}
        onOpenChange={setIsShortcutsOpen}
      />
    </TaskDialogContext.Provider>
  );
}

export function useTaskDialog(): TaskDialogContextValue {
  const context = useContext(TaskDialogContext);

  if (!context) {
    throw new Error("useTaskDialog must be used inside a <TaskDialogProvider>");
  }

  return context;
}
