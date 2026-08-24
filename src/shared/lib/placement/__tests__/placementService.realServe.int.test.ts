/**
 * C4 [XHARD] evidence (a): the placement CAS merge cycle against the REAL
 * `astrid serve`, not the fake router (doc-24 Q1 / tasklist T4.1).
 *
 * Boot the real bridge, then run:
 *   ASTRID_BRIDGE_URL=http://127.0.0.1:17341 \
 *     npx vitest run src/shared/lib/placement/__tests__/placementService.realServe.int.test.ts
 *
 * Without ASTRID_BRIDGE_URL the suite skips (CI/fake-router coverage lives in
 * documentPlacement.test.ts / placementService.test.ts).
 *
 * Scope honesty: R13 generation resolution (`resolveGenerationAsset`) is part
 * of placeGeneration's precondition and is exercised by the admit→poll
 * journey; this suite proves the CAS MERGE PATH itself — load head → pure
 * document mutation → save(expected_version) → persisted read-back → stale
 * head 409 mapping — using the same documentPlacement primitives the service
 * runs inside its mutateDocument cycle.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AstridLocalClient } from '@/integrations/astrid/client';
import { TimelineVersionConflictError } from '@/sdk/video/timeline/errors';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index';
import {
  placeGenerationInDocument,
  placementEntryId,
  type PlacementDocument,
} from '../documentPlacement';
import {
  batchUpdatePlacementFrames,
  fetchProjectPlacements,
  unplaceGeneration,
} from '../placementService';

const BRIDGE_URL = process.env.ASTRID_BRIDGE_URL;
const PROJECT = 'demo-project';
/** Seeded managed-media ref from real-bridge-serve.mjs (1x1 red JPEG). */
const MEDIA_REF = 'sources/example-image1.jpg';
// Unique per run: the real bridge persists, so reruns must not collide with
// placements a previous run left behind.
const SHOT = `shot-real-serve-${Date.now()}`;
const GEN_A = '11111111-2222-3333-4444-55555555555a';
const GEN_B = '11111111-2222-3333-4444-55555555555b';

