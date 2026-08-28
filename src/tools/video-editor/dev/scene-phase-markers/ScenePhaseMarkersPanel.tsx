/**
 * ScenePhaseMarkersPanel — footer slot renderer for the scene-phase-markers
 * extension.
 *
 * Renders a compact strip under the timeline: a marker-count/playhead
 * summary, the Mark (B) action, and the Phase 2 controls that convert
 * markers into shot positions. Two explicit actions: "Create shots from
 * markers" (a checkbox refines it to only markers not already covered by a
 * shot or generation) and "Move existing shots to markers" (align existing
 * clips to marker starts). The full per-marker chip list is gone — markers
 * now live ON the timeline ruler (ScenePhaseMarkersOverlay) and are draggable
 * there. "Clear/Delete Data" is the explicit, user-triggered project-data
 * clear; generic disposal never touches project data.
 *
 * The panel is a render-prop function registered via `ctx.ui`, so it closes
 * over the ExtensionContext (for timeline reads/writes) and receives the
 * host's render context (for the live playhead).
 */

import { useState } from 'react';
import type { ExtensionContext, TimelinePatch, TimelineSnapshot } from '@reigh/editor-sdk';
import {
  buildMarkersPatch,
  createShotsFromMarkers,
  ensureScenePhaseWritable,
  markPhaseAtPlayhead,
  moveExistingShotsToMarkers,
  notifyMarkersChanged,
  readMarkers,
  readTimelineSnapshot,
  setScenePhaseTimelineConflicted,
  visualClips,
  visualTrackIds,
} from './extension';

export interface ScenePhaseMarkersPanelProps {
  ctx: ExtensionContext;
  playback: { currentTime: number };
  /** Host chrome diverged-state (409 conflict unresolved). */
  isConflictExhausted?: boolean;
}

const BUTTON_CLASS = 'rounded border border-border bg-background px-2 py-0.5 text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const SELECT_CLASS = 'rounded border border-border bg-background px-1 py-0.5 text-foreground';
const INPUT_CLASS = 'w-16 rounded border border-border bg-background px-1 py-0.5 text-foreground';
const LABEL_CLASS = 'flex items-center gap-1 text-muted-foreground';

