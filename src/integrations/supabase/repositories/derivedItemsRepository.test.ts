import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDerivedItemsFromRepository } from './derivedItemsRepository';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { createJourneyState, FIXTURE_PROJECT, fixtureUlid } from '@/test/bridgeFixtures.mjs';
import {
  getProjectSelectionFallbackId,
  resetProjectSelectionStoreForTests,
} from '@/shared/contexts/projectSelectionStore';


vi.mock('@/shared/contexts/projectSelectionStore', async () => {
  const actual = await vi.importActual<typeof projectSelectionStoreModule>(
    '@/shared/contexts/projectSelectionStore',
  );
  return { ...actual, getProjectSelectionFallbackId: vi.fn() };
});
const SLUG = FIXTURE_PROJECT.slug;
const FAKE_ORIGIN = 'http://bridge.fake';

const mockedFallback = vi.mocked(getProjectSelectionFallbackId);

describe('fetchDerivedItemsFromRepository (bridge R13 read)', () => {
  let router: FakeBridgeRouter;

  beforeEach(() => {
    router = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, FAKE_ORIGIN);
      return await router.handle(new Request(url.href, init));
    }));
    mockedFallback.mockReturnValue(SLUG);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetProjectSelectionStoreForTests();
  });

  it('returns empty output when no source generation id is provided', async () => {
    await expect(fetchDerivedItemsFromRepository(null)).resolves.toEqual([]);
    expect(mockedFallback).not.toHaveBeenCalled();
  });

  it('returns empty output when no project slug is selected', async () => {
    mockedFallback.mockReturnValue(null);
    await expect(fetchDerivedItemsFromRepository('gen-1')).resolves.toEqual([]);
  });

  it('maps edit variants into derived items with R9 content-route URLs, recency-sorted', async () => {
    const sourceId = createJourneyState().galleryDetails[0]!.generation_id;
    // Seed one edit variant (non-primary, EDIT type) plus a non-edit variant
    // that must be excluded.
    const detail = router.state.galleryDetails.find((row) => row.generation_id === sourceId)!;
    const mediaId = fixtureUlid('mediaedit');
    router.state.media.set(mediaId, { mime: 'image/png', bytes: new Uint8Array([1]) });
    detail.variants.push({
      id: fixtureUlid('varedit'),
      generation_id: sourceId,
      media_id: mediaId,
      variant_type: 'edit',
      name: 'Edit A',
      params: { prompt: 'edit prompt' },
      is_primary: false,
      starred: false,
      viewed_at: null,
      created_at: '2026-08-22T10:00:00Z',
    });
    detail.variants.push({
      id: fixtureUlid('varorig2'),
      generation_id: sourceId,
      media_id: mediaId,
      variant_type: 'original',
      name: 'Another original',
      params: {},
      is_primary: false,
      starred: false,
      viewed_at: null,
      created_at: '2026-08-22T11:00:00Z',
    });

    const result = await fetchDerivedItemsFromRepository(sourceId);

    // Only the EDIT-typed variant qualifies as a derived item.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      itemType: 'variant',
      variantType: 'edit',
      variantName: 'Edit A',
      prompt: 'edit prompt',
      url: `/api/astrid/projects/${SLUG}/media/${mediaId}/content`,
    });
    expect(result[0]!.thumbUrl).toBe(result[0]!.url);
  });

  it('returns [] when the bridge reports not_found for the generation', async () => {
    await expect(fetchDerivedItemsFromRepository('does-not-exist')).resolves.toEqual([]);
  });

  it('rethrows non-404 bridge failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })));
    await expect(fetchDerivedItemsFromRepository('gen-1')).rejects.toThrow();
  });
});
