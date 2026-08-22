// [CONVERGE-WITH-M1] Host-side lane pipeline hook (dataKind V1, Batch 6).
// Thin glue only: takes a base TimelineData, the registered-kind snapshot
// records, and a per-asset segment loader; fetches segments for every
// sound-bearing media clip's asset, then re-runs the pure data plane
// (`assembleDataLanes` + `mergeDataLanes`) to produce a patched TimelineData.
//
// Invariants:
// - The store's TimelineData is never written — the patched object is a
//   render-side merge, so lanes stay provably inert to duration/rows/export
//   (Batch 5). Lanes inform, they do not render pixels and never edit.
// - No loader (or no runtime) → the hook returns `base` identity with empty
//   lanes: the lane plane is additive and fails open to "no lanes".
// - Last-write-wins: segment fetches are keyed per asset id and cached for
//   the mount; base or kinds changes re-merge with the freshest cached
//   segments instead of refetching.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import { getClipAssetMediaType } from '@/tools/video-editor/clip-types/runtime.ts';
import {
  loadTranscript,
  type TimelineData,
  type TranscriptSegment,
} from '@/tools/video-editor/lib/timeline-data.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  assembleDataLanes,
  mergeDataLanes,
  type DataKindSnapshotRecord,
} from '@/tools/video-editor/data/typed/assembleDataLanes.ts';
import { useDataKindRegistrySnapshot } from '@/tools/video-editor/data-kinds/DataKindRegistryContext.tsx';

/** Fetches the transcript segments for one asset (host-injected IO seam). */
export type LoadDataSegments = (
  assetId: string,
) => Promise<readonly TranscriptSegment[] | null | undefined>;

export interface UseDataLanesArgs {
  /** Base TimelineData from the timeline store (`null` → `null` out). */
  readonly base: TimelineData | null;
  /**
   * Registered-kind snapshot records. Defaults to the
   * `DataKindRegistryContext` snapshot records; pass explicitly in tests.
   */
  readonly kinds?: readonly DataKindSnapshotRecord[];
  /**
   * Segment loader. `undefined` (omitted) → default loader built from the
   * editor runtime (`loadTranscript` over `runtime.assetResolver`); explicit
   * `null` disables fetching (lanes stay empty → `base` identity).
   */
  readonly loadSegments?: LoadDataSegments | null;
}

/**
 * Assemble duration-neutral data lanes for `base` and return the patched
 * TimelineData (`base` identity when no lanes assemble).
 */
export function useDataLanes({ base, kinds, loadSegments }: UseDataLanesArgs): TimelineData | null {
  const contextRecords = useDataKindRegistrySnapshot().records;
  const effectiveKinds = kinds ?? contextRecords;

  const runtime = useOptionalVideoEditorRuntime();
  const defaultLoader = useMemo<LoadDataSegments | undefined>(() => {
    if (!runtime) return undefined;
    // VideoEditorAssetResolver is the profile source the host wires;
    // loadTranscript only touches its onProfileLoad/loadAssetProfile
    // surface, so the wider DataProvider view is safe here.
    const source = runtime.assetResolver as unknown as DataProvider;
    return (assetId: string) => loadTranscript(source, assetId, runtime.timelineId);
  }, [runtime]);
  const effectiveLoader = loadSegments !== undefined ? loadSegments : defaultLoader;

  // Sound-bearing media clips' distinct assets, in stable order. Lanes attach
  // to evidence on media clips only — the same filter assembleDataLanes
  // applies, hoisted here so we fetch exactly what assembly can map.
  const neededAssets = useMemo(() => {
    if (!base) return [];
    const ids = new Set<string>();
    for (const clip of base.resolvedConfig.clips) {
      if (!clip.asset) continue;
      const media = getClipAssetMediaType(clip);
      if (media !== 'video' && media !== 'audio') continue;
      ids.add(clip.asset);
    }
    return [...ids].sort();
  }, [base]);

  // Per-mount fetch dedupe: `requestedRef` is created per hook mount, so each
  // asset is requested at most once per mount — the cache deliberately does
  // NOT invalidate when `effectiveLoader`'s identity changes (a mid-mount
  // resolver swap never refetches already-requested assets; documented V1
  // posture). Results land in `segmentsByAsset` last-write-wins.
  const requestedRef = useRef<Set<string>>(new Set());
  const [segmentsByAsset, setSegmentsByAsset] = useState<
    Readonly<Record<string, readonly TranscriptSegment[]>>
  >({});

  const neededKey = neededAssets.join('\u0000');
  useEffect(() => {
    if (typeof effectiveLoader !== 'function') return;
    for (const assetId of neededAssets) {
      if (requestedRef.current.has(assetId)) continue;
      requestedRef.current.add(assetId);
      void Promise.resolve()
        .then(() => effectiveLoader(assetId))
        .then((segments) => {
          const normalized = segments ?? [];
          setSegmentsByAsset((prev) => (prev[assetId] === normalized ? prev : { ...prev, [assetId]: normalized }));
        })
        .catch(() => {
          // A failed fetch contributes no segments; the lane plane stays empty.
          setSegmentsByAsset((prev) => ({ ...prev, [assetId]: [] }));
        });
    }
    // Re-runs when the asset set or the loader identity changes; the
    // requested-set ref makes it idempotent per asset per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLoader, neededKey]);

  return useMemo(() => {
    if (!base) return null;
    const views = assembleDataLanes({
      kinds: effectiveKinds,
      clips: base.resolvedConfig.clips,
      segmentsByAsset,
    });
    // Base identity when nothing assembles: no clone churn, empty lanes.
    return views.length > 0 ? mergeDataLanes(base, views) : base;
  }, [base, effectiveKinds, segmentsByAsset]);
}

