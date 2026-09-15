import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /** Messages from the server action's `fieldErrors`. */
  readonly errors?: readonly string[];
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * Label + control + hint + error, wired together for assistive technology.
 *
 * The control must accept `id`, and read `aria-describedby` / `aria-invalid`
 * from {@link fieldAria} so the hint and error text are actually announced
 * rather than just being visible.
 */
export function Field({
  id,
  label,
  hint,
  errors,
  children,
  className,
}: FieldProps) {
  const hasError = Boolean(errors?.length);

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-meta font-medium">
        {label}
      </Label>

      {children}

      {hint && !hasError ? (
        <p id={`${id}-hint`} className="text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {hasError ? (
        // `role="alert"` so a validation failure is announced immediately
        // after a submit, not only on focus.
        <p id={`${id}-error`} role="alert" className="text-label text-danger">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The ARIA wiring a {@link Field}'s control needs. Kept as a helper so every
 * control gets it right without repeating the id arithmetic.
 */
export function fieldAria(
  id: string,
  options: { hasHint?: boolean; hasError?: boolean },
): {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
} {
  const describedBy = options.hasError
    ? `${id}-error`
    : options.hasHint
      ? `${id}-hint`
      : undefined;

  return {
    id,
    "aria-invalid": options.hasError || undefined,
    "aria-describedby": describedBy,
  };
}
