import type { FieldErrors } from "@/lib/errors";

/**
 * The contract between a server action and the form that calls it.
 *
 * This lives apart from `src/server/action.ts` on purpose. Forms are client
 * components and need these types; `src/server/action.ts` imports the auth
 * and database layers. If the two shared a module, importing the type would
 * pull Prisma and `pg` into the browser bundle — which is exactly what the
 * Next.js build rejected when they did.
 *
 * Nothing in this file may import from `src/server/**` or `src/services/**`.
 */

export type ActionState<TData = undefined> =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly data: TData }
  | {
      readonly status: "error";
      readonly message: string;
      readonly fieldErrors?: FieldErrors;
    };

/** Initial value for `useActionState`. */
export const IDLE_ACTION_STATE: ActionState<never> = { status: "idle" };
