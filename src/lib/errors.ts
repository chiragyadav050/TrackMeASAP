/**
 * Application error taxonomy.
 *
 * The core idea: every error carries BOTH a technical message (for logs) and
 * a `userMessage` that is safe to render. Nothing else in the app is allowed
 * to put a raw `error.message` in front of a user, so internals like
 * `PrismaClientKnownRequestError P2002` can never leak into the UI.
 */

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR_CODE: Readonly<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

const GENERIC_USER_MESSAGE =
  "Something went wrong on our end. Please try again in a moment.";

/** Field-level messages keyed by form field name. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Safe to display verbatim to an end user. Never contains internals. */
  readonly userMessage: string;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;

  constructor(options: {
    code: ErrorCode;
    /** Technical detail for logs. */
    message: string;
    userMessage?: string;
    fieldErrors?: FieldErrors;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.userMessage = options.userMessage ?? GENERIC_USER_MESSAGE;
    this.status = HTTP_STATUS_BY_ERROR_CODE[options.code];
    this.fieldErrors = options.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const unauthorized = (
  detail = "No authenticated Clerk session",
): AppError =>
  new AppError({
    code: "UNAUTHORIZED",
    message: detail,
    userMessage: "You need to sign in to continue.",
  });

export const forbidden = (
  detail = "Actor does not own the target resource",
): AppError =>
  new AppError({
    code: "FORBIDDEN",
    message: detail,
    userMessage: "You do not have access to this.",
  });

export const notFound = (resource: string): AppError =>
  new AppError({
    code: "NOT_FOUND",
    message: `${resource} not found`,
    userMessage: "We could not find what you were looking for.",
  });

export const validationFailed = (
  fieldErrors: FieldErrors,
  detail = "Input failed schema validation",
): AppError =>
  new AppError({
    code: "VALIDATION_FAILED",
    message: detail,
    userMessage: "Please check the highlighted fields and try again.",
    fieldErrors,
  });

export const rateLimited = (retryAfterSeconds: number): AppError =>
  new AppError({
    code: "RATE_LIMITED",
    message: `Rate limit exceeded; retry after ${retryAfterSeconds}s`,
    userMessage: "You are doing that a bit too quickly. Try again shortly.",
  });

export const internal = (detail: string, cause?: unknown): AppError =>
  new AppError({
    code: "INTERNAL",
    message: detail,
    userMessage: GENERIC_USER_MESSAGE,
    cause,
  });

/**
 * Normalises anything thrown anywhere into an `AppError`.
 *
 * Unknown throwables collapse to a generic INTERNAL error so that driver and
 * ORM messages are logged but never surfaced.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return internal(`${error.name}: ${error.message}`, error);
  }

  return internal(`Non-Error thrown: ${String(error)}`, error);
}

/**
 * The only supported way to get a user-facing string out of an error.
 */
export function toUserMessage(error: unknown): string {
  return isAppError(error) ? error.userMessage : GENERIC_USER_MESSAGE;
}
