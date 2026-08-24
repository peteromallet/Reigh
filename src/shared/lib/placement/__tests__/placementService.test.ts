import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';

import {
  batchUpdatePlacementFrames,
  fetchGalleryRows,
  fetchProjectPlacements,
  placeGeneration,
  unplaceGeneration,
} from '../placementService';

const FAKE_ORIGIN = 'http://bridge.fake';

function installRouter(router: FakeBridgeRouter): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = raw.startsWith(FAKE_ORIGIN) ? raw : `${FAKE_ORIGIN}${raw}`;
    return await router.handle(new Request(url, init));
  }));
}

function firstSeededGenerationId(router: FakeBridgeRouter): string {
  const detail = router.state.galleryDetails[0] as { generation_id: string };
  return detail.generation_id;
}

const PROJECT = 'demo-project';
const SHOT = 'shot-e2e-1';

describe('placementService — CAS round-trips over the canonical fake bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('places a completed generation into the document and the placement survives a fresh read', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);
    const generationId = firstSeededGenerationId(router);

    const placed = await placeGeneration({ projectSlug: PROJECT, shotId: SHOT, generationId });
    expect(placed.timelineFrame).toBe(0);

    // Fresh read — what a page load sees after refresh.
    const read = await fetchProjectPlacements(PROJECT);
    const rows = read.byShot.get(SHOT) ?? [];
    expect(rows.map((r) => r.generationId)).toEqual([generationId]);
    expect(rows[0]?.timelineFrame).toBe(0);
    expect(read.config.pinnedShotGroups?.[0]?.shotId).toBe(SHOT);

    // The placed clip is a REAL editor clip on the group track with a registry asset.
    const group = read.config.pinnedShotGroups?.[0];
    const clip = read.config.clips.find((c) => c.id === `clip-${placed.entryId}`);
    expect(clip?.track).toBe(group?.trackId);
    expect(clip?.clipType).toBe('media');
    const asset = read.registry.assets[clip?.asset ?? ''] as { generationId?: string } | undefined;
    expect(asset).toBeDefined();
  });

  it('pooled add keeps membership without a clip; batch update promotes it', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);
    const generationId = firstSeededGenerationId(router);

    const pooled = await placeGeneration({ projectSlug: PROJECT, shotId: SHOT, generationId, timelineFrame: null });
    let read = await fetchProjectPlacements(PROJECT);
    expect(read.config.clips.find((c) => c.id === `clip-${pooled.entryId}`)).toBeUndefined();
    expect(pooled.timelineFrame).toBeNull();

    const [promoted] = await batchUpdatePlacementFrames({
      projectSlug: PROJECT,
      shotId: SHOT,
      updates: [{ entryId: pooled.entryId, timelineFrame: 3 }],
    });
    expect(promoted.timelineFrame).toBe(3);
    read = await fetchProjectPlacements(PROJECT);
    expect(read.config.clips.some((c) => c.source_uuid === pooled.entryId)).toBe(true);
  });

  it('unplacing with keepAsPooled drops the clip but keeps membership', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);
    const generationId = firstSeededGenerationId(router);

    const placed = await placeGeneration({ projectSlug: PROJECT, shotId: SHOT, generationId });
    await unplaceGeneration({
      projectSlug: PROJECT,
      shotId: SHOT,
      entryId: placed.entryId,
      generationId,
      keepAsPooled: true,
    });

    const read = await fetchProjectPlacements(PROJECT);
    expect(read.config.clips.some((c) => c.source_uuid === placed.entryId)).toBe(false);
    expect(read.byShot.get(SHOT)?.[0]?.timelineFrame).toBeNull();
  });

  it('a concurrent writer between load and save engages the CAS retry ladder, not a lost update', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);
    const generationId = firstSeededGenerationId(router);

    const innerFetch = vi.mocked(fetch);
    let saveCalls = 0;
    innerFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : String(input);
      const url = raw.startsWith(FAKE_ORIGIN) ? raw : `${FAKE_ORIGIN}${raw}`;
      if (url.endsWith('/save') && saveCalls === 0) {
        saveCalls += 1;
        // Concurrent writer advanced the head after our load.
        router.state.configVersion += 1;
      }
      return await router.handle(new Request(url, init));
    });

    const placed = await placeGeneration({ projectSlug: PROJECT, shotId: SHOT, generationId });
    expect(placed.entryId).toContain(SHOT);
    expect(saveCalls).toBe(1);
    const read = await fetchProjectPlacements(PROJECT);
    expect(read.byShot.get(SHOT)?.map((r) => r.generationId)).toEqual([generationId]);
  });

  it('gallery rows walk the R12 pages for the merge view', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);
    const rows = await fetchGalleryRows(PROJECT);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.primaryMediaId).toBeTruthy();
  });
});
