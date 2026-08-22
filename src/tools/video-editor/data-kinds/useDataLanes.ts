// [CONVERGE-WITH-M1] Host-side lane pipeline hook (dataKind V2).
// Thin glue only: takes a base TimelineData and the registered-kind snapshot
// records; delegates segment fetching to the single assembly authority
// (`dataLaneAssemblyAuthority.ts` — one shared cache for every co-mounted
// consumer), then re-runs the pure data plane (`assembleDataLanes` +
// `mergeDataLanes`) to produce a patched TimelineData.
//
// Invariants:
// - The store's TimelineData is never written — the patched object is a
//   render-side merge, so lanes stay provably inert to duration/rows/export
//   (Batch 5). Lanes inform, they do not render pixels and never edit.
// - No loader (or no runtime) → the hook returns `base` identity with empty
//   lanes: the lane plane is additive and fails open to "no lanes".
// - Last-write-wins: segment fetches are keyed per (loader source,
//   timelineId) in the authority and shared across mounts; base or kinds
//   changes re-merge with the freshest cached segments instead of refetching.
// - Persisted SOURCE items (`base.sourceItemsBySchemaRef`, V2 bundle plane)
//   join host-fetched transcript segments as inputs to the same assembly.

import { useMemo } from 'react';
import { useOptionalVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import { getClipAssetMediaType } from '@/tools/video-editor/clip-types/runtime.ts';
import {
  loadTranscript,
  type TimelineData,
} from '@/tools/video-editor/lib/timeline-data.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  assembleDataLanes,
  mergeDataLanes,
  type DataKindSnapshotRecord,
} from '@/tools/video-editor/data/typed/assembleDataLanes.ts';
import { useLaneSegments, type LoadDataSegments } from './dataLaneAssemblyAuthority.ts';
import { useDataKindRegistrySnapshot } from './DataKindRegistryContext.tsx';

export type { LoadDataSegments };

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

  // Single assembly authority (L6 #6): fetching is owned by the module store
  // keyed by (loader identity source, timelineId). Co-mounted surfaces —
  // TimelineCanvas AND PropertiesPanel — share one cache and trigger exactly
  // one fetch per asset. The default loader's identity source is the runtime
  // object (stable per editor mount); an explicit loader keys under itself.
  const loaderSource: object | undefined =
    loadSegments !== undefined ? (loadSegments ?? undefined) : (runtime ?? undefined);
  const segmentsByAsset = useLaneSegments({
    loaderSource,
    timelineId: runtime?.timelineId,
    neededAssets,
    loader: effectiveLoader ?? undefined,
  });

  return useMemo(() => {
    if (!base) return null;
    const views = assembleDataLanes({
      kinds: effectiveKinds,
      clips: base.resolvedConfig.clips,
      segmentsByAsset,
      // V2 bundle plane: persisted SOURCE items ride on the base data and
      // feed the same assembly pass as freshly fetched transcript segments.
      sourceItemsBySchemaRef: base.sourceItemsBySchemaRef,
    });
    // Base identity when nothing assembles: no clone churn, empty lanes.
    return views.length > 0 ? mergeDataLanes(base, views) : base;
  }, [base, effectiveKinds, segmentsByAsset]);
}
