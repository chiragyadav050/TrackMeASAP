import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import type { Profile } from "@/generated/prisma/client";
import {
  rateLimited,
  toAppError,
  validationFailed,
  type FieldErrors,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import { mutationRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { requireProfile } from "@/server/auth";
import type { ActionState } from "@/types/action";

/**
 * The one way to write a mutating server action.
 *
 * Wrapping every action in this factory guarantees the same five steps run in
 * the same order, every time:
 *
 *   1. authenticate  — identity comes from Clerk, never from the payload
 *   2. rate limit    — keyed by the authenticated profile
 *   3. validate      — Zod, against the raw FormData
 *   4. execute       — your handler, with a typed input and a typed context
 *   5. normalise     — technical errors are logged; users see safe copy
 *
 * The return value is a `useActionState`-compatible discriminated union, so
 * forms get field-level errors without any bespoke plumbing.
 */

export type ActionContext = {
  readonly profile: Profile;
  readonly logger: ReturnType<typeof logger.child>;
};

type ActionConfig<TSchema extends z.ZodType, TData> = {
  /** Stable identifier used in logs and as the rate-limit bucket. */
  readonly name: string;
  readonly schema: TSchema;
  readonly handler: (
    input: z.infer<TSchema>,
    context: ActionContext,
  ) => Promise<TData>;
  readonly rateLimiter?: RateLimiter;
};

/**
 * Converts a Zod error into the flat `{ field: [messages] }` shape that form
 * components consume. Top-level (non-field) issues land under `_form`.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const collected: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    collected[key] = [...(collected[key] ?? []), issue.message];
  }

  return collected;
}

/**
 * FormData values are always `string | File`. Zod coercion handles the
 * numeric fields, so this only needs to drop files and collapse the entries
 * into a plain object.
 */
function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") {
      continue;
    }

    // AN EMPTY FIELD MEANS "NOT PROVIDED", NOT "PROVIDED AS EMPTY".
    //
    // The browser submits "" for every untouched input, including optional
    // `<input type="date">` and `<input type="time">`. Zod's `.optional()`
    // tolerates a MISSING key, not an empty string, so `dueDate: ""` fails a
    // `YYYY-MM-DD` regex and takes the whole form down — even though the user
    // simply left an optional field alone.
    //
    // Dropping the key here fixes the entire class of field at once rather
    // than needing every optional schema to special-case "". Text fields are
    // unaffected: their schemas already map "" to undefined, so an emptied
    // description still clears exactly as before.
    //
    // Repeated keys (checkbox groups such as `weekdays`) collect into an
    // array, so a multi-select still arrives whole.
    if (value === "") {
      continue;
    }

    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

/**
 * The same five guarantees as {@link createAuthenticatedAction}, for actions
 * called with a typed argument instead of a `<form>` submission.
 *
 * Most task interactions — ticking a checkbox, changing a priority from a
 * menu, a bulk reschedule — are not form posts. Funnelling them through
 * FormData would mean stringifying structured input on the way out and
 * parsing it back on the way in, losing type safety in the middle for no
 * benefit.
 *
 * SECURITY: the argument is as untrusted as any request body. It is parsed by
 * the same Zod schema, and identity still comes only from the session.
 */
export function createAuthenticatedCommand<TSchema extends z.ZodType, TData>(
  config: ActionConfig<TSchema, TData>,
) {
  const limiter = config.rateLimiter ?? mutationRateLimiter;

  return async function command(input: unknown): Promise<ActionState<TData>> {
    const log = logger.child({ action: config.name });

    try {
      const profile = await requireProfile();

      const limit = await limiter.check(`${config.name}:${profile.id}`);

      if (!limit.allowed) {
        throw rateLimited(limit.retryAfterSeconds);
      }

      const parsed = config.schema.safeParse(input);

      if (!parsed.success) {
        throw validationFailed(toFieldErrors(parsed.error));
      }

      const data = await config.handler(parsed.data, {
        profile,
        logger: log.child({ profileId: profile.id }),
      });

      return { status: "success", data };
    } catch (error) {
      unstable_rethrow(error);

      const appError = toAppError(error);
      const logContext = { code: appError.code, detail: appError.message };

      if (appError.status >= 500) {
        log.error("Command failed", logContext);
      } else {
        log.warn("Command rejected", logContext);
      }

      return {
        status: "error",
        message: appError.userMessage,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
      };
    }
  };
}

export function createAuthenticatedAction<TSchema extends z.ZodType, TData>(
  config: ActionConfig<TSchema, TData>,
) {
  const limiter = config.rateLimiter ?? mutationRateLimiter;

  return async function action(
    _previousState: ActionState<TData>,
    formData: FormData,
  ): Promise<ActionState<TData>> {
    const log = logger.child({ action: config.name });

    try {
      // 1. Identity, from the session only.
      const profile = await requireProfile();

      // 2. Throttle per profile, so one account cannot spam the database.
      const limit = await limiter.check(`${config.name}:${profile.id}`);

      if (!limit.allowed) {
        throw rateLimited(limit.retryAfterSeconds);
      }

      // 3. Validate the untrusted payload.
      const parsed = config.schema.safeParse(formDataToObject(formData));

      if (!parsed.success) {
        throw validationFailed(toFieldErrors(parsed.error));
      }

      // 4. Run the business logic.
      const data = await config.handler(parsed.data, {
        profile,
        logger: log.child({ profileId: profile.id }),
      });

      return { status: "success", data };
    } catch (error) {
      // `redirect()` and `notFound()` signal control flow by throwing. They
      // must escape this handler untouched, or a handler that navigates would
      // silently turn into a generic error toast.
      unstable_rethrow(error);

      // 5. Log the technical truth; return only the safe message.
      const appError = toAppError(error);

      const logContext = {
        code: appError.code,
        detail: appError.message,
      };

      if (appError.status >= 500) {
        log.error("Server action failed", logContext);
      } else {
        log.warn("Server action rejected", logContext);
      }

      return {
        status: "error",
        message: appError.userMessage,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
      };
    }
  };
}
