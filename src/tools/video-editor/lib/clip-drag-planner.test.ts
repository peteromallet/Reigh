import { describe, expect, it } from 'vitest';
import {
  planClipDrag,
  createInvalidPlan,
  type ClipDragPlanInput,
  type ClipDragPlan,
} from '@/tools/video-editor/lib/clip-drag-planner';
import type { TrackDefinition, TrackKind } from '@/tools/video-editor/types/index.ts';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';

// ── Test helpers ──────────────────────────────────────────────────────

function makeTrack(
  id: string,
  kind: TrackKind,
  label?: string,
): TrackDefinition {
  return { id, kind, label: label ?? id };
}

function makeRow(id: string, actions: Array<{ id: string; start: number; end: number }>): TimelineRow {
  return {
    id,
    actions: actions.map((a) => ({
      id: a.id,
      start: a.start,
      end: a.end,
      effectId: `effect-${a.id}`,
    })),
  };
}

/** Default input for a typical pointer-drag plan. Callers override individual fields. */
function defaults(overrides: Partial<ClipDragPlanInput> = {}): ClipDragPlanInput {
  return {
    pointerTime: 5,
    clipDuration: 2,
    clipId: 'dragged-clip',
    excludeClipIds: new Set(),
    sourceKind: 'visual',
    tracks: [makeTrack('V1', 'visual')],
    rows: [makeRow('V1', [{ id: 'sib1', start: 8, end: 10 }])],
    pointerRowIndex: 0,
    pixelSnapThreshold: 100,
    pixelsPerSecond: 100,
    ...overrides,
  };
}

// ── Pointer anchoring ─────────────────────────────────────────────────

describe('pointer anchoring', () => {
  it('resolves resolvedStart to pointerTime when no snap edges are nearby', () => {
    const plan = planClipDrag(defaults({ pointerTime: 5 }));
    expect(plan.resolvedStart).toBe(5);
    expect(plan.snapped).toBe(false);
    expect(plan.snapEdgeType).toBe('none');
  });

  it('clamps negative pointerTime to 0', () => {
    const plan = planClipDrag(defaults({ pointerTime: -3 }));
    expect(plan.resolvedStart).toBe(0);
    expect(plan.pointerTime).toBe(-3);
  });

  it('preserves raw pointerTime even when resolvedStart differs after snapping', () => {
    const plan = planClipDrag(
      defaults({ pointerTime: 0.3, rows: [makeRow('V1', [])] }),
    );
    // At 100px/s threshold = 1s. pointerTime 0.3 is within 1s of 0 → snap to 0.
    expect(plan.pointerTime).toBe(0.3);
    expect(plan.resolvedStart).toBe(0);
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('timeline-start');
  });
});
// ── Timeline-start snap to 0 ──────────────────────────────────────────

describe('timeline-start snap to 0', () => {
  it('snaps to 0 when pointerTime is within snapThresholdS of 0', () => {
    // snapThresholdS = 100/100 = 1s
    const plan = planClipDrag(
      defaults({
        pointerTime: 0.5,
        rows: [makeRow('V1', [])],
      }),
    );
    expect(plan.resolvedStart).toBe(0);
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('timeline-start');
  });

  it('does not snap to 0 when pointerTime exceeds snapThresholdS', () => {
    // snapThresholdS = 100/100 = 1s, pointerTime=2 > 1s
    const plan = planClipDrag(
      defaults({
        pointerTime: 2,
        rows: [makeRow('V1', [])],
      }),
    );
    expect(plan.resolvedStart).toBe(2);
    expect(plan.snapped).toBe(false);
  });

  it('does not snap to 0 when a sibling occupies position 0', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 0.5,
        clipDuration: 2,
        rows: [makeRow('V1', [{ id: 'blocker', start: 0, end: 3 }])],
      }),
    );
    // pointerTime=0.5 is within threshold but position 0 is blocked
    expect(plan.resolvedStart).not.toBe(0);
    expect(plan.snapEdgeType).not.toBe('timeline-start');
  });
});

// ── Explicit pixel-derived threshold snapping ─────────────────────────