export function ScenePhaseMarkersPanel({ ctx, playback, isConflictExhausted = false }: ScenePhaseMarkersPanelProps) {
  // Playhead for the B-key command is read renderer-independently from the
  // provider-owned `ctx.creative.timelineView` store — no module cache.
  // Keep the module-level conflict flag in sync so the B-key command (which
  // runs outside any render context) is gated by the same signal.
  setScenePhaseTimelineConflicted(isConflictExhausted);

  const extensionId = ctx.extension.id;
  // Hooks must be unconditional (before the snapshot guard) so the component
  // does not change hook count when the timeline transitions not-ready→ready.
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [durationInput, setDurationInput] = useState('');
  // Default ON: the safe, additive mode. On an empty track it behaves exactly
  // like "create at every marker" (nothing is covered), and on a populated
  // track it avoids stacking duplicate shots over existing content. Unchecking
  // forces a shot at every marker regardless of coverage.
  const [createEmptyShots, setCreateEmptyShots] = useState(true);

  const snapshot = readTimelineSnapshot(ctx);
  const markers = snapshot ? readMarkers(snapshot, extensionId) : [];
  if (!snapshot) {
    return (
      <div className="flex h-9 flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border bg-card/60 px-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Scene Markers</span>
        <span>Timeline not ready — markers will appear here once it loads.</span>
      </div>
    );
  }
  const tracks = visualTrackIds(snapshot);
  const clips = visualClips(snapshot);

  const effectiveTrackId = tracks.includes(selectedTrackId) ? selectedTrackId : (tracks[0] ?? 'V1');
  const durationSeconds = Number.parseFloat(durationInput);
  const effectiveDuration = Number.isFinite(durationSeconds) ? durationSeconds : 0;

  function runPatch(patch: TimelinePatch, okMessage: string): boolean {
    try {
      ctx.creative.timeline.apply(patch);
      ctx.chrome.toast(okMessage, 'info');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'scene-phase-markers/panel-error',
        message,
      });
      ctx.chrome.toast(`Scene Phase Markers: ${message}`, 'error');
      return false;
    }
  }

  /**
   * Explicit, user-triggered project-data clear (a write of the empty list).
   *
   * The patch is built from a FRESH snapshot, never the render-time cached
   * one: a receipt-only ack can advance the live base version without
   * touching the data slice, and Clear must not fail CAS validation against
   * a stale version. After a successful clear, notify local subscribers so
   * the overlay drops the old markers immediately (no host re-render).
   */
  function clearMarkers(): void {
    if (!ensureScenePhaseWritable(ctx)) {
      return;
    }
    let fresh: TimelineSnapshot | null = null;
    try {
      fresh = ctx.creative.reader.snapshot();
    } catch {
      fresh = null;
    }
    if (!fresh) {
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'scene-phase-markers/panel-error',
        message: 'Timeline data is not ready — cannot clear markers.',
      });
      ctx.chrome.toast('Scene Phase Markers: timeline not ready — cannot clear.', 'error');
      return;
    }
    if (runPatch(buildMarkersPatch(extensionId, [], fresh.baseVersion), 'Cleared all scene phase markers.')) {
      notifyMarkersChanged();
    }
  }

  /** Create shots from markers: every marker, or only uncovered ones when the checkbox is on. */
  function onCreateShots(): void {
    try {
      createShotsFromMarkers(ctx, {
        trackId: effectiveTrackId,
        durationSeconds: effectiveDuration,
        createEmptyShots,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'scene-phase-markers/create-error',
        message,
      });
      ctx.chrome.toast(`Scene Phase Markers: ${message}`, 'error');
    }
  }

  /** Move existing visual clips so each starts at its marker. */
  function onMoveShots(): void {
    try {
      moveExistingShotsToMarkers(ctx, {
        trackId: effectiveTrackId,
        durationSeconds: effectiveDuration,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'scene-phase-markers/move-error',
        message,
      });
      ctx.chrome.toast(`Scene Phase Markers: ${message}`, 'error');
    }
  }

  return (
    <div className="flex h-9 flex-nowrap items-center gap-x-3 overflow-x-auto whitespace-nowrap border-t border-border bg-card/60 px-3 text-xs">
      <span className="font-semibold text-foreground">Scene Markers</span>
      <span className="tabular-nums text-foreground" data-testid="scene-markers-playhead">
        Playhead {playback.currentTime.toFixed(2)}s
      </span>
      <span
        className="text-muted-foreground"
        data-testid="scene-markers-summary"
      >
        {markers.length === 0
          ? 'No markers — press B at each phase.'
          : `${markers.length} marker${markers.length === 1 ? '' : 's'} — drag them on the ruler.`}
      </span>
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={isConflictExhausted}
        onClick={() => markPhaseAtPlayhead(ctx)}
        data-testid="scene-markers-mark-button"
        title={isConflictExhausted ? 'Resolve the save conflict first.' : undefined}
      >
        Mark (B)
      </button>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <label className={LABEL_CLASS}>
        Track
        <select
          className={SELECT_CLASS}
          value={effectiveTrackId}
          onChange={(event) => setSelectedTrackId(event.target.value)}
        >
          {tracks.map((trackId) => (
            <option key={trackId} value={trackId}>{trackId}</option>
          ))}
        </select>
      </label>

      <label className={LABEL_CLASS}>
        Tail duration
        <input
          type="number"
          min={0.5}
          step={0.5}
          className={INPUT_CLASS}
          value={durationInput}
          placeholder="auto"
          onChange={(event) => setDurationInput(event.target.value)}
        />
      </label>

      <label className={LABEL_CLASS} title="When checked, existing shots count once (generations inside them absorbed) and markers already covered by a shot or generation are skipped — only uncovered markers get a new empty shot. Uncheck to create a shot at every marker regardless of coverage.">
        <input
          type="checkbox"
          checked={createEmptyShots}
          onChange={(event) => setCreateEmptyShots(event.target.checked)}
          className="h-3 w-3 accent-[var(--video-editor-accent-border-strong)]"
          data-testid="scene-markers-create-empty-shots"
        />
        Skip markers already covered
      </label>

      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={isConflictExhausted || markers.length === 0}
        onClick={onCreateShots}
        data-testid="scene-markers-create-shots"
        title={isConflictExhausted
          ? 'Resolve the save conflict first.'
          : createEmptyShots
            ? 'Create an empty shot at each marker not already covered by a shot or generation.'
            : 'Create one shot per marker, each lasting until the next marker.'}
      >
        Create shots from markers
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={isConflictExhausted || markers.length === 0 || clips.length === 0}
        onClick={onMoveShots}
        data-testid="scene-markers-move-shots"
        title={isConflictExhausted
          ? 'Resolve the save conflict first.'
          : 'Move existing visual clips so each starts at its marker, lasting until the next marker.'}
      >
        Move existing shots to markers
      </button>
      {isConflictExhausted && (
        <span className="text-destructive">Save conflict — resolve it before editing markers.</span>
      )}
      {createEmptyShots && markers.length > 0 && (
        <span className="text-muted-foreground">
          Shots count once (generations inside absorbed); uncovered markers get a new empty shot
        </span>
      )}
      {!createEmptyShots && clips.length === 0 && markers.length > 0 && (
        <span className="text-muted-foreground">
          Creates {markers.length} shot{markers.length === 1 ? '' : 's'} at markers
        </span>
      )}

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={isConflictExhausted || markers.length === 0}
        onClick={clearMarkers}
        data-testid="scene-markers-clear"
        title={isConflictExhausted ? 'Resolve the save conflict first.' : 'Explicitly delete all scene-phase marker project data.'}
      >
        Clear/Delete Data
      </button>
    </div>
  );
}
