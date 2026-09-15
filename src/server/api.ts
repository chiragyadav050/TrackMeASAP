import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";

import { toAppError, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Route-handler conventions.
 *
 * Every JSON endpoint answers with the same envelope so clients can be
 * written once:
 *
 *   success → { success: true,  data: T,    error: null }
 *   failure → { success: false, data: null, error: { code, message } }
 *
 * `error.message` is always the user-safe copy from `AppError`; the technical
 * detail goes to the logs and never crosses the wire.
 */

export type ApiSuccess<TData> = {
  readonly success: true;
  readonly data: TData;
  readonly error: null;
};

export type ApiFailure = {
  readonly success: false;
  readonly data: null;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
  };
};

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

export function apiSuccess<TData>(
  data: TData,
  init?: ResponseInit,
): NextResponse<ApiSuccess<TData>> {
  return NextResponse.json(
    { success: true, data, error: null } as const,
    init ?? { status: 200 },
  );
}

export function apiFailure(error: unknown): NextResponse<ApiFailure> {
  const appError = toAppError(error);

  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code: appError.code, message: appError.userMessage },
    } as const,
    { status: appError.status },
  );
}

/**
 * Wraps a route handler so thrown errors become a correctly-shaped, correctly
 * -statused JSON failure instead of an unhandled 500 with a stack trace.
 */
export function withApiErrorHandling<TArgs extends unknown[], TData>(
  name: string,
  handler: (...args: TArgs) => Promise<NextResponse<ApiSuccess<TData>>>,
): (...args: TArgs) => Promise<NextResponse<ApiResponse<TData>>> {
  return async (...args: TArgs) => {
    const log = logger.child({ route: name });

    try {
      return await handler(...args);
    } catch (error) {
      // Let Next's own control-flow throws (redirect, notFound) through.
      unstable_rethrow(error);

      const appError = toAppError(error);

      const context = { code: appError.code, detail: appError.message };

      if (appError.status >= 500) {
        log.error("Route handler failed", context);
      } else {
        log.warn("Route handler rejected request", context);
      }

      return apiFailure(appError);
    }
  };
}
