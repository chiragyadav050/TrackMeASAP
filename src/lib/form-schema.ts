import { z } from "zod";

/**
 * Schema helpers for values that arrive from an HTML form.
 *
 * HTML form semantics and TypeScript types disagree in ways that are easy to
 * miss until a real browser posts a real form — every value is a string, and
 * an unchecked checkbox is not sent at all. These helpers translate at the
 * boundary so the rest of the schema can stay honestly typed.
 */

/**
 * A checkbox.
 *
 * Three cases, and all three matter:
 *
 *   • CHECKED    → the browser sends the input's `value`, normally `"true"`
 *                  or `"on"`. A bare `z.boolean()` rejects that string, which
 *                  takes the whole form down.
 *   • UNCHECKED  → the key is ABSENT. That has to mean `false`, which is why
 *                  this cannot be expressed as `z.boolean().default(true)`:
 *                  a default would resurrect a box the user deliberately
 *                  cleared.
 *   • A COMMAND  → typed server actions pass a real boolean, so those must
 *                  keep working unchanged.
 *
 * `absentMeans` exists only for schemas shared with non-form callers, where a
 * missing key genuinely means "unspecified" rather than "unchecked".
 */
export function formBoolean(absentMeans = false) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return absentMeans;
    }

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value === "true" || value === "on" || value === "1";
    }

    return Boolean(value);
  }, z.boolean());
}
