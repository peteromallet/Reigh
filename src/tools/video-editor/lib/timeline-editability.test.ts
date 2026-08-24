import { describe, expect, it } from 'vitest';
import { createTimelineEditability } from './timeline-editability.ts';
import { planClipDrag } from './clip-drag-planner.ts';

describe('timeline editability', () => {
  it('returns stable host-owned reasons', () => {
    expect(createTimelineEditability({ readOnly: true }).check({ clipId: 'c', sourceTrackId: 'V1', targetTrackId: 'V2' })).toEqual({ allowed: false, reason: 'timeline_read_only' });
    expect(createTimelineEditability({ lockedClipIds: ['c'] }).check({ clipId: 'c', sourceTrackId: 'V1', targetTrackId: 'V2' })).toEqual({ allowed: false, reason: 'clip_locked' });
    expect(createTimelineEditability({ lockedTrackIds: ['V2'] }).check({ clipId: 'c', sourceTrackId: 'V1', targetTrackId: 'V2' })).toEqual({ allowed: false, reason: 'track_locked' });
  });

  it('permits an unlocked move', () => {
    expect(createTimelineEditability().check({ clipId: 'c', sourceTrackId: 'V1', targetTrackId: 'V2' })).toEqual({ allowed: true });
  });

  it('makes a locked target a rejected drag plan', () => {
    const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1' }];
    const plan = planClipDrag({
      pointerTime: 2,
      clipDuration: 10,
      clipId: 'clip-1',
      sourceKind: 'visual',
      tracks,
      rows: [{ id: 'V1', actions: [] }],
      pointerRowIndex: 0,
      pixelSnapThreshold: 8,
      pixelsPerSecond: 10,
      editability: createTimelineEditability({ lockedTrackIds: ['V1'] }),
    });
    expect(plan.valid).toBe(false);
    expect(plan.rejectReason).toBe('track_locked');
  });
});
