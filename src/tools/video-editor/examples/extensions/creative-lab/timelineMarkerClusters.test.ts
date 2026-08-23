import { describe, expect, it } from 'vitest';
import {
  clusterTimelineMarkers,
  getTimelineMarkerClusterEntries,
  moveTimelineMarkerCluster,
} from './timelineMarkerClusters';

interface Cue {
  id: string;
  time: number;
  label: string;
}

describe('Creative Lab timeline marker clusters', () => {
  it('keeps singleton marker identity while summarizing exact-time entries', () => {
    const markers = clusterTimelineMarkers<Cue>([
      { id: 'one', time: 2, label: 'One' },
      { id: 'two', time: 2, label: 'Two' },
      { id: 'three', time: 3, label: 'Three' },
    ], {
      getId: (cue) => cue.id,
      getTime: (cue) => cue.time,
      getLabel: (cue) => cue.label,
    });

    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ id: 'one', time: 2, label: 'One · Two (2 cues)' });
    expect(getTimelineMarkerClusterEntries(markers[0].data)).toEqual([
      { id: 'one', time: 2, label: 'One' },
      { id: 'two', time: 2, label: 'Two' },
    ]);
    expect(markers[1]).toMatchObject({ id: 'three', time: 3, label: 'Three' });
    expect(getTimelineMarkerClusterEntries(markers[1].data)).toEqual([
      { id: 'three', time: 3, label: 'Three' },
    ]);
  });

  it('moves all exact-time entries together and preserves relative equality', () => {
    const result = moveTimelineMarkerCluster([
      { id: 'a', time: 4, label: 'a' },
      { id: 'b', time: 4, label: 'b' },
      { id: 'c', time: 5, label: 'c' },
    ], 'b', 9, {
      getId: (cue) => cue.id,
      getTime: (cue) => cue.time,
      updateTime: (cue, time) => ({ ...cue, time }),
    });
    expect(result.moved).toBe(true);
    expect(result.movedIds).toEqual(['a', 'b']);
    expect(result.entries).toEqual([
      { id: 'a', time: 9, label: 'a' },
      { id: 'b', time: 9, label: 'b' },
      { id: 'c', time: 5, label: 'c' },
    ]);
  });
});
