import { describe, expect, it } from 'vitest';

import type { TimelineConfig } from '@/tools/video-editor/types/index';
import {
  batchUpdateFramesInDocument,
  clipIdForEntry,
  placeGenerationInDocument,
  placementEntryId,
  readPlacements,
  removeEntryFromDocument,
} from '../documentPlacement';

function emptyConfig(): TimelineConfig {
  return {
    output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [],
  };
}

function doc() {
  return {
    config: emptyConfig(),
    registry: { assets: {} as Record<string, { file?: string; src?: string; type?: string; duration?: number; generationId?: string }> },
  };
}

const MEDIA = { mediaRef: 'media-1', displaySrc: '/api/astrid/projects/p/media/media-1/content', mimeType: 'image/png' };

describe('documentPlacement — pure document ops', () => {
  it('auto-position places a clip appended after the group and registers the asset', () => {
    const d = doc();
    const first = placeGenerationInDocument(d, { shotId: 'shot-1', generationId: 'gen-a', ...MEDIA });
    const second = placeGenerationInDocument(d, { shotId: 'shot-1', generationId: 'gen-b', ...{ ...MEDIA, mediaRef: 'media-2' } });

    expect(first.timelineFrame).toBe(0);
    // hold 4s @30fps ⇒ frames 0..119 ⇒ next auto frame is 120
    expect(second.timelineFrame).toBe(120);
    expect(d.config.clips).toHaveLength(2);
    expect(d.config.pinnedShotGroups?.[0]?.clipIds).toEqual([
      clipIdForEntry(first.entryId),
      clipIdForEntry(second.entryId),
    ]);
    expect(d.registry.assets['gen:gen-a']?.generationId).toBe('gen-a');
    const placements = readPlacements(d.config, d.registry).get('shot-1');
    expect(placements?.map((p) => p.generationId)).toEqual(['gen-a', 'gen-b']);
  });

  it('pooled placement adds membership without a clip', () => {
    const d = doc();
    const placed = placeGenerationInDocument(d, { shotId: 's', generationId: 'g', ...MEDIA, timelineFrame: null });
    expect(placed.timelineFrame).toBeNull();
    expect(d.config.clips).toHaveLength(0);
    expect(d.config.pinnedShotGroups?.[0]?.poolGenerationIds).toEqual(['g']);
    expect(readPlacements(d.config, d.registry).get('s')?.[0]?.timelineFrame).toBeNull();
  });

  it('explicit frame lands exactly; collisions shift to the next free frame', () => {
    const d = doc();
    placeGenerationInDocument(d, { shotId: 's', generationId: 'a', ...MEDIA, timelineFrame: 5 });
    const collided = placeGenerationInDocument(d, { shotId: 's', generationId: 'b', ...MEDIA, timelineFrame: 5 });
    expect(collided.timelineFrame).toBe(6);
    expect(readPlacements(d.config, d.registry).get('s')?.map((p) => p.timelineFrame)).toEqual([5, 6]);
  });

  it('re-placing the same (shot, generation) replaces rather than duplicates', () => {
    const d = doc();
    placeGenerationInDocument(d, { shotId: 's', generationId: 'a', ...MEDIA, timelineFrame: 0 });
    const replaced = placeGenerationInDocument(d, { shotId: 's', generationId: 'a', ...MEDIA, timelineFrame: 9 });
    expect(replaced.timelineFrame).toBe(9);
    expect(d.config.clips).toHaveLength(1);
    expect(readPlacements(d.config, d.registry).get('s')).toHaveLength(1);
  });

  it('removeEntryFromDocument drops clip and pool slot but keeps the registry asset', () => {
    const d = doc();
    const placed = placeGenerationInDocument(d, { shotId: 's', generationId: 'a', ...MEDIA });
    removeEntryFromDocument(d, placed.entryId);
    expect(d.config.clips).toHaveLength(0);
    expect(d.config.pinnedShotGroups?.[0]?.clipIds).toHaveLength(0);
    expect(d.registry.assets['gen:a']).toBeDefined();
    expect(readPlacements(d.config, d.registry).get('s')).toHaveLength(0);
  });

  it('batch frame updates promote pooled entries and never overwrite a peer frame', () => {
    const d = doc();
    const a = placeGenerationInDocument(d, { shotId: 's', generationId: 'a', ...MEDIA, timelineFrame: null });
    const b = placeGenerationInDocument(d, { shotId: 's', generationId: 'b', ...MEDIA, timelineFrame: 10 });
    const [movedA] = batchUpdateFramesInDocument(d, 's', [
      { entryId: a.entryId, timelineFrame: 10 },
      { entryId: b.entryId, timelineFrame: 2 },
    ]);
    // Collision rule: a requested frame held by a peer shifts to the next
    // free frame — never an overwrite.
    expect(movedA.timelineFrame).toBe(11);
  });

  it('entry ids are deterministic per (shot, generation)', () => {
    expect(placementEntryId('shot-x', 'gen-9')).toBe(placementEntryId('shot-x', 'gen-9'));
  });
});
