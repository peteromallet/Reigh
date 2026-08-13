/**
 * Standardized error types for the application
 *
 * These error classes help distinguish between different error categories,
 * enabling better error handling, user messaging, and logging.
 */

/**
 * Base application error with additional context
 */
export class AppError extends Error {
  /** Whether this error should be shown to the user via toast */
  public readonly showToast: boolean;
  /** Additional context for logging */
  public readonly context?: Record<string, unknown>;
  /** Original error if this wraps another error */
  public readonly cause?: Error;

  constructor(
    message: string,
    options?: {
      showToast?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'AppError';
    this.showToast = options?.showToast ?? true;
    this.context = options?.context;
    this.cause = options?.cause;
  }
}

/**
 * Marker error raised by our fetch timeout wrappers.
 *
 * This is NOT a user-facing AppError — it is a transport-level marker that
 * travels as the abort reason (or as the `cause` of the resulting
 * `AbortError`) so classifiers can distinguish "we timed the request out"
 * from unrelated aborts (e.g. Supabase's lock-steal protection aborting a
 * session refresh). Use `NetworkError.fromError` / `categorizeError` to
 * present it to users.
 */
export class TimeoutError extends Error {
  constructor(message = 'The request timed out.') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Returns true only for the explicit timeout marker: either the error IS a
 * `TimeoutError`, or it wraps one via `cause`, `context`, or `originalError`
 * (Supabase wraps fetch rejections in `AuthRetryableFetchError`/storage
 * errors that surface the underlying error through those fields; `fetch`
 * itself surfaces `AbortController.abort(reason)` as an `AbortError` whose
 * `cause` is the reason).
 *
 * A generic `AbortError` (lock-steal aborts, caller-cancelled requests) is
 * deliberately NOT a timeout — it must not be presented as "Request timed out".
 */
const TIMEOUT_WRAPPER_KEYS = ['cause', 'context', 'originalError'] as const;

export function isTimeoutError(error: unknown): boolean {
  return isTimeoutErrorDeep(error, new Set<object>());
}

function isTimeoutErrorDeep(error: unknown, seen: Set<object>): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  // Guard against wrapper cycles (e.g. an error whose cause points back at
  // itself) so classification always terminates.
  if (seen.has(error)) {
    return false;
  }
  seen.add(error);

  const record = error as Record<string, unknown>;
  for (const key of TIMEOUT_WRAPPER_KEYS) {
    if (isTimeoutErrorDeep(record[key], seen)) {
      return true;
    }
  }
  return false;
}

/**
 * Network-related errors (fetch failures, timeouts, offline)
 * These are often transient and may benefit from retry
 */
export class NetworkError extends AppError {
  /** Whether the user appears to be offline */
  public readonly isOffline: boolean;
  /** Whether this was a timeout */
  public readonly isTimeout: boolean;

  constructor(
    message: string,
    options?: {
      isOffline?: boolean;
      isTimeout?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { showToast: true, ...options });
    this.name = 'NetworkError';
    this.isOffline = options?.isOffline ?? !navigator.onLine;
    this.isTimeout = options?.isTimeout ?? false;
  }

  static fromError(error: Error, context?: Record<string, unknown>): NetworkError {
    // ONLY the explicit timeout marker counts as a timeout. A generic
    // AbortError (lock-steal aborts, caller-cancelled requests) must not be
    // presented as "Request timed out".
    const isTimeout = isTimeoutError(error);
    const isOffline = !navigator.onLine;

    let message = 'Network request failed';
    if (isOffline) {
      message = 'You appear to be offline. Please check your connection.';
    } else if (isTimeout) {
      message = 'Request timed out. Please try again.';
    }

    return new NetworkError(message, { isOffline, isTimeout, context, cause: error });
  }
}

/**
 * Authentication/authorization errors
 * User needs to log in or doesn't have permission
 */
export class AuthError extends AppError {
  /** Whether the user needs to log in (vs lacking permission) */
  public readonly needsLogin: boolean;

  constructor(
    message: string,
    options?: {
      needsLogin?: boolean;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { showToast: true, ...options });
    this.name = 'AuthError';
    this.needsLogin = options?.needsLogin ?? true;
  }

  static fromError(error: Error, context?: Record<string, unknown>): AuthError {
    const message = error.message.toLowerCase();
    const needsLogin = message.includes('unauthorized') || message.includes('not authenticated');

    return new AuthError(
      needsLogin ? 'Please log in to continue' : 'You don\'t have permission for this action',
      { needsLogin, context, cause: error }
    );
  }
}

/**
 * Validation errors (invalid input, missing required fields)
 * These are user errors that can be corrected
 */
export class ValidationError extends AppError {
  /** The field that failed validation, if applicable */
  public readonly field?: string;

  constructor(
    message: string,
    options?: {
      field?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { showToast: true, ...options });
    this.name = 'ValidationError';
    this.field = options?.field;
  }
}

/**
 * Server/API errors (5xx responses, unexpected server behavior)
 * These are typically not the user's fault
 */
export class ServerError extends AppError {
  /** HTTP status code if available */
  public readonly statusCode?: number;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { showToast: true, ...options });
    this.name = 'ServerError';
    this.statusCode = options?.statusCode;
  }
}

/**
 * Errors that should be silently logged (not shown to user)
 * Use for expected failures like localStorage unavailable, optional features
 */
export class SilentError extends AppError {
  constructor(
    message: string,
    options?: {
      context?: Record<string, unknown>;
      cause?: Error;
    }
  ) {
    super(message, { showToast: false, ...options });
    this.name = 'SilentError';
  }
}

/**
 * Type guard to check if an error is one of our app errors
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard to check if an error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Type guard to check if an error is an auth error
 */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/**
 * Categorize an unknown error into an appropriate AppError type
 */
export function categorizeError(error: unknown, context?: Record<string, unknown>): AppError {
  // Already an AppError
  if (isAppError(error)) {
    return error;
  }

  // Convert to Error if needed
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Network errors
  if (
    isTimeoutError(err) ||
    err.name === 'AbortError' ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to fetch') ||
    !navigator.onLine
  ) {
    return NetworkError.fromError(err, context);
  }

  // Auth errors
  if (
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('not authenticated') ||
    message.includes('authentication required')
  ) {
    return AuthError.fromError(err, context);
  }

  // Validation errors
  if (
    message.includes('required') ||
    message.includes('invalid') ||
    message.includes('validation')
  ) {
    return new ValidationError(err.message, { context, cause: err });
  }

  // Default to generic AppError
  return new AppError(err.message, { context, cause: err });
}