describe.skipIf(!BRIDGE_URL)('placement CAS merge vs real astrid serve', () => {
  beforeAll(async () => {
    // AstridLocalClient is same-origin ('/api/astrid') in the browser, where
    // the vite proxy strips that prefix and injects the per-boot request
    // token server-side. Talking to the bridge directly we do both here,
    // reading the token out-of-band exactly like the proxy layer would.
    const base = (BRIDGE_URL ?? '').replace(/\/+$/, '');
    const inner = globalThis.fetch.bind(globalThis);

    let token = '';
    try {
      token = readFileSync(
        process.env.ASTRID_REQUEST_TOKEN_FILE ?? '/tmp/astrid-c4-seed/.astrid/request-token',
        'utf8',
      ).trim();
    } catch {
      token = '';
    }

    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/api/astrid/')) {
        return inner(`${base}${url.slice('/api/astrid'.length)}`, {
          ...init,
          headers: { ...(token ? { 'X-Astrid-Request-Token': token } : {}), ...init?.headers },
        });
      }
      return inner(input as Parameters<typeof inner>[0], init);
    }) as typeof fetch;
  });

  async function withHead(mutate: (document: PlacementDocument) => void): Promise<number> {
    const client = new AstridLocalClient({ projectSlug: PROJECT });
    const timelines = (await client.timelines.list()).timelines ?? [];
    expect(timelines.length).toBeGreaterThan(0);
    const chosen = timelines.find((timeline) => timeline.is_default === true) ?? timelines[0];
    const ref = chosen.slug ?? chosen.timeline_id;

    const payload = await client.timelines.get(ref);
    const document: PlacementDocument = {
      config: payload.config as TimelineConfig,
      registry: (payload.registry ?? { assets: {} }) as AssetRegistry,
    };
    mutate(document);
    const saved = await client.timelines.save(ref, {
      config: document.config,
      registry: document.registry,
      expectedVersion: payload.config_version,
    });
    return typeof saved.config_version === 'number' ? saved.config_version : payload.config_version + 1;
  }

  it('places through a CAS save, reads back after refresh, batch-updates frames, pools on unplace', async () => {
    // Pristine head: no placements yet.
    const pristine = await fetchProjectPlacements(PROJECT);
    expect(pristine.byShot.get(SHOT) ?? []).toEqual([]);

    // Place genA explicitly at frame 5 via one full CAS cycle.
    await withHead((document) =>
      placeGenerationInDocument(document, {
        shotId: SHOT,
        generationId: GEN_A,
        mediaRef: MEDIA_REF,
        timelineFrame: 5,
      }),
    );
    // Pool genB via a second CAS cycle.
    await withHead((document) =>
      placeGenerationInDocument(document, {
        shotId: SHOT,
        generationId: GEN_B,
        mediaRef: MEDIA_REF,
        timelineFrame: null,
      }),
    );

    // Read model derives from PERSISTED bytes (fresh GET, no local cache).
    const afterPlace = await fetchProjectPlacements(PROJECT);
    const entries = afterPlace.byShot.get(SHOT) ?? [];
    expect(entries.map((entry) => entry.generationId)).toEqual([GEN_A, GEN_B]);
    expect(entries[0]).toMatchObject({
      entryId: placementEntryId(SHOT, GEN_A),
      timelineFrame: 5,
    });
    expect(entries[1].timelineFrame).toBeNull();

    // Service-level batch frame update rides the same save route; verify by refresh.
    await batchUpdatePlacementFrames({
      projectSlug: PROJECT,
      shotId: SHOT,
      updates: [
        { entryId: placementEntryId(SHOT, GEN_A), timelineFrame: 12 },
        { entryId: placementEntryId(SHOT, GEN_B), timelineFrame: 3 },
      ],
    });
    const afterBatch = await fetchProjectPlacements(PROJECT);
    const batched = afterBatch.byShot.get(SHOT) ?? [];
    expect(batched.find((entry) => entry.generationId === GEN_A)?.timelineFrame).toBe(12);
    expect(batched.find((entry) => entry.generationId === GEN_B)?.timelineFrame).toBe(3);

    // Unplace pooled membership entirely (keepAsPooled:false removes it).
    await unplaceGeneration({
      projectSlug: PROJECT,
      shotId: SHOT,
      entryId: placementEntryId(SHOT, GEN_B),
      generationId: GEN_B,
      keepAsPooled: false,
    });
    const afterUnplace = await fetchProjectPlacements(PROJECT);
    expect(
      (afterUnplace.byShot.get(SHOT) ?? []).map((entry) => entry.generationId),
    ).toEqual([GEN_A]);
  });

  it('maps a stale expected_version to the canonical conflict error (what the retry ladder catches)', async () => {
    const client = new AstridLocalClient({ projectSlug: PROJECT });
    const timelines = (await client.timelines.list()).timelines ?? [];
    const chosen = timelines.find((timeline) => timeline.is_default === true) ?? timelines[0];
    const ref = chosen.slug ?? chosen.timeline_id;
    const payload = await client.timelines.get(ref);

    // Advance the head behind our back…
    await client.timelines.save(ref, {
      config: payload.config,
      registry: payload.registry,
      expectedVersion: payload.config_version,
    });

    // …then save DIFFERENT content against OUR now-stale head. (Replaying the
    // identical body would be an idempotent replay — same expected_version +
    // digest — not a conflict.) The bridge must answer 409 and the transport
    // must surface it as TimelineVersionConflictError — never a false success.
    const diverged = {
      ...payload.config,
      tracks: [
        ...(payload.config as { tracks?: unknown[] }).tracks ?? [],
        { id: 'ZZ', kind: 'visual', label: 'stale-cas-probe' },
      ],
    };
    await expect(
      client.timelines.save(ref, {
        config: diverged,
        registry: payload.registry,
        expectedVersion: payload.config_version,
      }),
    ).rejects.toBeInstanceOf(TimelineVersionConflictError);
  });
});