describe('sibling-edge snapping within explicit threshold', () => {
  it('snaps to a sibling end when pointerTime is within threshold', () => {
    // sibling at 8-10, pointerTime=10.5, threshold=1s
    const plan = planClipDrag(
      defaults({
        pointerTime: 10.5,
        clipDuration: 2,
        rows: [makeRow('V1', [{ id: 'sib1', start: 8, end: 10 }])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(10);
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('sibling-end');
  });

  it('snaps to the nearest valid edge (sibling-end) when multiple edges compete', () => {
    // Two siblings: sib1 at 2-4 (end=4), timeline-start at 0.
    // pointerTime=3.5, threshold=1s: dist to 4 is 0.5, dist to 0 is 3.5.
    // Snap to sibling-end at 4 wins.
    const plan = planClipDrag(
      defaults({
        pointerTime: 3.5,
        clipDuration: 1,
        clipId: 'dragged-clip',
        rows: [makeRow('V1', [{ id: 'sib1', start: 2, end: 4 }])],
        pixelSnapThreshold: 200,
        pixelsPerSecond: 200,
      }),
    );
    // snapThresholdS = 200/200 = 1s. Nearest edge = sibling-end at 4 (dist=0.5).
    // Placing at 4 with duration=1 → [4,5], doesn't overlap sib1 at [2,4].
    expect(plan.resolvedStart).toBe(4);
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('sibling-end');
  });

  it('does not snap to a sibling edge beyond the explicit threshold', () => {
    // sibling at 8-10, pointerTime=13, threshold=1s — nearest edge is 10 (dist=3)
    const plan = planClipDrag(
      defaults({
        pointerTime: 13,
        clipDuration: 2,
        rows: [makeRow('V1', [{ id: 'sib1', start: 8, end: 10 }])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(13);
    expect(plan.snapped).toBe(false);
  });

  it('respects tighter pixel-derived thresholds', () => {
    // snapThresholdS = 20/100 = 0.2s
    // sibling at 8-10, pointerTime=10.1 → dist=0.1 < 0.2 → snap
    const plan = planClipDrag(
      defaults({
        pointerTime: 10.1,
        clipDuration: 2,
        rows: [makeRow('V1', [{ id: 'sib1', start: 8, end: 10 }])],
        pixelSnapThreshold: 20,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(10);
    expect(plan.snapped).toBe(true);
  });
});

// ── 1590s clip: no duration-sized snap window ──────────────────────────

describe('long clip (1590s) — no duration-sized snap window', () => {
  it('does not snap to a far-away edge using clip duration as threshold', () => {
    // A 1590-second clip dragged to pointerTime=1600.
    // snapThresholdS = 100/100 = 1s (explicit, pixel-derived).
    // The only sibling is at 0-10. The nearest edge is 10 (dist=1590).
    // If the planner fell back to clip duration (1590s), it would snap
    // to 10 — but it MUST NOT.
    const plan = planClipDrag(
      defaults({
        pointerTime: 1600,
        clipDuration: 1590,
        rows: [makeRow('V1', [{ id: 'sib1', start: 0, end: 10 }])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(1600);
    expect(plan.snapped).toBe(false);
    expect(plan.snapEdgeType).toBe('none');
    expect(plan.snapThresholdS).toBe(1); // pixelSnapThreshold / pixelsPerSecond
    // snapThresholdS (1) is dramatically smaller than the clip duration (1590),
    // proving no duration-sized fallback is at play
    expect(plan.snapThresholdS).toBe(1);
    expect(plan.snapThresholdS).toBeLessThan(1590);
  });

  it('only snaps when the 1590s clip is within the explicit 1s threshold', () => {
    // 1590s clip, sibling at 100-110, pointerTime=110.2 (dist=0.2 < 1s)
    const plan = planClipDrag(
      defaults({
        pointerTime: 110.2,
        clipDuration: 1590,
        rows: [makeRow('V1', [{ id: 'sib1', start: 100, end: 110 }])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(110);
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('sibling-end');
  });

  it('1590s clip: snap to 0 only when within explicit threshold, not duration', () => {
    // 1590s clip at pointerTime=500. snapThresholdS=1s. distance to 0 = 500 >> 1.
    // Must NOT snap to 0.
    const plan = planClipDrag(
      defaults({
        pointerTime: 500,
        clipDuration: 1590,
        rows: [makeRow('V1', [])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(500);
    expect(plan.snapped).toBe(false);
  });
});

// ── Track collision resolution ─────────────────────────────────────────

describe('track collision resolution', () => {
  it('signals needsNewTrack when the target track is blocked and no free track exists', () => {
    // Two visual tracks, both blocked at the resolved position
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        clipDuration: 2,
        tracks: [
          makeTrack('V1', 'visual'),
          makeTrack('V2', 'visual'),
        ],
        rows: [
          makeRow('V1', [{ id: 'sib1', start: 4, end: 7 }]),
          makeRow('V2', [{ id: 'sib2', start: 4, end: 7 }]),
        ],
        pointerRowIndex: 0,
      }),
    );
    expect(plan.needsNewTrack).toBe(true);
    expect(plan.targetTrackId).toBeNull();
    expect(plan.valid).toBe(true);
  });

  it('moves to nearest free compatible track when target is blocked', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        clipDuration: 2,
        tracks: [
          makeTrack('V1', 'visual'),
          makeTrack('V2', 'visual'),
        ],
        rows: [
          makeRow('V1', [{ id: 'sib1', start: 4, end: 7 }]),
          makeRow('V2', []),
        ],
        pointerRowIndex: 0,
      }),
    );
    expect(plan.needsNewTrack).toBe(false);
    expect(plan.targetTrackId).toBe('V2');
    expect(plan.targetRowIndex).toBe(1);
  });

  it('skips audio tracks when sourceKind is visual', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        clipDuration: 2,
        tracks: [
          makeTrack('V1', 'visual'),
          makeTrack('A1', 'audio'),
          makeTrack('V2', 'visual'),
        ],
        rows: [
          makeRow('V1', [{ id: 'sib1', start: 4, end: 7 }]),
          makeRow('A1', []),
          makeRow('V2', []),
        ],
        pointerRowIndex: 0,
      }),
    );
    // Should skip A1 (audio) and land on V2
    expect(plan.targetTrackId).toBe('V2');
    expect(plan.trackKind).toBe('visual');
  });
});

// ── Kind mismatch handling ─────────────────────────────────────────────

describe('kind mismatch handling', () => {
  it('redirects to nearest compatible track when pointerRow track kind differs', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        sourceKind: 'visual',
        tracks: [
          makeTrack('A1', 'audio'),
          makeTrack('V1', 'visual'),
        ],
        rows: [
          makeRow('A1', []),
          makeRow('V1', []),
        ],
        pointerRowIndex: 0, // hovering over A1 (audio)
      }),
    );
    expect(plan.targetTrackId).toBe('V1');
    expect(plan.requestedTrackId).toBe('A1');
    expect(plan.targetRowIndex).toBe(1);
    expect(plan.trackKind).toBe('visual');
  });

  it('signals needsNewTrack when no track matches sourceKind', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        sourceKind: 'visual',
        tracks: [
          makeTrack('A1', 'audio'),
          makeTrack('A2', 'audio'),
        ],
        rows: [
          makeRow('A1', []),
          makeRow('A2', []),
        ],
        pointerRowIndex: 0,
      }),
    );
    expect(plan.needsNewTrack).toBe(true);
    expect(plan.targetTrackId).toBeNull();
    expect(plan.newTrackPlacement).toBe('bottom');
  });

  it('preserves explicit new-track intent instead of keeping the hovered row authoritative', () => {
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        tracks: [
          makeTrack('A1', 'audio'),
          makeTrack('V1', 'visual'),
        ],
        rows: [
          makeRow('A1', []),
          makeRow('V1', []),
        ],
        pointerRowIndex: -1,
        requestedNewTrackPlacement: 'top',
      }),
    );
    expect(plan.needsNewTrack).toBe(true);
    expect(plan.targetTrackId).toBeNull();
    expect(plan.newTrackPlacement).toBe('top');
  });
});

// ── createInvalidPlan ──────────────────────────────────────────────────

describe('createInvalidPlan', () => {
  it('returns a plan with valid=false and the given reason', () => {
    const plan = createInvalidPlan('no compatible tracks exist', {
      pointerTime: 5,
      pixelSnapThreshold: 100,
      pixelsPerSecond: 100,
      sourceKind: 'visual',
    });
    expect(plan.valid).toBe(false);
    expect(plan.invalidReason).toBe('no compatible tracks exist');
    expect(plan.resolvedStart).toBe(5);
    expect(plan.snapped).toBe(false);
  });

  it('clamps negative pointerTime to 0 for resolvedStart', () => {
    const plan = createInvalidPlan('test', {
      pointerTime: -5,
      pixelSnapThreshold: 100,
      pixelsPerSecond: 100,
      sourceKind: 'visual',
    });
    expect(plan.resolvedStart).toBe(0);
    expect(plan.rejectReason).toBe('test');
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty rows gracefully', () => {
    const plan = planClipDrag(
      defaults({
        tracks: [],
        rows: [],
        pointerRowIndex: 0,
      }),
    );
    expect(plan.valid).toBe(true);
    expect(plan.needsNewTrack).toBe(true);
    expect(plan.targetTrackId).toBeNull();
  });

  it('handles pointerRowIndex out of bounds by clamping', () => {
    const plan = planClipDrag(
      defaults({
        pointerRowIndex: 999,
        rows: [makeRow('V1', [])],
      }),
    );
    expect(plan.targetTrackId).toBe('V1');
    expect(plan.targetRowIndex).toBe(0);
    expect(plan.valid).toBe(true);
  });

  it('returns a rejectReason when track creation is disabled', () => {
    const plan = planClipDrag(
      defaults({
        sourceKind: 'visual',
        tracks: [makeTrack('A1', 'audio')],
        rows: [makeRow('A1', [])],
        allowTrackCreation: false,
      }),
    );
    expect(plan.valid).toBe(false);
    expect(plan.rejectReason).toBe('no compatible track exists');
  });

  it('does not snap to a sibling edge that would cause overlap', () => {
    // sibling at 8-10, clipDuration=3, pointerTime=11 (near sibling-end=10)
    // Snapping to 10 would mean 10..13, which doesn't overlap 8..10? No.
    // Wait: overlap test is candidateTime < a.end && candidateTime + duration > a.start
    // 10 < 10 = false, so no overlap. This is fine.
    //
    // Better case: sibling at 8-10, clipDuration=5, pointerTime=11
    // Snapping to 10 would mean 10..15 — no overlap with 8..10. Still fine.
    //
    // Case that should block: sibling at 5-10, clipDuration=6, pointerTime=5.5
    // Sibling start=5, dist=0.5. Placing at 5 would mean 5..11, overlaps 5..10? Yes.
    // So it should NOT snap to start=5 in this case.
    const plan = planClipDrag(
      defaults({
        pointerTime: 5.5,
        clipDuration: 6,
        rows: [makeRow('V1', [{ id: 'sib1', start: 5, end: 10 }])],
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    // Should not snap to sibling start=5 because it would overlap
    expect(plan.resolvedStart).not.toBe(5);
  });

  it('excludes the dragged clip id from sibling checks', () => {
    // The dragged clip itself is at 3-5. The planner should not consider it a sibling.
    const plan = planClipDrag(
      defaults({
        pointerTime: 4,
        clipId: 'dragged-clip',
        excludeClipIds: new Set(),
        rows: [makeRow('V1', [{ id: 'dragged-clip', start: 3, end: 5 }])],
      }),
    );
    // The dragged clip is excluded, so treated as empty row → snap to 0 within threshold
    // snapThresholdS=1s, pointerTime=4 > 1 → stays at 4
    // No other siblings → no snap
    expect(plan.resolvedStart).toBe(4);
    expect(plan.snapEdgeType).toBe('none');
  });

  it('excludes additional clip ids from sibling checks', () => {
    // excludeClipIds includes extra IDs that should also be excluded
    const plan = planClipDrag(
      defaults({
        pointerTime: 5,
        clipId: 'dragged-clip',
        excludeClipIds: new Set(['other-dragged']),
        rows: [
          makeRow('V1', [
            { id: 'other-dragged', start: 8, end: 10 },
          ]),
        ],
      }),
    );
    // 'other-dragged' is excluded → no siblings → no snap
    expect(plan.resolvedStart).toBe(5);
    expect(plan.snapEdgeType).toBe('none');
  });
});

// ── ADOS-shaped long-clip regression ───────────────────────────────────

describe('ADOS-shaped long-clip (~1590s) regression', () => {
  const VIDEO_MAIN = makeTrack('video_main', 'visual', 'Video Main');
  const LONG_CLIP_DURATION = 1590;
  const INTRO_DURATION = 10;
  const FINAL_DURATION = 8;

  /** Builds the ADOS fixture: intro clip (0–10) + long clip (10–1600) + final clip (1600–1608) on video_main. */
  function adosRows(draggedClipId: string) {
    return [
      makeRow(
        'video_main',
        [
          { id: 'intro-proxy', start: 0, end: INTRO_DURATION },
          { id: draggedClipId, start: INTRO_DURATION, end: INTRO_DURATION + LONG_CLIP_DURATION },
          { id: 'final-proxy', start: INTRO_DURATION + LONG_CLIP_DURATION, end: INTRO_DURATION + LONG_CLIP_DURATION + FINAL_DURATION },
        ],
      ),
    ];
  }

  it('does NOT snap a ~1590s clip to the intro edge when the pointer is outside the explicit threshold', () => {
    // Pointer at 12s, intro ends at 10s. Distance = 2s > snapThresholdS=1s.
    // If a duration-sized fallback (1590s) were used, it would snap — regression guard.
    const plan = planClipDrag(
      defaults({
        pointerTime: 12,
        clipDuration: LONG_CLIP_DURATION,
        clipId: 'panel_video_from_0309_before_spoiler_cut_proxy_2',
        excludeClipIds: new Set(['panel_video_from_0309_before_spoiler_cut_proxy_2']),
        sourceKind: 'visual',
        tracks: [VIDEO_MAIN],
        rows: adosRows('panel_video_from_0309_before_spoiler_cut_proxy_2'),
        pointerRowIndex: 0,
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    // No snap — pointerTime is too far from the intro-end edge (10).
    expect(plan.resolvedStart).toBe(12);
    expect(plan.snapped).toBe(false);
    expect(plan.snapEdgeType).toBe('none');
    // Explicit threshold is tiny compared to clip duration.
    expect(plan.snapThresholdS).toBe(1);
    expect(plan.snapThresholdS).toBeLessThan(LONG_CLIP_DURATION);
  });

  it('snaps a ~1590s clip to the intro end edge only when the pointer is within the explicit threshold', () => {
    // Pointer at 10.5s, intro ends at 10s. Distance = 0.5s < snapThresholdS=1s → snap.
    const plan = planClipDrag(
      defaults({
        pointerTime: 10.5,
        clipDuration: LONG_CLIP_DURATION,
        clipId: 'panel_video_from_0309_before_spoiler_cut_proxy_2',
        excludeClipIds: new Set(['panel_video_from_0309_before_spoiler_cut_proxy_2']),
        sourceKind: 'visual',
        tracks: [VIDEO_MAIN],
        rows: adosRows('panel_video_from_0309_before_spoiler_cut_proxy_2'),
        pointerRowIndex: 0,
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(INTRO_DURATION); // 10
    expect(plan.snapped).toBe(true);
    expect(plan.snapEdgeType).toBe('sibling-end');
    // Explicit threshold = 1s, still dramatically smaller than clip duration.
    expect(plan.snapThresholdS).toBe(1);
  });

  it('does NOT snap a ~1590s clip to the final clip start when pointer is far away', () => {
    // Pointer at 1590s, final clip starts at 1600s. Distance = 10s >> 1s threshold.
    const plan = planClipDrag(
      defaults({
        pointerTime: 1590,
        clipDuration: LONG_CLIP_DURATION,
        clipId: 'panel_video_from_0309_before_spoiler_cut_proxy_2',
        excludeClipIds: new Set(['panel_video_from_0309_before_spoiler_cut_proxy_2']),
        sourceKind: 'visual',
        tracks: [VIDEO_MAIN],
        rows: adosRows('panel_video_from_0309_before_spoiler_cut_proxy_2'),
        pointerRowIndex: 0,
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    // No snap — distance to final (1600 - 1590 = 10) >> threshold (1).
    expect(plan.resolvedStart).toBe(1590);
    expect(plan.snapped).toBe(false);
    expect(plan.snapEdgeType).toBe('none');
  });

  it('resolves target track to video_main and preserves the full plan shape for a ~1590s clip', () => {
    // Placing the 1590s clip at 800 on video_main would overlap both the intro (0-10)
    // and the final (1600-1608), so the planner MUST signal needsNewTrack since there
    // is no other visual track to fall back to.
    const plan = planClipDrag(
      defaults({
        pointerTime: 800,
        clipDuration: LONG_CLIP_DURATION,
        clipId: 'panel_video_from_0309_before_spoiler_cut_proxy_2',
        excludeClipIds: new Set(['panel_video_from_0309_before_spoiler_cut_proxy_2']),
        sourceKind: 'visual',
        tracks: [VIDEO_MAIN],
        rows: adosRows('panel_video_from_0309_before_spoiler_cut_proxy_2'),
        pointerRowIndex: 0,
        pixelSnapThreshold: 100,
        pixelsPerSecond: 100,
      }),
    );
    expect(plan.resolvedStart).toBe(800);
    // The dragged clip [800, 2390] overlaps intro [0,10] and final [1600,1608] on
    // the only visual track, so the planner correctly falls back to a new track.
    expect(plan.needsNewTrack).toBe(true);
    expect(plan.targetTrackId).toBeNull();
    expect(plan.trackKind).toBe('visual');
    expect(plan.valid).toBe(true);
    expect(plan.rejectReason).toBeNull();
  });
});
