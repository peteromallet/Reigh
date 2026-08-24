import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveGenerationAsset } from '@/tools/video-editor/data/generationAssetResolver';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { createJourneyState, FIXTURE_PROJECT } from '@/test/bridgeFixtures.mjs';

const FAKE_ORIGIN = 'http://bridge.fake';

describe('resolveGenerationAsset (R13 detail read → R9 content route)', () => {
  let router: FakeBridgeRouter;

  beforeEach(() => {
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

  it('resolves the primary variant to a same-origin R9 content-route address', async () => {
    const detail = createJourneyState().galleryDetails[0];
    const primary = detail.variants.find((variant) => variant.is_primary)!;

    const result = await resolveGenerationAsset({
      generationId: detail.generation_id,
      projectSlug: FIXTURE_PROJECT.slug,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.asset.url).toBe(
      `/api/astrid/projects/${FIXTURE_PROJECT.slug}/media/${primary.media_id}/content`,
    );
    expect(result.asset.thumbnailUrl).toBe(result.asset.url);
    expect(result.asset.entry.url).toBe(result.asset.url);
    expect(result.asset.entry.generationId).toBe(detail.generation_id);
    // R9 addresses are unexpired by construction — no signed-URL expiry.
    expect(result.asset.entry.url_expires_at).toBeUndefined();
  });

  it('reports a missing-asset failure for an unknown generation (404)', async () => {
    const result = await resolveGenerationAsset({
      generationId: '01j8zcex4q7m4sjdy6g6missinggenaa',
      projectSlug: FIXTURE_PROJECT.slug,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingReason).toBe('missing_asset');
    expect(result.diagnostic.code).toBe('generation-not-found');
  });

  it('reports a failure when the generation carries no variant media', async () => {
    const empty = {
      ...router.state.galleryDetails[0],
      generation_id: '01j8zcex4q7m4sjdy6g6nomediagen',
      variants: [],
    };
    router.state.galleryDetails.push(empty);

    const result = await resolveGenerationAsset({
      generationId: empty.generation_id,
      projectSlug: FIXTURE_PROJECT.slug,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('missing-generation-media');
  });
});
