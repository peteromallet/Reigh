/**
 * Provider compatibility test: AstridBridgeDataProvider (mocked)
 *
 * Exercises the shared providerCompatibility suite against a mocked
 * AstridBridgeDataProvider. The Astrid provider communicates with a local
 * bridge API via fetch; this test mocks that bridge to validate provider
 * contract behavior without a running bridge instance.
 *
 * NOTE: The mock enforces the full CAS contract — save rejects stale
 * expected_version with a 409. The provider participates in CAS and
 * the conflict-retry ladder in useTimelinePersistence handles it.
 */

import { beforeEach, describe, vi } from 'vitest';

vi.mock('@/integrations/supabase/client.ts', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('@/shared/lib/media/localHandleStore.ts', () => ({
  ensurePermission: vi.fn(),
  getDirectoryHandle: vi.fn(),
  saveDirectoryHandle: vi.fn(),
}));

vi.mock('@/tools/video-editor/lib/mediaMetadata.ts', () => ({
  extractAssetRegistryEntry: vi.fn(),
  enrichRegistryEntryWithParsers: vi.fn(),
}));

vi.mock('@/tools/video-editor/data/generationAssetResolver.ts', () => ({
  resolveGenerationAsset: vi.fn(),
}));

import {
  AstridBridgeDataProvider,
} from '@/tools/video-editor/data/AstridBridgeDataProvider';
import {
  runProviderCompatibilitySuite,
  type ProviderFactory,
} from '@/tools/video-editor/testing/providerCompatibility.shared';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index';

// ---------------------------------------------------------------------------
// Stateful mock that simulates the astrid bridge API
// ---------------------------------------------------------------------------

function makePayload(config?: TimelineConfig, configVersion?: number, registry?: AssetRegistry) {
  return {
    timeline_id: '11111111-1111-1111-1111-111111111111',
    timeline_ulid: '01JM4K5N7P0000000000000017',
    slug: 'compat-test',
    config: config ?? {
      output: { resolution: '1920x1080', fps: 30, file: 'timeline.mp4' },
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    },
    config_version: configVersion ?? 1,
    registry: registry ?? { assets: {} },
  };
}

let storedState: {
  config: TimelineConfig;
  configVersion: number;
  registry: AssetRegistry;
} | null = null;

function resetStoredState(seed?: { config?: TimelineConfig; configVersion?: number; registry?: AssetRegistry }) {
  storedState = {
    config: seed?.config ?? ({} as TimelineConfig),
    configVersion: seed?.configVersion ?? 1,
    registry: seed?.registry ?? { assets: {} },
  };
}

/** Timeline IDs that have been seeded (will return data). */
const seededTimelines = new Set<string>();

function createAstridFetchMock() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    // Load timeline (GET — no method or GET)
    if (!init || init.method === undefined || init.method === 'GET') {
      // Extract timeline ID from the URL to check if it's seeded
      const timelineIdFromUrl = url.split('/timelines/')[1]?.split('?')[0];
      if (timelineIdFromUrl && !seededTimelines.has(timelineIdFromUrl) && storedState === null) {
        return new Response(JSON.stringify({
          error: 'timeline_not_found',
          detail: 'timeline missing',
        }), { status: 404 });
      }
      const payload = makePayload(storedState!.config, storedState!.configVersion, storedState!.registry);
      return new Response(JSON.stringify(payload), { status: 200 });
    }

    // Registry PUT — CAS-guarded
    if (url.endsWith('/registry')) {
      const timelineIdFromUrl = url.split('/timelines/')[1]?.split('/registry')[0];
      if (timelineIdFromUrl && !seededTimelines.has(timelineIdFromUrl)) {
        return new Response(JSON.stringify({
          error: 'timeline_not_found',
          detail: 'timeline missing',
        }), { status: 404 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { registry?: AssetRegistry; expected_version?: number };
      if (typeof body.expected_version === 'number' && body.expected_version !== storedState!.configVersion) {
        return new Response(JSON.stringify({
          error: 'timeline_version_conflict',
          detail: `expected_version ${body.expected_version} does not match config_version ${storedState!.configVersion}`,
          config_version: storedState!.configVersion,
        }), { status: 409 });
      }
      storedState!.registry = body.registry ?? body;
      return new Response(JSON.stringify(storedState!.registry), { status: 200 });
    }

    // Save POST — CAS-guarded
    if (url.endsWith('/save')) {
      const timelineIdFromUrl = url.split('/timelines/')[1]?.split('/save')[0];
      if (timelineIdFromUrl && !seededTimelines.has(timelineIdFromUrl)) {
        return new Response(JSON.stringify({
          error: 'timeline_not_found',
          detail: 'timeline missing',
        }), { status: 404 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        config?: TimelineConfig;
        registry?: AssetRegistry;
        expected_version?: number;
      };
      if (typeof body.expected_version === 'number' && body.expected_version !== storedState!.configVersion) {
        return new Response(JSON.stringify({
          error: 'timeline_version_conflict',
          detail: `expected_version ${body.expected_version} does not match config_version ${storedState!.configVersion}`,
          config_version: storedState!.configVersion,
        }), { status: 409 });
      }
      storedState!.config = body.config ?? storedState!.config;
      if (body.registry) {
        storedState!.registry = body.registry;
      }
      storedState!.configVersion = storedState!.configVersion + 1;

      const payload = makePayload(storedState!.config, storedState!.configVersion, storedState!.registry);
      return new Response(JSON.stringify(payload), { status: 200 });
    }

    return new Response(JSON.stringify(makePayload(storedState!.config, storedState!.configVersion, storedState!.registry)), { status: 200 });
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const astridFactory: ProviderFactory = (seed) => {
  resetStoredState(seed);
  seededTimelines.clear();
  if (seed?.timelineId) {
    seededTimelines.add(seed.timelineId);
  }
  // The provider addresses post-load requests through the cached
  // timeline_ulid; the mock bridge must accept that alias like the real one.
  seededTimelines.add('01JM4K5N7P0000000000000017');
  vi.stubGlobal('fetch', createAstridFetchMock());

  return new AstridBridgeDataProvider({
    projectSlug: 'compat-project',
    timelineRef: 'compat-test',
    timelineId: seed?.timelineId ?? '11111111-1111-1111-1111-111111111111',
    apiBaseUrl: '/api/astrid',
    assetBaseUrl: 'http://127.0.0.1:17333',
  });
};

describe('AstridBridgeDataProvider compatibility (mocked)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    storedState = null;
  });

  runProviderCompatibilitySuite(astridFactory, {
    skipCheckpoints: true,
    skipBundles: true, // bridge bundle passthrough lands in V2-B6
    timelineId: '11111111-1111-1111-1111-111111111111',
    skipRegisterAsset: false,
    skipMissingTimelineTests: true,
    derivedOutputOnSave: true,
  });
});
