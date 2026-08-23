import type { TimelinePointMarker } from '@reigh/editor-sdk';

/** The entries represented by one visible marker at an exact timestamp. */
export interface TimelineMarkerCluster<T extends object> {
  readonly entries: readonly T[];
  readonly ids: readonly string[];
}
/** Marker data keeps the original entry fields and adds a cluster summary. */
export type ClusteredTimelineMarkerData<T extends object> = T & {
  readonly cluster?: TimelineMarkerCluster<T>;
};

export interface TimelineMarkerClusterOptions<T extends object> {
  getId: (entry: T) => string;
  getTime: (entry: T) => number;
  getLabel?: (entry: T) => string | undefined;
  getColor?: (entry: T) => string | undefined;
}

/**
 * Collapse exact-time entries into one host marker without discarding data.
 * Singleton entries retain their original id/data/label/color shape.
 */
export function clusterTimelineMarkers<T extends object>(
  entries: readonly T[],
  options: TimelineMarkerClusterOptions<T>,
): readonly TimelinePointMarker<ClusteredTimelineMarkerData<T>>[] {
  const groups = new Map<number, T[]>();
  for (const entry of entries) {
    const group = groups.get(options.getTime(entry));
    if (group) group.push(entry);
    else groups.set(options.getTime(entry), [entry]);
  }

  return [...groups.values()].map((group) => {
    const representative = group[0];
    const labels = [...new Set(
      group
        .map((entry) => options.getLabel?.(entry))
        .filter((label): label is string => Boolean(label)),
    )];
    const data = group.length === 1
      ? representative as ClusteredTimelineMarkerData<T>
      : {
        ...representative,
        cluster: {
          entries: group,
          ids: group.map(options.getId),
        },
      } as ClusteredTimelineMarkerData<T>;
    const label = group.length === 1
      ? options.getLabel?.(representative)
      : `${labels.length > 0 ? labels.join(' · ') : 'Timeline markers'} (${group.length} cues)`;

    return {
      id: options.getId(representative),
      time: options.getTime(representative),
      ...(label ? { label } : {}),
      ...(options.getColor ? { color: options.getColor(representative) } : {}),
      data,
    };
  });
}

/** Return the full underlying entry set represented by a visible marker. */
export function getTimelineMarkerClusterEntries<T extends object>(
  data: ClusteredTimelineMarkerData<T>,
): readonly T[] {
  return data.cluster?.entries ?? [data as T];
}

/**
 * Move every entry sharing the selected entry's exact timestamp. The caller
 * supplies the fresh snapshot entries and its own normalization function.
 */
export function moveTimelineMarkerCluster<T extends object>(
  entries: readonly T[],
  markerId: string,
  nextTime: number,
  options: {
    getId: (entry: T) => string;
    getTime: (entry: T) => number;
    updateTime: (entry: T, time: number) => T;
  },
): { entries: T[]; moved: boolean; movedIds: readonly string[] } {
  const selected = entries.find((entry) => options.getId(entry) === markerId);
  if (!selected) return { entries: [...entries], moved: false, movedIds: [] };

  const selectedTime = options.getTime(selected);
  const movedIds = entries
    .filter((entry) => options.getTime(entry) === selectedTime)
    .map(options.getId);
  const movedIdSet = new Set(movedIds);
  return {
    entries: entries.map((entry) => (
      movedIdSet.has(options.getId(entry)) ? options.updateTime(entry, nextTime) : entry
    )),
    moved: true,
    movedIds,
  };
}
