// [CONVERGE-WITH-M1] Single assembly authority for the data-lane plane
// (L6 #6). One module-level owner of segment fetches, keyed by
// (loader identity source, timelineId): TimelineCanvas and PropertiesPanel
// both consume `useDataLanes`, which delegates fetching here, so co-mounted
// surfaces trigger exactly ONE fetch per asset — no dual-mount caches.
//
// The store holds only fetched segments. Lane assembly stays per-consumer
// pure compute (`assembleDataLanes` over each consumer's own `base`), so a
// transient base difference between mounts can never leak state across
// surfaces. Cache identity comes from the loader's IDENTITY SOURCE: the
// runtime object for the default loader (stable per editor mount) or the
// explicit loader function itself (stable per test). A different source or
// timelineId gets a fresh cache — a mid-mount resolver swap to another
// runtime refetches under its own key instead of silently mixing caches.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

/** Fetches the transcript segments for one asset (host-injected IO seam). */
export type LoadDataSegments = (
  assetId: string,
) => Promise<readonly TranscriptSegment[] | null | undefined>;

// --- Identity sources ---------------------------------------------------------

const identityIds = new WeakMap<object, number>();
let nextIdentityId = 1;

const identityIdOf = (source: object): string => {
  let id = identityIds.get(source);
  if (id === undefined) {
    id = nextIdentityId;
    nextIdentityId += 1;
    identityIds.set(source, id);
  }
  return String(id);
};

// --- Segment store ------------------------------------------------------------

const EMPTY_SEGMENTS: Readonly<Record<string, readonly TranscriptSegment[]>> =
  Object.freeze({});

interface AuthorityEntry {
  readonly requested: Set<string>;
  segments: Readonly<Record<string, readonly TranscriptSegment[]>>;
  readonly listeners: Set<() => void>;
}

const entries = new Map<string, AuthorityEntry>();

const entryKey = (loaderSource: object, timelineId: string): string =>
  `${identityIdOf(loaderSource)}\u0000${timelineId}`;

const entryFor = (key: string): AuthorityEntry => {
  let entry = entries.get(key);
  if (!entry) {
    entry = { requested: new Set(), segments: EMPTY_SEGMENTS, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
};

const emit = (entry: AuthorityEntry): void => {
  for (const listener of entry.listeners) listener();
};

/**
 * Test seam: drop all cached fetch state. The store is process-global by
 * design (it is what makes co-mounted surfaces share one cache), so tests
 * that reuse a loader identity across cases reset between them.
 */
export const resetLaneAssemblyAuthorityForTests = (): void => {
  entries.clear();
};

export const subscribeLaneSegments = (
  key: string,
  listener: () => void,
): (() => void) => {
  const entry = entryFor(key);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

export const getLaneSegmentsSnapshot = (
  key: string,
): Readonly<Record<string, readonly TranscriptSegment[]>> =>
  entries.get(key)?.segments ?? EMPTY_SEGMENTS;

export const requestLaneSegments = (
  key: string,
  assetIds: readonly string[],
  loader: LoadDataSegments,
): void => {
  const entry = entryFor(key);
  for (const assetId of assetIds) {
    if (entry.requested.has(assetId)) continue;
    entry.requested.add(assetId);
    void Promise.resolve()
      .then(() => loader(assetId))
      .then((segments) => {
        const normalized = segments ?? [];
        if (entry.segments[assetId] === normalized) return;
        entry.segments = { ...entry.segments, [assetId]: normalized };
        emit(entry);
      })
      .catch(() => {
        // A failed fetch contributes no segments; the lane plane stays empty.
        entry.segments = { ...entry.segments, [assetId]: [] };
        emit(entry);
      });
  }
};

// --- React binding ------------------------------------------------------------

/**
 * Subscribe a consumer to the authority's segment snapshot for its
 * (loaderSource, timelineId) key and request any not-yet-requested assets.
 * Returns a referentially stable record that only changes on a fetch write.
 */
export function useLaneSegments(options: {
  loaderSource: object | undefined;
  timelineId: string | undefined;
  neededAssets: readonly string[];
  loader: LoadDataSegments | undefined;
}): Readonly<Record<string, readonly TranscriptSegment[]>> {
  const { loaderSource, timelineId, neededAssets, loader } = options;
  const key = useMemo(
    () => (loaderSource && loader ? entryKey(loaderSource, timelineId ?? '') : null),
    [loaderSource, timelineId, loader],
  );

  const subscribe = useCallback(
    (listener: () => void) => (key ? subscribeLaneSegments(key, listener) : () => undefined),
    [key],
  );
  const getSnapshot = useCallback(
    () => (key ? getLaneSegmentsSnapshot(key) : EMPTY_SEGMENTS),
    [key],
  );
  const segments = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const neededKey = neededAssets.join('\u0000');
  useEffect(() => {
    if (!key || !loader) return;
    requestLaneSegments(key, neededAssets, loader);
    // Re-runs when the authority key or the asset set changes; the
    // requested-set makes it idempotent per asset per key (a loader-fn
    // identity change under the SAME source never refetches — documented V1
    // posture, now enforced by the shared store instead of a per-mount ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, neededKey]);

  return segments;
}
