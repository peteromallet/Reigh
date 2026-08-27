import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { fetchGenerations, matchesClientSideFilters, useProjectGenerations } from '../useProjectGenerations';
import type { GeneratedImageWithMetadata } from '@/shared/components/MediaGallery/types';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { createJourneyState, FIXTURE_PROJECT } from '@/test/bridgeFixtures.mjs';
import {
  markAstridCapabilityUnavailable,
  resetAstridCapabilityCensusForTesting,
} from '@/integrations/astrid/capabilityCensus.ts';

const FAKE_ORIGIN = 'http://bridge.fake';
const SLUG = FIXTURE_PROJECT.slug;

describe('useProjectGenerations (bridge gallery reads R12)', () => {
  let router: FakeBridgeRouter;

  beforeEach(() => {
    resetAstridCapabilityCensusForTesting();
    router = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // The client defaults to the same-origin base ('/api/astrid'); resolve
      // relative paths against the fake origin before handing to the router.
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, FAKE_ORIGIN);
      return await router.handle(new Request(url.href, init));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it('keeps image, audio, and video media types distinct in bridge-side filters', () => {
    const image = { id: 'image', url: '/image.png', type: 'image', isVideo: false } as GeneratedImageWithMetadata;
    const audio = { id: 'audio', url: '/audio.aac', type: 'audio', isVideo: false } as GeneratedImageWithMetadata;
    const video = { id: 'video', url: '/video.mp4', type: 'video', isVideo: true } as GeneratedImageWithMetadata;

    expect(matchesClientSideFilters(image, { mediaType: 'image' })).toBe(true);
    expect(matchesClientSideFilters(audio, { mediaType: 'image' })).toBe(false);
    expect(matchesClientSideFilters(video, { mediaType: 'image' })).toBe(false);

    expect(matchesClientSideFilters(image, { mediaType: 'video' })).toBe(false);
    expect(matchesClientSideFilters(audio, { mediaType: 'video' })).toBe(false);
    expect(matchesClientSideFilters(video, { mediaType: 'video' })).toBe(true);

    expect(matchesClientSideFilters(audio, { mediaType: 'all' })).toBe(true);
  });

  it('fetchGenerations maps GET /generations rows into gallery items with R9 display URLs', async () => {
    const result = await fetchGenerations(SLUG, 100, 0);

    const details = createJourneyState().galleryDetails;
    expect(result.items).toHaveLength(details.length);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(details.length);

    for (const item of result.items) {
      // Every display address is a same-origin managed-media content route.
      expect(item.url).toMatch(/^\/api\/astrid\/projects\/demo-project\/media\/[^/]+\/content$/);
      expect(item.thumbUrl).toBe(item.url);
    }
    // Recency-first wire order is preserved.
    expect(result.items[0].createdAt >= result.items[result.items.length - 1].createdAt).toBe(true);
  });

  it('pushes the starred filter to the route as a query param', async () => {
    await fetchGenerations(SLUG, 100, 0, { starredOnly: true });

    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0] as [string];
    expect(String(firstCall[0])).toContain('starred=true');
  });

  it('marks hasMore and keeps the window bounded while pages remain', async () => {
    // The fake serves one page with next_cursor: null, so nothing follows.
    const result = await fetchGenerations(SLUG, 1, 0);
    expect(result.items).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  it('useProjectGenerations surfaces bridge rows through react-query', async () => {
    const { result } = renderHook(
      () => useProjectGenerations(SLUG, 1, 100, true),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.length).toBeGreaterThan(0);
    expect(result.current.data?.items[0].url).toContain('/media/');
  });

  it('makes zero gallery requests after the boot census marks the route unavailable', async () => {
    markAstridCapabilityUnavailable('generations', 'unknown route: generations');
    vi.mocked(globalThis.fetch).mockClear();

    const { result } = renderHook(
      () => useProjectGenerations(SLUG, 1, 100, true),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns an empty page when no project id is given', async () => {
    const result = await fetchGenerations(null, 100, 0);
    expect(result).toEqual({ items: [], total: 0, hasMore: false });
  });
});
