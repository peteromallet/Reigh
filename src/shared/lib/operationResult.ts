export type OperationFailurePolicy = 'fail_closed' | 'fail_open' | 'degrade' | 'best_effort';

interface OperationSuccess<T> {
  ok: true;
  value: T;
  policy: OperationFailurePolicy;
}

export interface OperationFailure {
  ok: false;
  error: Error;
  message: string;
  recoverable: boolean;
  policy: OperationFailurePolicy;
  errorCode: string;
  cause?: unknown;
}

export type OperationResult<T> = OperationSuccess<T> | OperationFailure;

interface OperationFailureLogData extends Record<string, unknown> {
  operationMessage: string;
  operationErrorCode: string;
  operationPolicy: OperationFailurePolicy;
  operationRecoverable: boolean;
  operationCause?: unknown;
}

class OperationResultError extends Error {
  errorCode: string;
  policy: OperationFailurePolicy;
  recoverable: boolean;
  cause?: unknown;

  constructor(options: {
    message: string;
    errorCode: string;
    policy: OperationFailurePolicy;
    recoverable: boolean;
    cause?: unknown;
    sourceError?: Error;
  }) {
    super(options.message);
    this.name = 'OperationResultError';
    this.errorCode = options.errorCode;
    this.policy = options.policy;
    this.recoverable = options.recoverable;
    this.cause = options.cause;

    // Preserve the original stack for easier debugging when available.
    if (options.sourceError?.stack) {
      this.stack = options.sourceError.stack;
    }
  }
}

interface OperationSuccessOptions {
  policy?: OperationFailurePolicy;
}

interface OperationFailureOptions {
  policy?: OperationFailurePolicy;
  recoverable?: boolean;
  errorCode?: string;
  message?: string;
  cause?: unknown;
}

const DEFAULT_FAILURE_POLICY: OperationFailurePolicy = 'best_effort';

function normalizeOperationError(error: unknown, fallbackMessage?: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (fallbackMessage) {
    return new Error(fallbackMessage);
  }

  return new Error(String(error));
}

export function operationSuccess<T>(value: T, options?: OperationSuccessOptions): OperationSuccess<T> {
  const policy = options?.policy ?? DEFAULT_FAILURE_POLICY;
  return {
    ok: true,
    value,
    policy,
  };
}

export function operationFailure(error: unknown, options?: OperationFailureOptions): OperationFailure {
  const normalizedError = normalizeOperationError(error, options?.message);
  const failureMessage = options?.message ?? normalizedError.message;
  const failure: OperationFailure = {
    ok: false,
    error: normalizedError,
    message: failureMessage,
    recoverable: options?.recoverable ?? true,
    policy: options?.policy ?? DEFAULT_FAILURE_POLICY,
    errorCode: options?.errorCode ?? 'operation_failed',
  };

  if (options?.cause !== undefined) {
    failure.cause = options.cause;
  }

  return failure;
}

export function getOperationFailureLogData(
  failure: OperationFailure,
): OperationFailureLogData {
  return {
    operationMessage: failure.message,
    operationErrorCode: failure.errorCode,
    operationPolicy: failure.policy,
    operationRecoverable: failure.recoverable,
    ...(failure.cause !== undefined ? { operationCause: failure.cause } : {}),
  };
}

/**
 * Convert a structured operation failure into an Error while preserving machine-readable metadata.
 */
export function toOperationResultError(failure: OperationFailure): OperationResultError {
  return new OperationResultError({
    message: failure.message,
    errorCode: failure.errorCode,
    policy: failure.policy,
    recoverable: failure.recoverable,
    cause: failure.cause,
    sourceError: failure.error,
  });
}
