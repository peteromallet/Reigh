import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getSupabaseClient } from '@/integrations/supabase/client.ts';
import {
  AstridBridgeDataProvider,
  defaultAstridBridgeAssetBaseUrl,
} from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import { uploadAssetWithResolver } from '@/tools/video-editor/data/AssetResolver.ts';
import {
  isTimelineSchemaIncompatibleError,
  isTimelineVersionConflictError,
  TimelineNotFoundError,
  TimelineSchemaIncompatibleError,
  TimelineVersionConflictError,
} from '@/tools/video-editor/data/DataProvider.ts';
import { BridgeContractError } from '@/tools/video-editor/data/bridgeContract.ts';
import { BridgeTransportFailure } from '@/integrations/astrid/transport.ts';
import {
  expectUnsupportedExtensionPersistenceDiagnostics,
} from '@/tools/video-editor/data/conformance/extensionPersistenceConformance';
import {
  TIMELINE_BUNDLE_SCHEMA_VERSION,
  TimelineBundleParseError,
  type TimelineBundleEnvelope,
} from '@/tools/video-editor/data/typed/timelineBundle.ts';
import {
  ensurePermission,
  getDirectoryHandle,
  saveDirectoryHandle,
} from '@/shared/lib/media/localHandleStore.ts';
import { extractAssetRegistryEntry, enrichRegistryEntryWithParsers } from '@/tools/video-editor/lib/mediaMetadata.ts';
import { resolveGenerationAsset } from '@/tools/video-editor/data/generationAssetResolver.ts';
import type { RegisteredParser } from '@/tools/video-editor/lib/assetParserRuntime';
import { hasSearchableMetadata, mergeSearchProviderResults, shouldShowMetadataSearch } from '@/tools/video-editor/lib/assetMetadataUIHelpers';
import type { SearchProviderResultEnvelope } from '@/tools/video-editor/lib/assetMetadataUIHelpers';
import {
  createCompileOnlyOutputFormatRegistry,
  executeCompileOnlyOutputSync,
} from '@/tools/video-editor/runtime/outputFormatRegistry';
import type {
  CompileOnlyOutputFormatEntry,
} from '@/tools/video-editor/runtime/outputFormatRegistry';
import type { OutputFormatContribution, OutputFormatHandler, OutputFormatContext, CompileOnlyOutputResult, TimelineSnapshot, AssetMetadata } from '@reigh/editor-sdk';
import type { ExtensionDiagnostic } from '@reigh/editor-sdk';


const makePayload = () => ({
  timeline_id: '11111111-1111-1111-1111-111111111111',
  timeline_ulid: '01JM4K5N7P0000000000000017',
  slug: 'intro-cut',
  config: {
    clips: [],
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
  },
  registry: {
    assets: {
      'asset-video': { file: 'clips/demo.mp4', type: 'video/mp4', duration: 4 },
      'asset-image': { file: 'stills/cover.png', type: 'image/png' },
    },
  },
});

