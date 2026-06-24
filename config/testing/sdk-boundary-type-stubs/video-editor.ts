export const BUILTIN_CLIP_TYPES = [] as const;

export class TimelineVersionConflictError extends Error {
  constructor(message?: string, expectedVersion?: number, actualVersion?: number) {
    super(message ?? `Timeline version conflict: expected ${expectedVersion}, got ${actualVersion}`);
  }
}

export function isTimelineVersionConflictError(error: unknown): boolean {
  return error instanceof TimelineVersionConflictError;
}

export function getStableConfigSignature(): string {
  return '';
}
