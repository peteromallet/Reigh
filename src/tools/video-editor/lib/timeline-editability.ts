/**
 * Host-owned, runtime-only editability contract.
 *
 * Clip/track locks are deliberately not added to the vendor timeline schema:
 * they are session/permission state owned by the host and must not be
 * serialized as managed metadata. Callers must check this guard again at
 * commit time because a lock may change while a pointer gesture is active.
 */
export type TimelineEditabilityReason = 'timeline_read_only' | 'clip_locked' | 'track_locked';

export interface TimelineEditabilityResult {
  allowed: boolean;
  reason?: TimelineEditabilityReason;
}

export interface TimelineEditability {
  check(input: {
    clipId: string;
    sourceTrackId: string | null;
    targetTrackId: string | null;
  }): TimelineEditabilityResult;
}

export interface TimelineEditabilityOptions {
  readOnly?: boolean;
  lockedClipIds?: Iterable<string>;
  lockedTrackIds?: Iterable<string>;
}

export function createTimelineEditability(options: TimelineEditabilityOptions = {}): TimelineEditability {
  const lockedClipIds = new Set(options.lockedClipIds ?? []);
  const lockedTrackIds = new Set(options.lockedTrackIds ?? []);
  return {
    check({ clipId, sourceTrackId, targetTrackId }) {
      if (options.readOnly) return { allowed: false, reason: 'timeline_read_only' };
      if (lockedClipIds.has(clipId)) return { allowed: false, reason: 'clip_locked' };
      if ((sourceTrackId && lockedTrackIds.has(sourceTrackId)) || (targetTrackId && lockedTrackIds.has(targetTrackId))) {
        return { allowed: false, reason: 'track_locked' };
      }
      return { allowed: true };
    },
  };
}

export const allowTimelineEdits: TimelineEditability = {
  check: () => ({ allowed: true }),
};
