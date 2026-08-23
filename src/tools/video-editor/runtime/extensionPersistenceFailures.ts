/**
 * Privacy-bounded failure taxonomy for extension persistence writes.
 *
 * Browser storage errors often contain file paths, storage keys, or user data
 * in their message.  Callers should classify the failure at the persistence
 * boundary and report only this bounded kind to diagnostics/analytics.
 */
export type ExtensionPersistenceFailureKind =
  | 'permission-denied'
  | 'quota-exceeded'
  | 'write-interrupted'
  | 'storage-unavailable'
  | 'unknown';

export class ExtensionPersistenceWriteError extends Error {
  readonly kind: ExtensionPersistenceFailureKind;
  readonly operation: string;

  constructor(
    kind: ExtensionPersistenceFailureKind,
    operation: string,
    options: { cause?: unknown } = {},
  ) {
    super(`Extension persistence ${operation} failed (${kind}).`, options);
    this.name = 'ExtensionPersistenceWriteError';
    this.kind = kind;
    this.operation = operation;
  }
}

export function classifyExtensionPersistenceFailure(
  error: unknown,
): ExtensionPersistenceFailureKind {
  if (error instanceof ExtensionPersistenceWriteError) return error.kind;

  const name =
    error !== null && typeof error === 'object' && 'name' in error
      ? String((error as { name?: unknown }).name ?? '')
      : '';

  switch (name) {
    case 'SecurityError':
    case 'NotAllowedError':
      return 'permission-denied';
    case 'QuotaExceededError':
      return 'quota-exceeded';
    case 'AbortError':
    case 'TransactionInactiveError':
      return 'write-interrupted';
    case 'InvalidStateError':
    case 'NotFoundError':
    case 'UnknownError':
    case 'VersionError':
      return 'storage-unavailable';
    default:
      return 'unknown';
  }
}

export function extensionPersistenceWriteError(
  error: unknown,
  operation: string,
): ExtensionPersistenceWriteError {
  if (error instanceof ExtensionPersistenceWriteError) return error;
  return new ExtensionPersistenceWriteError(
    classifyExtensionPersistenceFailure(error),
    operation,
    { cause: error },
  );
}
