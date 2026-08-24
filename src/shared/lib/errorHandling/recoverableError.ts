import type { ErrorInfo } from 'react';
import { normalizeAndPresentError } from './runtimeError';

interface RecoverableErrorOptions {
  context: string;
  logData?: Record<string, unknown>;
}

interface ErrorBoundaryReportInput {
  context: string;
  error: Error;
  errorInfo?: ErrorInfo | null;
  recoveryAction?: 'reload' | 'fallback' | 'none';
}

export function reportRecoverableError(error: unknown, options: RecoverableErrorOptions): void {
  normalizeAndPresentError(error, {
    context: options.context,
    showToast: false,
    logData: options.logData,
  });
}

export function reportErrorBoundaryCatch(input: ErrorBoundaryReportInput): void {
  reportRecoverableError(input.error, {
    context: input.context,
    logData: {
      name: input.error.name,
      stack: input.error.stack?.split('\n').slice(0, 6).join('\n'),
      componentStack: input.errorInfo?.componentStack?.split('\n').slice(0, 10).join('\n'),
      recoveryAction: input.recoveryAction ?? 'none',
    },
  });
}

export async function withRecoverableHandling<T>(
  operation: () => Promise<T> | T,
  options: RecoverableErrorOptions,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    reportRecoverableError(error, options);
    return undefined;
  }
}