describe('AstridBridgeDataProvider', () => {
  const originalFetch = globalThis.fetch;
  const originalShowDirectoryPicker = (globalThis as typeof globalThis & {
    showDirectoryPicker?: unknown;
  }).showDirectoryPicker;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(makePayload()), { status: 200 })));
    vi.mocked(getDirectoryHandle).mockResolvedValue(null);
    vi.mocked(saveDirectoryHandle).mockResolvedValue(undefined);
    vi.mocked(ensurePermission).mockResolvedValue('granted');
    vi.mocked(extractAssetRegistryEntry).mockResolvedValue({
      file: 'local-drops/demo.mp4',
      type: 'video/mp4',
      duration: 4,
    });
    vi.mocked(enrichRegistryEntryWithParsers).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    if (originalShowDirectoryPicker === undefined) {
      delete (globalThis as typeof globalThis & { showDirectoryPicker?: unknown }).showDirectoryPicker;
    } else {
      (globalThis as typeof globalThis & { showDirectoryPicker?: unknown }).showDirectoryPicker = originalShowDirectoryPicker;
    }
  });

  function createDirectoryHandleTree() {
    const writable = {
      write: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
    };
    const fileHandle = {
      createWritable: vi.fn(async () => writable),
    };
    const localDropsHandle = {
      kind: 'directory' as const,
      name: 'local-drops',
      queryPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getFileHandle: vi
        .fn()
        .mockRejectedValueOnce(new Error('missing'))
        .mockResolvedValue(fileHandle),
      getDirectoryHandle: vi.fn(),
    };
    const sourcesHandle = {
      kind: 'directory' as const,
      name: 'sources',
      queryPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getFileHandle: vi.fn(),
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'local-drops') {
          return localDropsHandle;
        }
        throw new Error(`unexpected nested directory: ${name}`);
      }),
    };
    const projectRootHandle = {
      kind: 'directory' as const,
      name: 'ados-talks',
      queryPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getFileHandle: vi.fn(async (name: string) => {
        if (name === 'project.json') {
          return {};
        }
        throw new Error(`unexpected root file: ${name}`);
      }),
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === 'sources') {
          return sourcesHandle;
        }
        throw new Error(`unexpected root directory: ${name}`);
      }),
    };

    return { projectRootHandle, sourcesHandle, localDropsHandle, fileHandle, writable };
  }

  function createFileSystemHandleTree(files: Record<string, string | Blob>) {
    const writes: Array<{ path: string; data: BlobPart }> = [];
    const removed: string[] = [];
    const normalize = (path: string) => path.replace(/^\/+/, '').replace(/\/+/g, '/');

    const makeFileHandle = (path: string) => ({
      getFile: vi.fn(async () => {
        const stored = files[normalize(path)];
        if (stored instanceof Blob) {
          return new File([stored], path.split('/').pop() ?? 'file');
        }
        if (typeof stored === 'string') {
          return new File([stored], path.split('/').pop() ?? 'file', { type: 'application/json' });
        }
        throw new Error(`missing file: ${path}`);
      }),
      createWritable: vi.fn(async () => {
        const chunks: BlobPart[] = [];
        return {
          write: vi.fn(async (data: BlobPart) => {
            chunks.push(data);
            writes.push({ path: normalize(path), data });
          }),
          close: vi.fn(async () => {
            files[normalize(path)] = chunks.length === 1 ? chunks[0] : new Blob(chunks);
          }),
          abort: vi.fn(async () => undefined),
        };
      }),
    });

    const makeDirectoryHandle = (path: string): {
      kind: 'directory';
      name: string;
      queryPermission: ReturnType<typeof vi.fn>;
      requestPermission: ReturnType<typeof vi.fn>;
      getFileHandle: ReturnType<typeof vi.fn>;
      getDirectoryHandle: ReturnType<typeof vi.fn>;
      removeEntry: ReturnType<typeof vi.fn>;
    } => ({
      kind: 'directory' as const,
      name: path.split('/').filter(Boolean).pop() ?? 'root',
      queryPermission: vi.fn(async () => 'granted' as const),
      requestPermission: vi.fn(async () => 'granted' as const),
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        const filePath = normalize(path ? `${path}/${name}` : name);
        if (!(filePath in files) && !options?.create) {
          throw new Error(`missing file: ${filePath}`);
        }
        return makeFileHandle(filePath);
      }),
      getDirectoryHandle: vi.fn(async (name: string) => makeDirectoryHandle(normalize(path ? `${path}/${name}` : name))),
      removeEntry: vi.fn(async (name: string) => {
        const entryPath = normalize(path ? `${path}/${name}` : name);
        removed.push(entryPath);
        for (const key of Object.keys(files)) {
          if (key === entryPath || key.startsWith(`${entryPath}/`)) {
            delete files[key];
          }
        }
      }),
    });

    return {
      files,
      writes,
      removed,
      projectRootHandle: makeDirectoryHandle(''),
    };
  }

  it('keeps extension persistence unsupported for M2 and emits normalized diagnostics', () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });
    const diagnostics: ExtensionDiagnostic[] = [];

    expectUnsupportedExtensionPersistenceDiagnostics(provider, diagnostics, 'Astrid bridge');
  });

  it('loads timeline JSON through the api base, defaults configVersion to 1, and fills missing output', async () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      apiBaseUrl: '/api/astrid',
      assetBaseUrl: 'http://127.0.0.1:17333',
    });

    const loaded = await provider.loadTimeline('11111111-1111-1111-1111-111111111111');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(loaded.configVersion).toBe(1);
    expect(loaded.config.output).toEqual(expect.objectContaining({
      resolution: '1280x720',
      fps: 30,
      file: 'output.mp4',
    }));
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('lets shared transport own malformed-response failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{not-json', { status: 200 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });
    await expect(provider.loadTimeline('11111111-1111-1111-1111-111111111111')).rejects.toBeInstanceOf(BridgeContractError);
  });

  it('maps bridge HTTP errors while preserving shared transport timeout failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'timeline_not_found',
      detail: 'missing',
    }), { status: 404 })));
    const missingProvider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });
    await expect(missingProvider.loadTimeline('missing')).rejects.toBeInstanceOf(TimelineNotFoundError);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }));
    const timeoutProvider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });
    await expect(timeoutProvider.loadTimeline('missing')).rejects.toBeInstanceOf(BridgeTransportFailure);
  });

  it('classifies an unreadable non-2xx error body as an HTTP bridge failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{not-json', { status: 502 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });

    await expect(provider.loadTimeline('missing')).rejects.toThrow();
  });

  it('loads the registry once, keeps assetKey and file maps, and resolves direct bridge asset URLs', async () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
      apiBaseUrl: '/api/astrid',
      assetBaseUrl: 'http://127.0.0.1:17333',
    });

    const registry = await provider.loadAssetRegistry('11111111-1111-1111-1111-111111111111');

    expect(registry.assets['asset-video'].file).toBe('clips/demo.mp4');
    await expect(provider.resolveAssetUrl('clips/demo.mp4')).resolves.toBe(
      'http://127.0.0.1:17333/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/assets/asset-video',
    );
    await expect(provider.resolveAssetUrl('https://cdn.example/test.mp4')).resolves.toBe('https://cdn.example/test.mp4');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('resolves media_id-only entries by registry key without UUID heuristics', async () => {
    const mediaId = '08b43be5-58ad-534a-9713-d2e0f68ba151';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: { assets: { source_audio: { media_id: mediaId, type: 'audio/mpeg' } } },
    }), { status: 200 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'runaway-piano-colour-demo',
      timelineRef: 'rhzerepmv7mz8yw5jr0qkjk30b',
      apiBaseUrl: '/api/astrid',
      assetBaseUrl: '/api/astrid',
    });

    await provider.loadAssetRegistry('timeline-id');
    await expect(provider.resolveAssetUrl(mediaId)).resolves.toBe(
      '/api/astrid/projects/runaway-piano-colour-demo/timelines/01JM4K5N7P0000000000000017/assets/source_audio',
    );
    await expect(provider.onResolve({
      file: mediaId,
      assetId: 'source_audio',
      entry: { media_id: mediaId, type: 'audio/mpeg' },
    })).resolves.toBe(
      '/api/astrid/projects/runaway-piano-colour-demo/timelines/01JM4K5N7P0000000000000017/assets/source_audio',
    );
    await expect(provider.resolveAssetUrl('unregistered-media-id')).resolves.toBe('unregistered-media-id');
  });

  it('fails closed when an onResolve media_id is unknown instead of falling back to file', async () => {
    const knownMediaId = 'known-managed-audio';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: {
        assets: {
          stale_file_asset: { file: 'shared/file.wav', type: 'audio/wav' },
          source_audio: { file: 'shared/file.wav', media_id: knownMediaId, type: 'audio/wav' },
        },
      },
    }), { status: 200 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'runaway-piano-colour-demo',
      timelineRef: 'rhzerepmv7mz8yw5jr0qkjk30b',
      assetBaseUrl: '/api/astrid',
    });

    await provider.loadAssetRegistry('timeline-id');
    await expect(provider.onResolve({
      file: 'shared/file.wav',
      assetId: 'source_audio',
      entry: { file: 'shared/file.wav', media_id: 'unknown-managed-audio', type: 'audio/wav' },
    })).rejects.toThrow("Unknown managed media_id 'unknown-managed-audio'");
  });

  it('rejects explicit assetId and media_id mismatches', async () => {
    const mediaId = 'known-managed-audio';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: { assets: { source_audio: { media_id: mediaId, type: 'audio/mpeg' } } },
    }), { status: 200 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'runaway-piano-colour-demo',
      timelineRef: 'rhzerepmv7mz8yw5jr0qkjk30b',
      assetBaseUrl: '/api/astrid',
    });

    await provider.loadAssetRegistry('timeline-id');
    await expect(provider.onResolve({
      file: mediaId,
      assetId: 'wrong_asset',
      entry: { media_id: mediaId, type: 'audio/mpeg' },
    })).rejects.toThrow(
      "Asset identity mismatch: assetId 'wrong_asset' does not own media_id 'known-managed-audio'",
    );
  });

  it('rejects duplicate media_id registry entries deterministically', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: {
        assets: {
          z_asset: { media_id: 'duplicate-media', type: 'audio/mpeg' },
          a_asset: { media_id: 'duplicate-media', type: 'audio/mpeg' },
        },
      },
    }), { status: 200 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
    });

    await expect(provider.loadAssetRegistry('timeline-id')).rejects.toThrow(
      "Asset registry media_id 'duplicate-media' is ambiguous between 'a_asset' and 'z_asset'",
    );
  });

  it('prefers the explicit asset key during onResolve when files overlap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: {
        assets: {
          'asset-a': { file: 'shared/file.mp4', type: 'video/mp4' },
          'asset-b': { file: 'shared/file.mp4', type: 'video/mp4' },
        },
      },
    }), { status: 200 })));

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
      assetBaseUrl: 'http://127.0.0.1:17333',
    });

    await provider.loadAssetRegistry('11111111-1111-1111-1111-111111111111');

    await expect(provider.onResolve({
      file: 'shared/file.mp4',
      assetId: 'asset-b',
    })).resolves.toBe(
      'http://127.0.0.1:17333/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/assets/asset-b',
    );
  });

  it('prefers media_id over a stale file locator during onResolve', async () => {
    const mediaId = 'managed-audio-id';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...makePayload(),
      registry: {
        assets: {
          stale_file_asset: { file: 'shared/file.wav', type: 'audio/wav' },
          source_audio: { file: 'shared/file.wav', media_id: mediaId, type: 'audio/wav' },
        },
      },
    }), { status: 200 })));

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'runaway-piano-colour-demo',
      timelineRef: 'rhzerepmv7mz8yw5jr0qkjk30b',
      assetBaseUrl: '/api/astrid',
    });

    await provider.loadAssetRegistry('timeline-id');
    await expect(provider.onResolve({
      file: 'shared/file.wav',
      entry: { file: 'shared/file.wav', media_id: mediaId, type: 'audio/wav' },
    })).resolves.toBe(
      '/api/astrid/projects/runaway-piano-colour-demo/timelines/01JM4K5N7P0000000000000017/assets/source_audio',
    );
  });

  it('sends config, registry, and expected_version in a single save POST and refreshes cached assets from the bridge payload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify(makePayload()), { status: 200 });
      }
      if (url.endsWith('/save')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({
          config: {
            clips: [],
            tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
          },
          registry: {
            assets: {
              'asset-save': { file: 'clips/saved.mp4', type: 'video/mp4', duration: 8 },
            },
          },
          expected_version: 999,
        }));
        return new Response(JSON.stringify({
          ...makePayload(),
          config: {
            output: { resolution: '1280x720', fps: 30, file: 'saved-output.mp4' },
            clips: [],
            tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
          },
          config_version: 7,
          registry: {
            assets: {
              'asset-save': { file: 'clips/saved.mp4', type: 'video/mp4', duration: 8 },
            },
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    const nextVersion = await provider.saveTimeline('11111111-1111-1111-1111-111111111111', {
      output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    }, 999, {
      assets: {
        'asset-save': { file: 'clips/saved.mp4', type: 'video/mp4', duration: 8 },
      },
    });

    expect(nextVersion).toBe(7);
    // The pre-save GET used the caller's UUID key (ULID not yet known); the
    // POST is addressed by the cached timeline_ulid, which the bridge resolves
    // without a project-wide identity scan.
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111',
      '/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/save',
    ]);
    await expect(provider.resolveAssetUrl('clips/saved.mp4')).resolves.toBe(
      '/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/assets/asset-save',
    );
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('accepts a ULID/slug caller key when the payload carries a distinct canonical timeline_id', async () => {
    // Real Astrid timelines live under a ULID directory (01JM4K5N7P...)
    // while the bridge reports a canonical UUID as `timeline_id`. The
    // identity guard must compare canonical ids, not the caller's address
    // key — otherwise every load/save round trip throws "timeline mismatch"
    // after the POST has already persisted, wedging the save pipeline.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url.endsWith('/timelines/11111111-1111-1111-1111-111111111111')
        || url.endsWith('/timelines/01JM4K5N7P0000000000000017')
      ) {
        return new Response(JSON.stringify(makePayload()), { status: 200 });
      }
      if (url.endsWith('/save')) {
        return new Response(JSON.stringify({
          ...makePayload(),
          config_version: 5,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    // Load through the ULID key: canonical becomes 11111111-...
    await provider.loadTimeline('01JM4K5N7P0000000000000017');

    // Save through the same ULID key must NOT throw a mismatch.
    const nextVersion = await provider.saveTimeline('01JM4K5N7P0000000000000017', {
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    }, 4);

    expect(nextVersion).toBe(5);
    // The save reuses the cached payload (no pre-save GET) and POSTs to the
    // cached ULID ref — the bridge resolves it without a project-wide scan.
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017',
      '/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/save',
    ]);
  });

  it('fails the whole save when the save endpoint returns an error', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify(makePayload()), { status: 200 });
      }
      if (url.endsWith('/save')) {
        return new Response(JSON.stringify({
          error: 'invalid_registry',
          detail: 'registry body must contain an assets object',
        }), { status: 400 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(provider.saveTimeline('11111111-1111-1111-1111-111111111111', {
      output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    }, 1)).rejects.toThrow('Astrid bridge save timeline failed: registry body must contain an assets object');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps missing timelines to TimelineNotFoundError during save', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify(makePayload()), { status: 200 });
      }
      if (url.endsWith('/save')) {
        return new Response(JSON.stringify({
          error: 'timeline_not_found',
          detail: 'timeline missing',
        }), { status: 404 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    }));

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(provider.saveTimeline('11111111-1111-1111-1111-111111111111', {
      output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
      clips: [],
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    }, 1)).rejects.toBeInstanceOf(TimelineNotFoundError);
  });

  it('keeps checkpoint APIs reachable with local no-op behavior', async () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(provider.saveCheckpoint('11111111-1111-1111-1111-111111111111', {
      timelineId: '11111111-1111-1111-1111-111111111111',
      config: {
        output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
        clips: [],
        tracks: [],
      },
      createdAt: '2026-06-11T10:00:00.000Z',
      triggerType: 'manual',
      label: 'Manual checkpoint',
      editsSinceLastCheckpoint: 3,
    })).resolves.toContain('11111111-1111-1111-1111-111111111111-checkpoint-local-');
    await expect(provider.loadCheckpoints('11111111-1111-1111-1111-111111111111')).resolves.toEqual([]);
  });

  it('registerAsset rides the combined save POST with the merged registry (B5: no PUT /registry)', async () => {
    // The mock mirrors the real server: each successful save appends one
    // config event, so the reported config_version advances.
    let currentVersion = 1;
    const baseAssets = {
      'asset-video': { file: 'clips/demo.mp4', type: 'video/mp4', duration: 4 },
      'asset-image': { file: 'stills/cover.png', type: 'image/png' },
      'asset-audio': { file: 'audio/voice.wav', type: 'audio/wav', duration: 2.5 },
    };
    const saveBodies: Array<{ config: unknown; registry: unknown; expected_version: number }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify({ ...makePayload(), config_version: currentVersion }), { status: 200 });
      }
      if (url.endsWith('/save')) {
        expect(init?.method).toBe('POST');
        saveBodies.push(JSON.parse(String(init?.body)));
        expect(saveBodies[saveBodies.length - 1].registry).toEqual({ assets: baseAssets });
        currentVersion += 1;
        return new Response(JSON.stringify({ ...makePayload(), registry: { assets: baseAssets }, config_version: currentVersion }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await provider.registerAsset('11111111-1111-1111-1111-111111111111', 'asset-audio', {
      file: 'audio/voice.wav',
      type: 'audio/wav',
      duration: 2.5,
    });
    // Second registration must send the ADVANCED version (2), not the stale 1 —
    // a stale version would 409 on the real server.
    await provider.registerAsset('11111111-1111-1111-1111-111111111111', 'asset-audio', {
      file: 'audio/voice.wav',
      type: 'audio/wav',
      duration: 2.5,
    });

    // GET (1) + POST (2); the second registerAsset reuses the cached payload,
    // so the cached config_version bump is what advances the CAS version.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(saveBodies.map((b) => b.expected_version)).toEqual([1, 2]);
    expect(saveBodies.every((b) => 'config' in b)).toBe(true);
    await expect(provider.resolveAssetUrl('audio/voice.wav')).resolves.toBe(
      '/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/assets/asset-audio',
    );
  });

  it('saveTimeline calls the save endpoint with config, registry, and expected_version in a single POST', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify({
          ...makePayload(),
          config_version: 5,
        }), { status: 200 });
      }
      if (url.endsWith('/save')) {
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({
          config: { clips: [], tracks: [] },
          registry: makePayload().registry,
          expected_version: 1,
        }));
        return new Response(JSON.stringify({
          ...makePayload(),
          config_version: 12,
          config: { output: {}, clips: [], tracks: [] },
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    const version = await provider.saveTimeline(
      '11111111-1111-1111-1111-111111111111',
      { output: {}, clips: [], tracks: [] },
      1,
    );

    expect(version).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('does not throw TimelineVersionConflictError for stale expectedVersion when bridge ignores CAS', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/11111111-1111-1111-1111-111111111111')) {
        return new Response(JSON.stringify(makePayload()), { status: 200 });
      }
      if (url.endsWith('/save')) {
        return new Response(JSON.stringify({
          ...makePayload(),
          config_version: 42,
        }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    // Stale expectedVersion (99999) must not throw TimelineVersionConflictError
    const version = await provider.saveTimeline(
      '11111111-1111-1111-1111-111111111111',
      { output: {}, clips: [], tracks: [] },
      99999,
    );

    expect(version).toBe(42);
  });

  it('writes local drops under sources/local-drops, registers them, and reuses the persisted project handle', async () => {
    const handleTree = createDirectoryHandleTree();
    vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

    const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
      .mockResolvedValue(undefined);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    const result = await provider.uploadAsset(new File(['video'], 'demo.mp4', { type: 'video/mp4' }), {
      timelineId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
    });

    expect(ensurePermission).toHaveBeenCalledWith(handleTree.projectRootHandle, 'readwrite');
    expect(handleTree.projectRootHandle.getFileHandle).toHaveBeenCalledWith('project.json');
    expect(handleTree.projectRootHandle.getDirectoryHandle).toHaveBeenCalledWith('sources');
    expect(handleTree.sourcesHandle.getDirectoryHandle).toHaveBeenCalledWith('local-drops', { create: true });
    expect(handleTree.localDropsHandle.getFileHandle).toHaveBeenNthCalledWith(1, 'demo.mp4');
    expect(handleTree.localDropsHandle.getFileHandle).toHaveBeenNthCalledWith(2, 'demo.mp4', { create: true });
    expect(handleTree.writable.write).toHaveBeenCalledTimes(1);
    expect(handleTree.writable.close).toHaveBeenCalledTimes(1);
    expect(extractAssetRegistryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'demo.mp4', type: 'video/mp4' }),
      'local-drops/demo.mp4',
    );
    expect(registerAssetSpy).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      expect.any(String),
      {
        file: 'local-drops/demo.mp4',
        type: 'video/mp4',
        duration: 4,
      },
    );
    expect(result).toEqual({
      assetId: expect.any(String),
      entry: {
        file: 'local-drops/demo.mp4',
        type: 'video/mp4',
        duration: 4,
      },
    });
  });

  it('routes resolver uploads through the real provider uploadAsset/FSA/bridge path', async () => {
    const handleTree = createDirectoryHandleTree();
    vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    const result = await uploadAssetWithResolver(provider, {
      file: new File(['video'], 'resolver-upload.mp4', { type: 'video/mp4' }),
      options: {
        timelineId: '11111111-1111-1111-1111-111111111111',
        userId: 'user-1',
      },
    });

    expect(result.assetId).toEqual(expect.any(String));
    expect(handleTree.localDropsHandle.getFileHandle).toHaveBeenCalledWith(
      'resolver-upload.mp4',
      { create: true },
    );
    expect(handleTree.writable.write).toHaveBeenCalledTimes(1);
    expect(getSupabaseClient).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/projects/ados-talks/timelines/'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('prompts for an Astrid project root when no persisted handle exists', async () => {
    const handleTree = createDirectoryHandleTree();
    const showDirectoryPicker = vi.fn(async () => handleTree.projectRootHandle);
    vi.stubGlobal('showDirectoryPicker', showDirectoryPicker);

    const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
      .mockResolvedValue(undefined);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await provider.uploadAsset(new File(['image'], 'cover.png', { type: 'image/png' }), {
      timelineId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
    });

    expect(showDirectoryPicker).toHaveBeenCalledTimes(1);
    expect(saveDirectoryHandle).toHaveBeenCalledWith('astrid-project-root:ados-talks', handleTree.projectRootHandle);
    expect(registerAssetSpy).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported browsers when File System Access is unavailable', async () => {
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(provider.uploadAsset(new File(['x'], 'demo.txt'), {
      timelineId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
    })).rejects.toThrow('Local asset drop requires a browser with File System Access support');
  });

  it('throws and does not mutate the registry, disk, or timeline when directory permission is denied', async () => {
    const handleTree = createDirectoryHandleTree();
    vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);
    vi.mocked(ensurePermission).mockResolvedValue('denied');

    const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
      .mockResolvedValue(undefined);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    await expect(provider.uploadAsset(new File(['video'], 'demo.mp4', { type: 'video/mp4' }), {
      timelineId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
    })).rejects.toThrow('Astrid local asset drop requires read/write access to the selected project folder');

    expect(ensurePermission).toHaveBeenCalledWith(handleTree.projectRootHandle, 'readwrite');
    expect(registerAssetSpy).not.toHaveBeenCalled();
    expect(handleTree.writable.write).not.toHaveBeenCalled();
    expect(handleTree.writable.close).not.toHaveBeenCalled();
  });

  it('produces a registry entry with a sources-relative file path and verifies the entry shape after uploadAsset', async () => {
    const handleTree = createDirectoryHandleTree();
    vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);
    vi.mocked(extractAssetRegistryEntry).mockResolvedValue({
      file: 'local-drops/voice.wav',
      type: 'audio/wav',
      duration: 2.5,
    });

    const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
      .mockResolvedValue(undefined);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: '11111111-1111-1111-1111-111111111111',
    });

    const result = await provider.uploadAsset(new File(['audio'], 'voice.wav', { type: 'audio/wav' }), {
      timelineId: '11111111-1111-1111-1111-111111111111',
      userId: 'user-1',
    });

    // Registry entry shape verification
    expect(result.entry).toEqual({
      file: 'local-drops/voice.wav',
      type: 'audio/wav',
      duration: 2.5,
    });
    expect(result.entry.file).toMatch(/^local-drops\//);
    expect(result.assetId).toEqual(expect.any(String));
    expect(result.assetId.length).toBeGreaterThan(0);

    // registerAsset is called with the sources-relative path
    expect(registerAssetSpy).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      expect.any(String),
      expect.objectContaining({
        file: 'local-drops/voice.wav',
      }),
    );
  });

  it('treats the bridge GET as authoritative while using FSA only to resolve asset bytes', async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: {
          'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' },
        },
      }),
      'sources/clips/demo.mp4': new Blob(['video-bytes'], { type: 'video/mp4' }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
    const createObjectUrl = vi.fn(() => 'blob:local-demo');
    URL.createObjectURL = createObjectUrl;

    try {
      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: '01JM4K5N7P0000000000000017',
        timelineId: '01JM4K5N7P0000000000000017',
      });

      const loaded = await provider.loadTimeline('01JM4K5N7P0000000000000017');
      const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');

      expect(loaded.config.clips).toEqual([]);
      expect(loaded.config.tracks).toEqual([{ id: 'V1', kind: 'visual', label: 'V1' }]);
      expect(registry.assets['asset-video'].file).toBe('clips/demo.mp4');
      await expect(provider.resolveAssetUrl('clips/demo.mp4')).resolves.toBe('blob:local-demo');
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/assembly.json']))).toEqual({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      });
      expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual({
        assets: {
          'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' },
        },
      });
      expect(localTree.writes).toEqual([]);
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
    }
  });

  it('materializes bridge generation assets into FSA bytes without writing assembly or registry documents', async () => {
    const bridgeRegistry = {
      assets: {
        'asset-generation': {
          file: '',
          type: 'video/mp4',
          generationId: 'gen-1',
          origin: 'refreshable-from-generation',
        },
      },
    };
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
      }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
    vi.mocked(resolveGenerationAsset).mockResolvedValue({
      ok: true,
      asset: {
        entry: {
          file: '',
          type: 'video/mp4',
          generationId: 'gen-1',
          origin: 'refreshable-from-generation',
          url: 'https://storage.example/object/sign/generation-media/gen-1/demo.mp4?token=abc',
        },
        generationId: 'gen-1',
        url: 'https://storage.example/object/sign/generation-media/gen-1/demo.mp4?token=abc',
        mediaType: 'video',
        mimeType: 'video/mp4',
        refreshed: false,
        storage: null,
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')) {
        return new Response(JSON.stringify({ ...makePayload(), registry: bridgeRegistry }), { status: 200 });
      }
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('downloaded-video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');

    expect(registry.assets['asset-generation']).toEqual(expect.objectContaining({
      file: 'assets/demo.mp4',
      generationId: 'gen-1',
      url: 'https://storage.example/object/sign/generation-media/gen-1/demo.mp4?token=abc',
    }));
    expect((localTree.files['sources/assets/demo.mp4'] as Blob).size).toBeGreaterThan(0);
    expect(localTree.writes.map((write) => write.path)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sources\/assets\/\.incoming\/.+\/demo\.mp4$/),
      'sources/assets/demo.mp4',
    ]));
    expect(localTree.writes.map((write) => write.path).some((path) => path.includes('assembly.json') || path.includes('registry.json'))).toBe(false);
    expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual({
      assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provider.getMaterializationSummary().states['asset-generation']).toEqual({
      state: 'materialized',
      file: 'assets/demo.mp4',
    });
  });

  it('keeps failed generation materialization out of the persisted registry and records a diagnostic', async () => {
    const originalRegistry = {
      assets: {
        'asset-generation': {
          file: '',
          type: 'video/mp4',
          generationId: 'gen-1',
          origin: 'refreshable-from-generation',
        },
      },
    };
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
      }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
    vi.mocked(resolveGenerationAsset).mockResolvedValue({
      ok: false,
      missingReason: 'unresolvable_asset',
      diagnostic: {
        code: 'refresh-required',
        message: 'bucket/path cannot be derived',
        generationId: 'gen-1',
        assetId: 'asset-generation',
      },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')) {
        return new Response(JSON.stringify({ ...makePayload(), registry: originalRegistry }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');

    expect(registry.assets['asset-generation']).toEqual(originalRegistry.assets['asset-generation']);
    expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual({
      assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
    });
    expect(localTree.writes).toEqual([]);
    expect(provider.getMaterializationSummary().states['asset-generation']).toEqual({
      state: 'skipped-with-diagnostic',
      diagnostic: {
        assetId: 'asset-generation',
        generationId: 'gen-1',
        reason: 'unresolvable',
        message: 'bucket/path cannot be derived',
      },
    });
  });

  it('materializes resolvable assets, preserves failed entries, and surfaces diagnostics in one local registry pass', async () => {
    const originalRegistry = {
      assets: {
        'asset-success': {
          file: '',
          type: 'video/mp4',
          generationId: 'gen-success',
          origin: 'refreshable-from-generation',
        },
        'asset-failure': {
          file: '',
          type: 'image/png',
          generationId: 'gen-failure',
          origin: 'refreshable-from-generation',
        },
      },
    };
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
      }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
    vi.mocked(resolveGenerationAsset).mockImplementation(async ({ assetId }) => {
      if (assetId === 'asset-success') {
        return {
          ok: true,
          asset: {
            entry: {
              file: '',
              type: 'video/mp4',
              generationId: 'gen-success',
              origin: 'refreshable-from-generation',
              url: 'https://storage.example/object/sign/generation-media/gen-success/demo.mp4?token=abc',
            },
            generationId: 'gen-success',
            url: 'https://storage.example/object/sign/generation-media/gen-success/demo.mp4?token=abc',
            mediaType: 'video',
            mimeType: 'video/mp4',
            refreshed: false,
            storage: null,
          },
        };
      }

      return {
        ok: false,
        missingReason: 'unresolvable_asset',
        diagnostic: {
          code: 'refresh-required',
          message: 'signed URL can no longer be re-minted',
          generationId: 'gen-failure',
          assetId: 'asset-failure',
        },
      };
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')) {
        return new Response(JSON.stringify({ ...makePayload(), registry: originalRegistry }), { status: 200 });
      }
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('downloaded-video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');
    const summary = provider.getMaterializationSummary();

    expect(registry.assets['asset-success']).toEqual(expect.objectContaining({
      file: 'assets/demo.mp4',
      generationId: 'gen-success',
    }));
    expect(registry.assets['asset-failure']).toEqual(originalRegistry.assets['asset-failure']);
    expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual({
      assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
    });
    expect(localTree.writes.map((write) => write.path).some((path) => path.includes('assembly.json') || path.includes('registry.json'))).toBe(false);
    expect((localTree.files['sources/assets/demo.mp4'] as Blob).size).toBeGreaterThan(0);
    expect(localTree.files['sources/assets/failure.png']).toBeUndefined();
    expect(summary.states['asset-success']).toEqual({
      state: 'materialized',
      file: 'assets/demo.mp4',
    });
    expect(summary.states['asset-failure']).toEqual({
      state: 'skipped-with-diagnostic',
      diagnostic: {
        assetId: 'asset-failure',
        generationId: 'gen-failure',
        reason: 'unresolvable',
        message: 'signed URL can no longer be re-minted',
      },
    });
    expect(summary.diagnostics).toEqual([
      {
        assetId: 'asset-failure',
        generationId: 'gen-failure',
        reason: 'unresolvable',
        message: 'signed URL can no longer be re-minted',
      },
    ]);
  });

  it('does not automatically retry skipped assets on bridge save and materializes newly attempted bytes', async () => {
    const bridgeRegistry = {
      assets: {
        'asset-skipped': {
          file: '',
          type: 'video/mp4',
          generationId: 'gen-skipped',
          origin: 'refreshable-from-generation',
        },
      },
    };
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [{ id: 'stale-local-clip' }],
        tracks: [{ id: 'STALE', kind: 'visual', label: 'stale' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
      }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
    const resolveGenerationAssetMock = vi.mocked(resolveGenerationAsset);
    resolveGenerationAssetMock.mockImplementation(async ({ assetId }) => {
      if (assetId === 'asset-skipped') {
        return {
          ok: false,
          missingReason: 'unresolvable_asset',
          diagnostic: {
            code: 'refresh-required',
            message: 'gen-skipped still cannot be refreshed',
            generationId: 'gen-skipped',
            assetId: 'asset-skipped',
          },
        };
      }

      if (assetId === 'asset-new') {
        return {
          ok: true,
          asset: {
            entry: {
              file: '',
              type: 'audio/wav',
              generationId: 'gen-new',
              origin: 'refreshable-from-generation',
              url: 'https://storage.example/object/sign/generation-media/gen-new/new.wav?token=abc',
            },
            generationId: 'gen-new',
            url: 'https://storage.example/object/sign/generation-media/gen-new/new.wav?token=abc',
            mediaType: 'audio',
            mimeType: 'audio/wav',
            refreshed: false,
            storage: null,
          },
        };
      }

      throw new Error(`Unexpected assetId: ${assetId}`);
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017')) {
        return new Response(JSON.stringify({ ...makePayload(), config_version: 1, registry: bridgeRegistry }), { status: 200 });
      }
      if (url.endsWith('/save')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body.expected_version).toBe(1);
        expect(body.registry.assets['asset-skipped']).toEqual(bridgeRegistry.assets['asset-skipped']);
        expect(body.registry.assets['asset-new']).toEqual(expect.objectContaining({ file: 'assets/new.wav' }));
        return new Response(JSON.stringify({ ...makePayload(), config_version: 2, registry: body.registry }), { status: 200 });
      }
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('new-audio', {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');
    expect(provider.getMaterializationSummary().states['asset-skipped']).toEqual({
      state: 'skipped-with-diagnostic',
      diagnostic: {
        assetId: 'asset-skipped',
        generationId: 'gen-skipped',
        reason: 'unresolvable',
        message: 'gen-skipped still cannot be refreshed',
      },
    });
    resolveGenerationAssetMock.mockClear();

    const version = await provider.saveTimeline(
      '01JM4K5N7P0000000000000017',
      {
        output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      },
      1,
      {
        assets: {
          'asset-skipped': {
            file: '',
            type: 'video/mp4',
            generationId: 'gen-skipped',
            origin: 'refreshable-from-generation',
          },
          'asset-new': {
            file: '',
            type: 'audio/wav',
            generationId: 'gen-new',
            origin: 'refreshable-from-generation',
          },
        },
      },
    );

    const materializedAssetIds = resolveGenerationAssetMock.mock.calls.map(([request]) => request.assetId);

    expect(version).toBe(2);
    expect(materializedAssetIds).toEqual(['asset-new']);
    expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual({
      assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
    });
    expect(localTree.writes.map((write) => write.path).some((path) => path.includes('assembly.json') || path.includes('registry.json'))).toBe(false);
    expect((localTree.files['sources/assets/new.wav'] as Blob).size).toBeGreaterThan(0);
    expect(provider.getMaterializationSummary()).toEqual({
      states: {
        'asset-skipped': {
          state: 'skipped-with-diagnostic',
        diagnostic: {
          assetId: 'asset-skipped',
          generationId: 'gen-skipped',
          reason: 'unresolvable',
          message: 'gen-skipped still cannot be refreshed',
          },
        },
        'asset-new': {
          state: 'materialized',
          file: 'assets/new.wav',
        },
      },
      diagnostics: [
        {
          assetId: 'asset-skipped',
          generationId: 'gen-skipped',
          reason: 'unresolvable',
          message: 'gen-skipped still cannot be refreshed',
        },
      ],
    });
  });

  it('uses the direct localhost asset base default', () => {
    expect(defaultAstridBridgeAssetBaseUrl()).toBe('http://127.0.0.1:17333');
  });

  // -------------------------------------------------------------------------
  // Optimistic concurrency on the bridge save (expected_version / 409)
  //
  // This block used to pin the *absence* of CAS ("local monotonic stale
  // invalidation gap"): saveTimeline dropped `expectedVersion` on the floor, so
  // the conflict-retry ladder in useTimelinePersistence was unreachable and two
  // windows on one timeline silently reverted each other's whole document.
  // The provider now participates in CAS, so the pin is inverted: what must be
  // guaranteed is that the version is *sent*, that a 409 becomes the typed
  // conflict error, and that a bridge which ignores the field is unaffected.
  // -------------------------------------------------------------------------
  describe('optimistic concurrency (expected_version)', () => {
    const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';

    /** Bridge that answers 409 unless `expected_version` matches `head`. */
    const makeCasBridge = (head: number) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
        return new Response(JSON.stringify({ ...makePayload(), config_version: head }), { status: 200 });
      }
      if (url.endsWith('/save')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { expected_version?: number; registry?: unknown };
        if (typeof body.expected_version === 'number' && body.expected_version !== head) {
          return new Response(JSON.stringify({
            error: 'timeline_version_conflict',
            detail: `expected_version ${body.expected_version} does not match config_version ${head}`,
            config_version: head,
          }), { status: 409 });
        }
        return new Response(JSON.stringify({ ...makePayload(), config_version: head + 1 }), { status: 200 });
      }
      throw new Error(`Unexpected bridge request: ${url}`);
    });

    it('sends config, registry, and expected_version in the save body', async () => {
      const fetchMock = makeCasBridge(5);
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      await provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, 5);

      const saveCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/save'));
      expect(JSON.parse(String(saveCall?.[1]?.body))).toEqual({
        config: { clips: [], tracks: [] },
        registry: makePayload().registry,
        expected_version: 5,
      });
    });

    it('throws TimelineVersionConflictError when the bridge rejects a stale expected_version', async () => {
      vi.stubGlobal('fetch', makeCasBridge(7));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      const error = await provider.saveTimeline(
        TIMELINE_ID,
        { output: {}, clips: [], tracks: [] },
        3,
      ).catch((thrown: unknown) => thrown);

      expect(isTimelineVersionConflictError(error)).toBe(true);
      expect(error).toMatchObject({ expectedVersion: 3, actualVersion: 7 });
    });

    it('throws TimelineSchemaIncompatibleError with typed issues for a 422 save rejection', async () => {
      const issues = [
        { pointer: '/config/output', code: 'invalid_type', message: 'expected object, got null' },
        { pointer: '/config/tracks/0/id', code: 'invalid_type', message: 'expected string, got number' },
      ];
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify(makePayload()), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({
            error: 'schema_incompatible',
            detail: 'payload failed schema validation',
            issues,
          }), { status: 422 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      }));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });
      const error = await provider.saveTimeline(
        TIMELINE_ID,
        { output: {}, clips: [], tracks: [] },
        1,
      ).catch((thrown: unknown) => thrown);

      expect(isTimelineSchemaIncompatibleError(error)).toBe(true);
      expect(error).toBeInstanceOf(TimelineSchemaIncompatibleError);
      expect(error).toMatchObject({ issues });
      expect((error as Error).message).toContain('schema validation');
    });

    it('succeeds once the caller retries with the version the conflict reported', async () => {
      vi.stubGlobal('fetch', makeCasBridge(7));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      await expect(
        provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, 3),
      ).rejects.toThrow(TimelineVersionConflictError);

      // The ladder in useTimelinePersistence reloads, adopts the reported
      // version and re-saves; that second attempt must land.
      await expect(
        provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, 7),
      ).resolves.toBe(8);
    });

    it('leaves a bridge that ignores expected_version behaving exactly as before', async () => {
      // Backward-compatibility contract: the field is additive. A bridge that
      // does not implement CAS answers 200 to any expected_version, and the
      // provider adopts whatever head version comes back.
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify(makePayload()), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({ ...makePayload(), config_version: 42 }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      for (const staleVersion of [1, 5, 999, 99999]) {
        await expect(
          provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, staleVersion),
        ).resolves.toBe(42);
      }
    });

    it('does not treat a 409 without the conflict code as a version conflict', async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify(makePayload()), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({ error: 'locked', detail: 'timeline is locked' }), { status: 409 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      }));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      const error = await provider.saveTimeline(
        TIMELINE_ID,
        { output: {}, clips: [], tracks: [] },
        1,
      ).catch((thrown: unknown) => thrown);

      expect(isTimelineVersionConflictError(error)).toBe(false);
      expect((error as Error).message).toContain('timeline is locked');
    });

    it('rejects a combined save POST with 409 and retries successfully after adopting the reported version', async () => {
      let head = 5;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify({ ...makePayload(), config_version: head }), { status: 200 });
        }
        if (url.endsWith('/save')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { expected_version?: number; config?: unknown; registry?: unknown };
          if (typeof body.expected_version === 'number' && body.expected_version !== head) {
            return new Response(JSON.stringify({
              error: 'timeline_version_conflict',
              detail: `expected_version ${body.expected_version} does not match config_version ${head}`,
              config_version: head,
            }), { status: 409 });
          }
          head += 1;
          return new Response(JSON.stringify({ ...makePayload(), config_version: head }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      // First attempt: stale (version 2, head is 5) → 409
      const conflictError = await provider.saveTimeline(
        TIMELINE_ID,
        { output: {}, clips: [], tracks: [] },
        2,
        { assets: { 'a': { file: 'f.mp4', type: 'video/mp4' } } },
      ).catch((thrown: unknown) => thrown);

      expect(isTimelineVersionConflictError(conflictError)).toBe(true);
      expect(conflictError).toMatchObject({ expectedVersion: 2, actualVersion: 5 });

      // Retry with the reported version (5) → success
      const v6 = await provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, 5);
      expect(v6).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // Fresh loads (the poll must reach the bridge)
  // -------------------------------------------------------------------------
  describe('load freshness', () => {
    const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';

    it('re-fetches on every loadTimeline/loadAssetRegistry so polling can observe remote changes', async () => {
      const TIMELINE_ULID = '01JM4K5N7P0000000000000017';
      let head = 1;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (
          url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)
          || url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}`)
        ) {
          return new Response(JSON.stringify({
            ...makePayload(),
            config_version: head,
            config: { clips: [{ id: `clip-${head}`, track: 'V1', at: 0 }], tracks: [] },
          }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      const first = await provider.loadTimeline(TIMELINE_ID);
      expect(first.configVersion).toBe(1);
      // The first load goes through the caller's key (ULID not known yet);
      // every fresh load after that is addressed by the cached timeline_ulid.
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`,
      );

      head = 2;
      const second = await provider.loadTimeline(TIMELINE_ID);
      expect(second.configVersion).toBe(2);
      expect(second.config.clips).toEqual([{ id: 'clip-2', track: 'V1', at: 0 }]);

      head = 3;
      await provider.loadAssetRegistry(TIMELINE_ID);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.slice(1).map(([input]) => String(input))).toEqual([
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}`,
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}`,
      ]);
    });

    it('coalesces the poll\'s concurrent timeline+registry loads onto one request', async () => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(makePayload()), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      // React Query fires both queries on the same tick; they must observe the
      // same bridge revision, not straddle a concurrent write.
      await Promise.all([
        provider.loadTimeline(TIMELINE_ID),
        provider.loadAssetRegistry(TIMELINE_ID),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still serves saveTimeline its registry default from the cached payload via a single save POST', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify(makePayload()), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({ ...makePayload(), config_version: 2 }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: TIMELINE_ID,
      });

      await provider.loadTimeline(TIMELINE_ID);
      await provider.saveTimeline(TIMELINE_ID, { output: {}, clips: [], tracks: [] }, 1);

      // One GET for the load; the save reuses the cached payload for its
      // registry default and sends everything in one POST — addressed by the
      // cached timeline_ulid, not the canonical UUID.
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`,
        `/api/astrid/projects/ados-talks/timelines/01JM4K5N7P0000000000000017/save`,
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // T2.3: the cached timeline_ulid is the routable address; the canonical
  // UUID is identity only
  // -------------------------------------------------------------------------
  describe('ULID request addressing', () => {
    const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
    const TIMELINE_ULID = '01JM4K5N7P0000000000000017';

    it('routes post-load save/load/asset requests through the cached timeline_ulid, never the canonical UUID', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        // The first load goes through the caller's UUID key (ULID not known
        // yet); every route after that uses the cached ULID.
        if (
          url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)
          || url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}`)
        ) {
          return new Response(JSON.stringify(makePayload()), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({ ...makePayload(), config_version: 4 }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: TIMELINE_ID,
        timelineId: TIMELINE_ID,
      });

      await provider.loadTimeline(TIMELINE_ID);

      // Save: the cached payload is reused (no pre-save GET) and the POST is
      // addressed by the ULID — no per-save project-wide identity scan.
      const version = await provider.saveTimeline(TIMELINE_ID, { clips: [], tracks: [] }, 3);
      expect(version).toBe(4);

      // Fresh loads (the shell poll) are addressed by the ULID too.
      await provider.loadAssetRegistry(TIMELINE_ID);

      // Asset URLs travel the same ULID route.
      await expect(provider.resolveAssetUrl('clips/demo.mp4')).resolves.toBe(
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}/assets/asset-video`,
      );

      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls).toEqual([
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`,
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}/save`,
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ULID}`,
      ]);
      // After the load, no request is addressed by the canonical UUID.
      expect(urls.slice(1).join(' ')).not.toContain(TIMELINE_ID);
    });

    it('falls back to the canonical UUID when the payload carries no timeline_ulid', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`)) {
          return new Response(JSON.stringify({ ...makePayload(), timeline_ulid: undefined }), { status: 200 });
        }
        if (url.endsWith('/save')) {
          return new Response(JSON.stringify({ ...makePayload(), timeline_ulid: undefined, config_version: 2 }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: TIMELINE_ID,
        timelineId: TIMELINE_ID,
      });

      await provider.loadTimeline(TIMELINE_ID);
      const version = await provider.saveTimeline(TIMELINE_ID, { clips: [], tracks: [] }, 1);
      expect(version).toBe(2);

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}`,
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}/save`,
      ]);
      await expect(provider.resolveAssetUrl('clips/demo.mp4')).resolves.toBe(
        `/api/astrid/projects/ados-talks/timelines/${TIMELINE_ID}/assets/asset-video`,
      );
    });

    it('still throws on identity mismatch (canonical UUID) even when the ULID alias matches', async () => {
      let head = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes(`/timelines/${TIMELINE_ULID}`)) {
          head += 1;
          return new Response(JSON.stringify(
            head === 1
              ? makePayload()
              : { ...makePayload(), timeline_id: '33333333-3333-3333-3333-333333333333' },
          ), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: TIMELINE_ULID,
        timelineId: TIMELINE_ULID,
      });

      await provider.loadTimeline(TIMELINE_ULID);
      // The ULID alias is unchanged, but the canonical identity differs — the
      // UUID-based identity guard must still reject the payload.
      await expect(provider.loadTimeline(TIMELINE_ULID)).rejects.toThrow(
        'Astrid bridge timeline mismatch: expected 11111111-1111-1111-1111-111111111111, got 33333333-3333-3333-3333-333333333333',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Caller-supplied identity must be confirmed by the FIRST payload (the
  // constructor used to discard it entirely, so a wrong UUID in the first
  // response was silently adopted and a later caller could be redirected to
  // the cached ULID).
  // -------------------------------------------------------------------------
  describe('caller-supplied identity validation', () => {
    const SUPPLIED_ID = '11111111-1111-1111-1111-111111111111';
    const OTHER_ULID = '01JX4K5N7P0000000000000099';

    it('accepts a first payload whose timeline_ulid confirms the supplied identity and keys subsequent requests off the established ref', async () => {
      // A payload that echoes the caller's identity into its routable ULID —
      // as the local sub-mode synthesis does (timeline_id = timeline_ulid =
      // caller key) — confirms the supplied identity and must load. After
      // that, the first-payload ULID is the authoritative request ref.
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith(`/api/astrid/projects/ados-talks/timelines/${SUPPLIED_ID}`)
          || url.endsWith(`/api/astrid/projects/ados-talks/timelines/${SUPPLIED_ID}/save`)
        ) {
          return new Response(JSON.stringify({
            ...makePayload(),
            timeline_id: SUPPLIED_ID,
            timeline_ulid: SUPPLIED_ID,
            config_version: 3,
          }), { status: 200 });
        }
        throw new Error(`Unexpected bridge request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: SUPPLIED_ID,
        timelineId: SUPPLIED_ID,
      });

      const loaded = await provider.loadTimeline(SUPPLIED_ID);
      expect(loaded.configVersion).toBe(3);

      // Subsequent requests key off the established ref (the first-payload
      // ULID, which here equals the supplied identity).
      const version = await provider.saveTimeline(SUPPLIED_ID, { clips: [], tracks: [] }, 2);
      expect(version).toBe(3);

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        `/api/astrid/projects/ados-talks/timelines/${SUPPLIED_ID}`,
        `/api/astrid/projects/ados-talks/timelines/${SUPPLIED_ID}/save`,
      ]);
      expect(getSupabaseClient).not.toHaveBeenCalled();
    });

    it('rejects a first payload whose timeline_id AND timeline_ulid both mismatch the supplied identity', async () => {
      // The regression: before the fix the constructor discarded the supplied
      // identity, so this wrong-UUID first response was silently adopted as
      // canonical. It must reject with a clear error instead.
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        ...makePayload(),
        timeline_id: '22222222-2222-2222-2222-222222222222',
        timeline_ulid: OTHER_ULID,
      }), { status: 200 })));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: SUPPLIED_ID,
        timelineId: SUPPLIED_ID,
      });

      await expect(provider.loadTimeline(SUPPLIED_ID)).rejects.toThrow(
        `Astrid bridge timeline identity mismatch: requested ${SUPPLIED_ID}, `
        + `got timeline_id 22222222-2222-2222-2222-222222222222 / timeline_ulid ${OTHER_ULID}`,
      );
      expect(getSupabaseClient).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Wire contract validation (bridgeContract.ts)
  // -------------------------------------------------------------------------
  describe('bridge contract validation', () => {
    const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
    const createProvider = () => new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      timelineId: TIMELINE_ID,
    });

    it.each([
      ['a non-object config', { ...makePayload(), config: 'garbage-string' }],
      ['a non-array clips list', { ...makePayload(), config: { clips: 42, tracks: [] } }],
      ['a non-object registry', { ...makePayload(), registry: 'nope' }],
      ['a non-numeric config_version', { ...makePayload(), config_version: 'seven' }],
    ])('rejects %s instead of coercing it', async (_label, payload) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

      await expect(createProvider().loadTimeline(TIMELINE_ID)).rejects.toThrow(BridgeContractError);
    });

    it('never lets a malformed registry become an empty one that a later save would PUT back', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ ...makePayload(), registry: { assets: { 'asset-video': { file: 12 } } } }),
        { status: 200 },
      )));

      await expect(createProvider().loadAssetRegistry(TIMELINE_ID)).rejects.toThrow(BridgeContractError);
    });

    it('accepts payloads that omit the optional fields', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ config: { clips: [], tracks: [] } }),
        { status: 200 },
      )));

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
      });

      await expect(provider.loadTimeline('intro-cut')).resolves.toMatchObject({ configVersion: 1 });
    });

    it('preserves unknown keys on clips, tracks and registry entries', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        ...makePayload(),
        config: {
          clips: [{ id: 'c1', track: 'V1', at: 0, extensionAuthored: { keep: true } }],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1', vendorField: 7 }],
        },
        registry: { assets: { 'asset-video': { file: 'clips/demo.mp4', vendorField: 'kept' } } },
      }), { status: 200 })));

      const provider = createProvider();
      const loaded = await provider.loadTimeline(TIMELINE_ID);
      const registry = await provider.loadAssetRegistry(TIMELINE_ID);

      expect(loaded.config.clips[0]).toMatchObject({ extensionAuthored: { keep: true } });
      expect(loaded.config.tracks[0]).toMatchObject({ vendorField: 7 });
      expect(registry.assets['asset-video']).toMatchObject({ vendorField: 'kept' });
    });
  });

  // -------------------------------------------------------------------------
  // dataKind V2: TimelineBundle passthrough (contract field + provider)
  // -------------------------------------------------------------------------
  describe('dataKind V2: bundle passthrough', () => {
    const BUNDLE_TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
    const LOCAL_TIMELINE_REF = '01JM4K5N7P0000000000000017';

    const createProvider = () => new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: BUNDLE_TIMELINE_ID,
      timelineId: BUNDLE_TIMELINE_ID,
    });

    const makeLocalProvider = () => new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: LOCAL_TIMELINE_REF,
      timelineId: LOCAL_TIMELINE_REF,
    });

    const makeBundle = (overrides: Record<string, unknown> = {}) => ({
      schema_version: TIMELINE_BUNDLE_SCHEMA_VERSION,
      itemsBySchemaRef: {
        'reigh.transcript_segment/v1': [{
          id: 'assetA:src:9a03b4c1d2e4',
          shape: 'interval',
          domain: 'source_seconds',
          extent: { start: 0, end: 1.5 },
          schemaRef: 'reigh.transcript_segment/v1',
          payload: { text: 'hello' },
          sourceArtifactRef: { assetId: 'assetA' },
          provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
        }],
      },
      ...overrides,
    });

    const makeLocalTree = () => createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      [`timelines/${LOCAL_TIMELINE_REF}/assembly.json`]: JSON.stringify({
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      [`timelines/${LOCAL_TIMELINE_REF}/registry.json`]: JSON.stringify({
        assets: { 'asset-video': { file: 'clips/demo.mp4', type: 'video/mp4' } },
      }),
    });

    /** Fetch mock splitting GET (payload) from POST /save, capturing save bodies. */
    function stubBridgeSavingBodies(saveBodies: Array<Record<string, unknown>>, responseOverrides: Record<string, unknown> = {}) {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // The save POST is addressed by the cached timeline_ulid, not the
        // caller's UUID key (see the addressing tests above) — match /save.
        if (String(input).endsWith('/save')) {
          saveBodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ ...makePayload(), config_version: 4, ...responseOverrides }), { status: 200 });
        }
        return new Response(JSON.stringify({ ...makePayload(), ...responseOverrides }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('loads a declared bundle through to LoadedTimeline.bundle', async () => {
      const bundle = makeBundle();
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ ...makePayload(), bundle }),
        { status: 200 },
      )));

      const loaded = await createProvider().loadTimeline(BUNDLE_TIMELINE_ID);

      expect(loaded.bundle).toEqual(bundle);
      // The rest of the payload loads exactly as before the field existed.
      expect(loaded.config.tracks[0]).toMatchObject({ id: 'V1' });
    });

    it('reports bundle: null when the head carries none (provider has adopted bundles)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(makePayload()), { status: 200 })));

      const loaded = await createProvider().loadTimeline(BUNDLE_TIMELINE_ID);

      // Explicit null, not undefined: callers must be able to distinguish
      // "nothing persisted" from a provider that ignores bundles entirely.
      expect(loaded.bundle).toBeNull();
    });

    it('fails the whole load closed when the head declares an unparsable bundle', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(
        JSON.stringify({ ...makePayload(), bundle: makeBundle({ schema_version: 99 }) }),
        { status: 200 },
      )));

      let error: unknown = null;
      try {
        await createProvider().loadTimeline(BUNDLE_TIMELINE_ID);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(BridgeContractError);
      expect((error as Error).message).toMatch(/bundle\.schema_version/);
    });

    it('sends the bundle in the save POST body and tolerates a bridge that ignores it', async () => {
      const bundle = makeBundle();
      const saveBodies: Array<Record<string, unknown>> = [];
      stubBridgeSavingBodies(saveBodies);

      const provider = createProvider();
      const nextVersion = await provider.saveTimeline(BUNDLE_TIMELINE_ID, {
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }, 3, undefined, bundle);

      expect(saveBodies).toHaveLength(1);
      expect(saveBodies[0].bundle).toEqual(bundle);
      expect(saveBodies[0].expected_version).toBe(3);
      // Ignoring-field tolerance: the mock bridge answers 200 without echoing
      // or storing the bundle; the save succeeds and adopts its head version.
      expect(nextVersion).toBe(4);
    });

    it('omits the bundle key when saving without one and sends null for an explicit clear', async () => {
      const saveBodies: Array<Record<string, unknown>> = [];
      stubBridgeSavingBodies(saveBodies);

      const config = { clips: [], tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }] };
      const provider = createProvider();
      await provider.saveTimeline(BUNDLE_TIMELINE_ID, config, 1);
      await provider.saveTimeline(BUNDLE_TIMELINE_ID, config, 2, undefined, null);

      expect('bundle' in saveBodies[0]).toBe(false);
      expect(saveBodies[1].bundle).toBeNull();
    });

    it('rejects an invalid bundle before any network call', async () => {
      const fetchMock = stubBridgeSavingBodies([]);
      const invalid = makeBundle({ schema_version: 99 }) as unknown as TimelineBundleEnvelope;

      let error: unknown = null;
      try {
        await createProvider().saveTimeline(BUNDLE_TIMELINE_ID, { clips: [], tracks: [] }, 1, undefined, invalid);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(TimelineBundleParseError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps FSA asset-only and persists the bundle through bridge CAS', async () => {
      const localTree = makeLocalTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
      const bundle = makeBundle();
      const saveBodies: Array<Record<string, unknown>> = [];
      const fetchMock = stubBridgeSavingBodies(saveBodies, { bundle });

      await makeLocalProvider().saveTimeline(LOCAL_TIMELINE_REF, {
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }, 1, undefined, bundle);

      const persistedPath = `timelines/${LOCAL_TIMELINE_REF}/data-bundle.json`;
      expect(localTree.files[persistedPath]).toBeUndefined();
      expect(saveBodies[0].bundle).toEqual(bundle);
      // A fresh provider instance reads the bridge, never local documents.
      const loaded = await makeLocalProvider().loadTimeline(LOCAL_TIMELINE_REF);
      expect(loaded.bundle).toEqual(bundle);
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // M6: Parser-enriched metadata persistence in AstridBridgeDataProvider (T11)
  // -------------------------------------------------------------------------
  it('persists parser metadata through the combined CAS POST and a fresh bridge GET while FSA remains bytes-only', async () => {
    const timelineId = '11111111-1111-1111-1111-111111111111';
    const timelineRef = '01JM4K5N7P0000000000000017';
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      [`timelines/${timelineRef}/assembly.json`]: JSON.stringify({ clips: [{ id: 'stale-local-clip' }], tracks: [] }),
      [`timelines/${timelineRef}/registry.json`]: JSON.stringify({
        assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
      }),
    });
    vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);

    const enrichedEntry = {
      file: 'local-drops/demo.mp4',
      type: 'video/mp4',
      duration: 4,
      metadata: {
        integrity: { algorithm: 'sha256', hash: 'parser-hash', size: 5 },
        provenance: { source: 'parser-test' },
        enrichment: {
          pending: 1,
          failed: 0,
          claims: [{ claimId: 'claim-1', parserId: 'com.example.parser', field: 'description' }],
        },
        extensions: { 'com.example.parser': { parsed: true } },
      },
    };
    vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
      entry: enrichedEntry,
      diagnostics: [],
      blocked: false,
    });

    let bridgePayload = {
      ...makePayload(),
      timeline_id: timelineId,
      timeline_ulid: timelineRef,
      config_version: 4,
      registry: { assets: {} },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/save')) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as {
          config: unknown;
          registry: { assets: Record<string, unknown> };
          expected_version: number;
        };
        expect(body.expected_version).toBe(4);
        expect(Object.values(body.registry.assets)).toEqual([enrichedEntry]);
        bridgePayload = {
          ...bridgePayload,
          config: body.config,
          registry: body.registry,
          config_version: 5,
        };
        return new Response(JSON.stringify(bridgePayload), { status: 200 });
      }
      return new Response(JSON.stringify(bridgePayload), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef,
      timelineId,
      registeredParsers: [{
        descriptor: {
          id: 'com.example.parser.metadata',
          extensionId: 'com.example.parser',
          label: 'Parser',
          acceptMimeTypes: ['video/mp4'],
        },
        handler: vi.fn(async () => ({ metadata: {} })),
      }],
    });

    const uploaded = await provider.uploadAsset(
      new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
      { timelineId, userId: 'user-1' },
    );
    expect(uploaded.entry.metadata).toEqual(enrichedEntry.metadata);

    // This is a fresh read, not the cached POST response: metadata must come
    // back from the bridge document plane after the CAS write.
    const freshRegistry = await provider.loadAssetRegistry(timelineId);
    const assetId = uploaded.assetId;
    expect(freshRegistry.assets[assetId].metadata).toEqual(enrichedEntry.metadata);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `/api/astrid/projects/ados-talks/timelines/${timelineId}`,
      `/api/astrid/projects/ados-talks/timelines/${timelineRef}/save`,
      `/api/astrid/projects/ados-talks/timelines/${timelineRef}`,
    ]);
    expect(localTree.writes.map((write) => write.path).some((path) => path.includes('assembly.json') || path.includes('registry.json'))).toBe(false);
    expect(JSON.parse(String(localTree.files[`timelines/${timelineRef}/registry.json`]))).toEqual({
      assets: { 'stale-local-asset': { file: 'stale/local.mp4', type: 'video/mp4' } },
    });
  });

});
