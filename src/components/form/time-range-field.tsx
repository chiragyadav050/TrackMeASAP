"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMinutesAsTime, parseMinutesFromTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type TimeRangeFieldProps = {
  readonly label: string;
  readonly hint?: string;
  readonly startName: string;
  readonly endName: string;
  /** Minutes since local midnight. */
  readonly defaultStart: number;
  readonly defaultEnd: number;
  readonly errors?: readonly string[];
};

/**
 * A start/end pair of `<input type="time">` controls.
 *
 * The visible inputs are `HH:mm` (what a person reads); hidden inputs carry
 * the minutes-since-midnight integers the API actually stores, so the form
 * posts the storage representation without the user ever seeing it.
 */
export function TimeRangeField({
  label,
  hint,
  startName,
  endName,
  defaultStart,
  defaultEnd,
  errors,
}: TimeRangeFieldProps) {
  const [start, setStart] = useState(formatMinutesAsTime(defaultStart));
  const [end, setEnd] = useState(formatMinutesAsTime(defaultEnd));

  const hasError = Boolean(errors?.length);
  const groupId = `${startName}-group`;

  return (
    <fieldset className="space-y-1.5" aria-describedby={groupId}>
      <legend className="mb-1.5 text-meta font-medium">{label}</legend>

      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-1">
          <Label
            htmlFor={startName}
            className="text-label text-muted-foreground"
          >
            From
          </Label>
          <Input
            id={startName}
            type="time"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            aria-invalid={hasError || undefined}
            className={cn("h-9", hasError && "border-destructive")}
            required
          />
        </div>

        <div className="flex-1 space-y-1">
          <Label htmlFor={endName} className="text-label text-muted-foreground">
            To
          </Label>
          <Input
            id={endName}
            type="time"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            aria-invalid={hasError || undefined}
            className={cn("h-9", hasError && "border-destructive")}
            required
          />
        </div>
      </div>

      {/* `?? defaultX` keeps a mid-edit empty input from posting NaN; the
          server re-validates the value regardless. */}
      <input
        type="hidden"
        name={startName}
        value={parseMinutesFromTime(start) ?? defaultStart}
      />
      <input
        type="hidden"
        name={endName}
        value={parseMinutesFromTime(end) ?? defaultEnd}
      />

      {hint && !hasError ? (
        <p id={groupId} className="text-label text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {hasError ? (
        <p id={groupId} role="alert" className="text-label text-danger">
          {errors?.join(" ")}
        </p>
      ) : null}
    </fieldset>
  );
}
