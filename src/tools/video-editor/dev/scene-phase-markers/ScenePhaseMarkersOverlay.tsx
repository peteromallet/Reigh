/**
 * ScenePhaseMarkersOverlay — `timelineOverlay` renderer for the
 * scene-phase-markers extension.
 *
 * Renders persisted scene markers on the timeline ruler through the
 * host-owned `primitives.markerLayer` primitive (draggable, frame-snapped at
 * commit). Transient drag previews stay local React state and never touch
 * the timeline; only a commit performs a write — exactly one, built from a
 * FRESH snapshot so it carries the current `baseVersion`.
 *
 * The playhead for the B-key command is read renderer-independently from
 * the provider-owned `ctx.creative.timelineView` store, never from preview
 * DOM attributes. Marker-list writes are observed through
 * `subscribeMarkersChanged` so a marker added while paused appears
 * immediately, without waiting for a host re-render.
 */

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type {
  ExtensionContext,
  TimelineMarkerChange,
  TimelineOverlayRenderProps,
  TimelinePointMarker,
} from '@reigh/editor-sdk';
import {
  getMarkersRevision,
  moveMarkerToTime,
  readMarkers,
  readTimelineSnapshot,
  subscribeMarkersChanged,
} from './extension';

export interface ScenePhaseMarkersOverlayProps {
  ctx: ExtensionContext;
  props: TimelineOverlayRenderProps;
}

export function ScenePhaseMarkersOverlay({ ctx, props }: ScenePhaseMarkersOverlayProps) {
  const extensionId = ctx.extension.id;

  // Re-render when the extension's marker list changes (Mark, commit, clear)
  // so markers appear/update without waiting for a host render.
  const subscribeMarkers = useCallback((listener: () => void) => {
    const handle = subscribeMarkersChanged(listener);
    return () => handle.dispose();
  }, []);
  useSyncExternalStore(subscribeMarkers, getMarkersRevision, getMarkersRevision);

  // Fresh read of the persisted marker list on every render. Defensive:
  // while the timeline is not ready the reader throws, so render nothing.
  const snapshot = readTimelineSnapshot(ctx);
  const persistedMarkers = useMemo(
    () => (snapshot ? readMarkers(snapshot, extensionId) : []),
    [snapshot, extensionId],
  );

  // Transient, local-only preview: the marker currently being dragged and
  // its in-progress time. Never persisted; zero writes while previewing.
  const [preview, setPreview] = useState<{ id: string; time: number } | null>(null);

  const handleChange = useCallback((change: TimelineMarkerChange) => {
    if (change.phase === 'preview') {
      setPreview({ id: change.id, time: change.time });
      return;
    }
    // Commit: drop any local preview for this marker, then perform exactly
    // one fresh-snapshot write.
    setPreview((current) => (current && current.id === change.id ? null : current));
    moveMarkerToTime(ctx, change.id, change.time);
  }, [ctx]);

  // Persisted markers with the active local preview merged in (the dragged
  // marker follows the pointer at the layer's imperative cadence; merging
  // keeps React's style reconciliation aligned with the preview position).
  const markers = useMemo<TimelinePointMarker[]>(() => {
    if (!preview) {
      return persistedMarkers;
    }
    return persistedMarkers.map((marker) => (
      marker.id === preview.id ? { ...marker, time: preview.time } : marker
    ));
  }, [persistedMarkers, preview]);

  return props.primitives.markerLayer({
    markers: markers.map((marker, index) => ({
      ...marker,
      label: String(index + 1),
    })),
    placement: 'ruler',
    interactive: true,
    snap: true,
    onChange: handleChange,
  }) as ReactNode;
}
