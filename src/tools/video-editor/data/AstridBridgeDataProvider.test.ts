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
import {
  isTimelineVersionConflictError,
  TimelineNotFoundError,
  TimelineVersionConflictError,
} from '@/tools/video-editor/data/DataProvider.ts';
import { BridgeContractError } from '@/tools/video-editor/data/bridgeContract.ts';
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
      { signal: expect.any(AbortSignal) },
    );
    expect(loaded.configVersion).toBe(1);
    expect(loaded.config.output).toEqual(expect.objectContaining({
      resolution: '1280x720',
      fps: 30,
      file: 'output.mp4',
    }));
    expect(getSupabaseClient).not.toHaveBeenCalled();
  });

  it('emits only bounded bridge request outcomes for success and invalid responses', async () => {
    const onBridgeRequest = vi.fn();
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      onBridgeRequest,
    });

    await provider.loadTimeline('11111111-1111-1111-1111-111111111111');
    expect(onBridgeRequest).toHaveBeenLastCalledWith({
      outcome: 'success',
      durationMs: expect.any(Number),
    });
    expect(Object.keys(onBridgeRequest.mock.calls[0][0]).sort()).toEqual(['durationMs', 'outcome']);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{not-json', { status: 200 })));
    const malformedProvider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      onBridgeRequest,
    });
    await expect(malformedProvider.loadTimeline('11111111-1111-1111-1111-111111111111')).rejects.toThrow();
    expect(onBridgeRequest).toHaveBeenLastCalledWith({
      outcome: 'failure',
      durationMs: expect.any(Number),
      errorClass: 'bridge.invalid_response',
    });
  });

  it('classifies bridge HTTP and timeout failures without changing their runtime errors', async () => {
    const onBridgeRequest = vi.fn(() => {
      throw new Error('analytics unavailable');
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'timeline_not_found',
      detail: 'missing',
    }), { status: 404 })));
    const missingProvider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      onBridgeRequest,
    });
    await expect(missingProvider.loadTimeline('missing')).rejects.toBeInstanceOf(TimelineNotFoundError);
    expect(onBridgeRequest).toHaveBeenLastCalledWith({
      outcome: 'failure',
      durationMs: expect.any(Number),
      errorClass: 'bridge.http_error',
    });

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }));
    const timeoutProvider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      onBridgeRequest,
    });
    await expect(timeoutProvider.loadTimeline('missing')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(onBridgeRequest).toHaveBeenLastCalledWith({
      outcome: 'failure',
      durationMs: expect.any(Number),
      errorClass: 'bridge.timeout',
    });
  });

  it('classifies an unreadable non-2xx error body as an HTTP bridge failure', async () => {
    const onBridgeRequest = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{not-json', { status: 502 })));
    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: 'intro-cut',
      onBridgeRequest,
    });

    await expect(provider.loadTimeline('missing')).rejects.toThrow();
    expect(onBridgeRequest).toHaveBeenCalledOnce();
    expect(onBridgeRequest).toHaveBeenCalledWith({
      outcome: 'failure',
      durationMs: expect.any(Number),
      errorClass: 'bridge.http_error',
    });
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
            output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
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
          config: { output: {}, clips: [], tracks: [] },
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

  it('loads local assembly and registry files through the persisted project handle and resolves source-relative files', async () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: {
          'asset-video': { file: 'clips/demo.mp4', type: 'video/mp4' },
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

      expect(loaded.config.output).toEqual(expect.objectContaining({
        resolution: '1280x720',
        fps: 30,
        file: 'output.mp4',
      }));
      expect(registry.assets['asset-video'].file).toBe('clips/demo.mp4');
      await expect(provider.resolveAssetUrl('clips/demo.mp4')).resolves.toBe('blob:local-demo');
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
    }
  });

  it('materializes generation-backed assets to sources/assets and persists a consistent registry after download', async () => {
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: {
          'asset-generation': {
            file: '',
            type: 'video/mp4',
            generationId: 'gen-1',
            origin: 'refreshable-from-generation',
          },
        },
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('downloaded-video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

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
    expect(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json'])).toContain('"file": "assets/demo.mp4"');
    expect(localTree.writes.map((write) => write.path)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^sources\/assets\/\.incoming\/.+\/demo\.mp4$/),
      'sources/assets/demo.mp4',
      expect.stringMatching(/^timelines\/01JM4K5N7P0000000000000017\/\.registry\.json\..+\.tmp$/),
      'timelines/01JM4K5N7P0000000000000017/registry.json',
    ]));
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
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify(originalRegistry),
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

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');

    expect(registry.assets['asset-generation']).toEqual(originalRegistry.assets['asset-generation']);
    expect(JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']))).toEqual(originalRegistry);
    expect(localTree.writes).toEqual([]);
    expect(provider.getMaterializationSummary().states['asset-generation']).toEqual({
      state: 'skipped-with-diagnostic',
      diagnostic: {
        assetId: 'asset-generation',
        generationId: 'gen-1',
        reason: 'refresh-required',
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
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify(originalRegistry),
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('downloaded-video', {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

    const provider = new AstridBridgeDataProvider({
      projectSlug: 'ados-talks',
      timelineRef: '01JM4K5N7P0000000000000017',
      timelineId: '01JM4K5N7P0000000000000017',
    });

    const registry = await provider.loadAssetRegistry('01JM4K5N7P0000000000000017');
    const persistedRegistry = JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']));
    const summary = provider.getMaterializationSummary();

    expect(registry.assets['asset-success']).toEqual(expect.objectContaining({
      file: 'assets/demo.mp4',
      generationId: 'gen-success',
    }));
    expect(registry.assets['asset-failure']).toEqual(originalRegistry.assets['asset-failure']);
    expect(persistedRegistry).toEqual({
      assets: {
        'asset-success': expect.objectContaining({
          file: 'assets/demo.mp4',
          generationId: 'gen-success',
        }),
        'asset-failure': originalRegistry.assets['asset-failure'],
      },
    });
    expect(persistedRegistry.assets['asset-failure'].file).toBe('');
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
        reason: 'refresh-required',
        message: 'signed URL can no longer be re-minted',
      },
    });
    expect(summary.diagnostics).toEqual([
      {
        assetId: 'asset-failure',
        generationId: 'gen-failure',
        reason: 'refresh-required',
        message: 'signed URL can no longer be re-minted',
      },
    ]);
  });

  it('does not automatically retry skipped assets on local save but still materializes newly attempted ones', async () => {
    const localTree = createFileSystemHandleTree({
      'project.json': JSON.stringify({ slug: 'ados-talks' }),
      'timelines/01JM4K5N7P0000000000000017/assembly.json': JSON.stringify({
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }),
      'timelines/01JM4K5N7P0000000000000017/registry.json': JSON.stringify({
        assets: {
          'asset-skipped': {
            file: '',
            type: 'video/mp4',
            generationId: 'gen-skipped',
            origin: 'refreshable-from-generation',
          },
        },
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://storage.example/')) {
        return new Response('new-audio', {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        });
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }));

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
        reason: 'refresh-required',
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

    const persistedRegistry = JSON.parse(String(localTree.files['timelines/01JM4K5N7P0000000000000017/registry.json']));
    const materializedAssetIds = resolveGenerationAssetMock.mock.calls.map(([request]) => request.assetId);

    expect(version).toBe(2);
    expect(materializedAssetIds).toEqual(['asset-new']);
    expect(persistedRegistry.assets['asset-skipped']).toEqual({
      file: '',
      type: 'video/mp4',
      generationId: 'gen-skipped',
      origin: 'refreshable-from-generation',
    });
    expect(persistedRegistry.assets['asset-new']).toEqual(expect.objectContaining({
      file: 'assets/new.wav',
      generationId: 'gen-new',
      type: 'audio/wav',
    }));
    expect((localTree.files['sources/assets/new.wav'] as Blob).size).toBeGreaterThan(0);
    expect(provider.getMaterializationSummary()).toEqual({
      states: {
        'asset-skipped': {
          state: 'skipped-with-diagnostic',
          diagnostic: {
            assetId: 'asset-skipped',
            generationId: 'gen-skipped',
            reason: 'refresh-required',
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
          reason: 'refresh-required',
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
        config: { output: {}, clips: [], tracks: [] },
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
        return new Response(JSON.stringify(makePayload()), { status: 200 });
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

    it('persists a data-bundle.json sibling in local mode and round-trips it through a reload', async () => {
      const localTree = makeLocalTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
      const bundle = makeBundle();

      await makeLocalProvider().saveTimeline(LOCAL_TIMELINE_REF, {
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }, 1, undefined, bundle);

      const persistedPath = `timelines/${LOCAL_TIMELINE_REF}/data-bundle.json`;
      expect(typeof localTree.files[persistedPath]).toBe('string');
      const persisted = JSON.parse(localTree.files[persistedPath] as string);
      expect(persisted.schema_version).toBe(TIMELINE_BUNDLE_SCHEMA_VERSION);

      // A fresh provider instance reads only what hit disk.
      const loaded = await makeLocalProvider().loadTimeline(LOCAL_TIMELINE_REF);
      expect(loaded.bundle).toEqual(bundle);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('leaves an existing sibling untouched when a local save passes no bundle, and clears it on explicit null', async () => {
      const localTree = makeLocalTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);
      const bundle = makeBundle();
      const persistedPath = `timelines/${LOCAL_TIMELINE_REF}/data-bundle.json`;
      const provider = makeLocalProvider();

      await provider.saveTimeline(LOCAL_TIMELINE_REF, { clips: [], tracks: [] }, 1, undefined, bundle);
      await provider.saveTimeline(LOCAL_TIMELINE_REF, {
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      }, 2);

      expect(JSON.parse(localTree.files[persistedPath] as string)).toEqual(bundle);

      await provider.saveTimeline(LOCAL_TIMELINE_REF, { clips: [], tracks: [] }, 3, undefined, null);

      expect(localTree.removed).toContain(persistedPath);
      const loaded = await makeLocalProvider().loadTimeline(LOCAL_TIMELINE_REF);
      expect(loaded.bundle).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // M6: Parser-enriched metadata persistence in AstridBridgeDataProvider (T11)
  // -------------------------------------------------------------------------
  describe('M6: parser enrichment in AstridBridgeDataProvider', () => {
    const makeMockParser = (
      id: string,
      extensionId: string,
      overrides = {},
    ) => ({
      descriptor: {
        id,
        extensionId,
        label: 'Parser ' + id,
        acceptMimeTypes: ['video/mp4'],
        ...overrides,
      },
      handler: vi.fn(async () => ({
        metadata: {
          integrity: { sha256: 'abc123' },
          extensions: {
            [extensionId]: { parsed: true },
          },
        },
      })),
    });

    it('enriches upload entries with parser metadata when registeredParsers are configured', async () => {
      const handleTree = createDirectoryHandleTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

      const parser = makeMockParser(
        'com.example.parser.metadata-extractor',
        'com.example.parser',
      );

      const enrichedEntry = {
        file: 'local-drops/demo.mp4',
        type: 'video/mp4',
        duration: 4,
        metadata: {
          integrity: { sha256: 'abc123' },
          extensions: {
            'com.example.parser': { parsed: true },
          },
        },
      };

      vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
        entry: enrichedEntry,
        diagnostics: [],
        blocked: false,
      });

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: '11111111-1111-1111-1111-111111111111',
        registeredParsers: [parser],
      });

      const result = await provider.uploadAsset(
        new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
        { timelineId: '11111111-1111-1111-1111-111111111111', userId: 'user-1' },
      );

      // enrichRegistryEntryWithParsers was called
      expect(enrichRegistryEntryWithParsers).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          file: 'local-drops/demo.mp4',
          type: 'video/mp4',
          duration: 4,
        }),
        expect.any(String),
        [parser],
      );

      // registerAsset was called with the enriched entry
      expect(registerAssetSpy).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        expect.any(String),
        enrichedEntry,
      );

      // The returned result has the enriched entry
      expect(result.entry).toEqual(enrichedEntry);
      expect(result.assetId).toEqual(expect.any(String));
    });

    it('does not call enrichRegistryEntryWithParsers when registeredParsers is undefined', async () => {
      const handleTree = createDirectoryHandleTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      // No registeredParsers option
      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: '11111111-1111-1111-1111-111111111111',
      });

      await provider.uploadAsset(
        new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
        { timelineId: '11111111-1111-1111-1111-111111111111', userId: 'user-1' },
      );

      // enrichRegistryEntryWithParsers must NOT be called
      expect(enrichRegistryEntryWithParsers).not.toHaveBeenCalled();

      // registerAsset was called with the raw entry (no enrichment)
      expect(registerAssetSpy).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        expect.any(String),
        expect.objectContaining({
          file: 'local-drops/demo.mp4',
          type: 'video/mp4',
          duration: 4,
        }),
      );
    });

    it('preserves existing upload behavior when registeredParsers is an empty array', async () => {
      const handleTree = createDirectoryHandleTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      // Empty registeredParsers
      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: '11111111-1111-1111-1111-111111111111',
        registeredParsers: [],
      });

      const result = await provider.uploadAsset(
        new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
        { timelineId: '11111111-1111-1111-1111-111111111111', userId: 'user-1' },
      );

      // enrichRegistryEntryWithParsers must NOT be called
      expect(enrichRegistryEntryWithParsers).not.toHaveBeenCalled();

      // The entry is the raw extracted entry (no metadata enrichment)
      expect(result.entry).toEqual(expect.objectContaining({
        file: 'local-drops/demo.mp4',
        type: 'video/mp4',
        duration: 4,
      }));
      // No metadata field on unenriched entries
      expect(result.entry.metadata).toBeUndefined();

      expect(registerAssetSpy).toHaveBeenCalledTimes(1);
    });

    it('persists parser-produced enrichment claims and integrity metadata through the upload return value', async () => {
      const handleTree = createDirectoryHandleTree();
      vi.mocked(getDirectoryHandle).mockResolvedValue(handleTree.projectRootHandle);

      const parser = makeMockParser(
        'com.example.claims.parser',
        'com.example.claims',
      );

      const enrichedEntryWithClaims = {
        file: 'local-drops/demo.mp4',
        type: 'video/mp4',
        duration: 4,
        metadata: {
          enrichment: {
            pending: 1,
            failed: 0,
            claims: [
              {
                claimId: 'claim-1',
                parserId: 'com.example.claims',
                timestamp: '2026-06-19T00:00:00.000Z',
                field: 'description',
                summary: 'Analyzed with AI',
              },
            ],
          },
          integrity: { sha256: 'def456' },
        },
      };

      const parserDiagnostics = [
        {
          severity: 'info',
          code: 'parser/claim-enqueued',
          message: 'Enqueued enrichment claim claim-1 for deferred execution.',
          extensionId: 'com.example.claims',
          contributionId: 'com.example.claims.parser',
        },
      ];

      vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
        entry: enrichedEntryWithClaims,
        diagnostics: parserDiagnostics,
        blocked: false,
      });

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef: 'intro-cut',
        timelineId: '11111111-1111-1111-1111-111111111111',
        registeredParsers: [parser],
      });

      const result = await provider.uploadAsset(
        new File(['video'], 'demo.mp4', { type: 'video/mp4' }),
        { timelineId: '11111111-1111-1111-1111-111111111111', userId: 'user-1' },
      );

      // The enrichment claims are in the persisted entry
      expect(registerAssetSpy).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        expect.any(String),
        expect.objectContaining({
          metadata: expect.objectContaining({
            enrichment: expect.objectContaining({
              claims: expect.arrayContaining([
                expect.objectContaining({
                  claimId: 'claim-1',
                  parserId: 'com.example.claims',
                }),
              ]),
            }),
            integrity: expect.objectContaining({
              sha256: 'def456',
            }),
          }),
        }),
      );

      // The returned result carries the enriched metadata
      expect(result.entry.metadata).toBeDefined();
      expect(result.entry.metadata.enrichment).toBeDefined();
    });

    it('persists parser-enriched metadata through local save/reload cycle via fetchLocalTimelinePayload', async () => {
      const timelineRef = '01JM4K5N7P0000000000000017';
      const enrichedEntry = {
        file: 'local-drops/test-image.png',
        type: 'image/png',
        metadata: {
          integrity: { algorithm: 'sha256', hash: 'deadbeef1234', size: 100 },
          provenance: { importedAt: '2026-06-19T00:00:00.000Z', source: 'astrid-local-test' },
          enrichment: {
            pending: 1,
            failed: 0,
            claims: [
              {
                claimId: 'claim-1',
                parserId: 'com.example.astrid',
                timestamp: '2026-06-19T00:00:00.000Z',
                field: 'description',
                summary: 'Astrid local test enrichment',
              },
            ],
          },
          extensions: {
            'com.example.astrid': { parsedBy: 'astrid-test-parser', version: 1 },
          },
        },
      };

      // Build the local file system fixture with assembly.json, registry.json, and one asset file
      const localTree = createFileSystemHandleTree({
        'project.json': JSON.stringify({ slug: 'ados-talks' }),
        [`timelines/${timelineRef}/assembly.json`]: JSON.stringify({
          clips: [],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        }),
        [`timelines/${timelineRef}/registry.json`]: JSON.stringify({
          assets: {},
        }),
        'sources/local-drops/test-image.png': new Blob(['image-bytes'], { type: 'image/png' }),
      });
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);

      // Mock parser enrichment to return metadata with integrity, provenance, enrichment claims, and extension namespace
      vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
        entry: enrichedEntry,
        diagnostics: [],
        blocked: false,
      });

      const parser = makeMockParser(
        'com.example.astrid.parser',
        'com.example.astrid',
      );

      // Spy on registerAsset to prevent HTTP PUT — we want local-only persistence
      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
        registeredParsers: [parser],
      });

      // Upload an asset — enrichRegistryEntryWithParsers is called, then registerAsset (spied)
      const uploadResult = await provider.uploadAsset(
        new File(['image'], 'test-image.png', { type: 'image/png' }),
        { timelineId: timelineRef, userId: 'user-1' },
      );

      // The returned entry must carry parser-enriched metadata
      expect(uploadResult.entry.metadata).toBeDefined();
      expect(uploadResult.entry.metadata.integrity).toBeDefined();
      expect(uploadResult.assetId).toEqual(expect.any(String));

      const assetId = uploadResult.assetId;

      // Save the timeline with the enriched entry — this writes registry.json and assembly.json to local disk
      const version = await provider.saveTimeline(
        timelineRef,
        {
          output: { resolution: '1280x720', fps: 30, file: 'output.mp4' },
          clips: [],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        },
        1,
        {
          assets: {
            [assetId]: enrichedEntry,
          },
        },
      );

      expect(version).toBeGreaterThanOrEqual(1);

      // Assert registry.json on "disk" contains the enriched metadata (integrity, enrichment claims, extensions)
      const savedRegistry = JSON.parse(
        String(localTree.files[`timelines/${timelineRef}/registry.json`]),
      );
      expect(savedRegistry.assets[assetId]).toBeDefined();
      expect(savedRegistry.assets[assetId].metadata).toBeDefined();
      expect(savedRegistry.assets[assetId].metadata.integrity.hash).toBe('deadbeef1234');
      expect(savedRegistry.assets[assetId].metadata.integrity.algorithm).toBe('sha256');
      expect(savedRegistry.assets[assetId].metadata.integrity.size).toBe(100);
      expect(savedRegistry.assets[assetId].metadata.provenance).toEqual({
        importedAt: '2026-06-19T00:00:00.000Z',
        source: 'astrid-local-test',
      });
      expect(savedRegistry.assets[assetId].metadata.enrichment.pending).toBe(1);
      expect(savedRegistry.assets[assetId].metadata.enrichment.failed).toBe(0);
      expect(savedRegistry.assets[assetId].metadata.enrichment.claims).toHaveLength(1);
      expect(savedRegistry.assets[assetId].metadata.enrichment.claims[0]).toEqual(
        expect.objectContaining({
          claimId: 'claim-1',
          parserId: 'com.example.astrid',
        }),
      );
      expect(savedRegistry.assets[assetId].metadata.extensions['com.example.astrid']).toEqual({
        parsedBy: 'astrid-test-parser',
        version: 1,
      });

      // Verify assembly.json was also written
      const savedAssembly = JSON.parse(
        String(localTree.files[`timelines/${timelineRef}/assembly.json`]),
      );
      expect(savedAssembly.clips).toEqual([]);
      expect(savedAssembly.tracks).toHaveLength(1);

      // -------------------------------------------------------------------
      // Simulate a full reload: a fresh provider instance against the same
      // local file system that calls fetchLocalTimelinePayload() internally
      // -------------------------------------------------------------------
      const reloadedProvider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
        // No registeredParsers on reload — the metadata should already be in registry.json
      });

      const reloadedRegistry = await reloadedProvider.loadAssetRegistry(timelineRef);

      // Assert enriched metadata survived the reload via fetchLocalTimelinePayload
      expect(reloadedRegistry.assets[assetId]).toBeDefined();
      expect(reloadedRegistry.assets[assetId].metadata).toBeDefined();
      expect(reloadedRegistry.assets[assetId].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'deadbeef1234',
        size: 100,
      });
      expect(reloadedRegistry.assets[assetId].metadata.provenance).toEqual({
        importedAt: '2026-06-19T00:00:00.000Z',
        source: 'astrid-local-test',
      });
      expect(reloadedRegistry.assets[assetId].metadata.enrichment.pending).toBe(1);
      expect(reloadedRegistry.assets[assetId].metadata.enrichment.failed).toBe(0);
      expect(reloadedRegistry.assets[assetId].metadata.enrichment.claims).toHaveLength(1);
      expect(reloadedRegistry.assets[assetId].metadata.enrichment.claims[0]).toEqual(
        expect.objectContaining({
          claimId: 'claim-1',
          parserId: 'com.example.astrid',
          field: 'description',
          summary: 'Astrid local test enrichment',
        }),
      );
      expect(reloadedRegistry.assets[assetId].metadata.extensions['com.example.astrid']).toEqual({
        parsedBy: 'astrid-test-parser',
        version: 1,
      });

      // Verify the reloaded provider did NOT make any HTTP calls — it used local files exclusively
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('exercises the extension authoring loop: read, patch, save, reload — mutation persists, extension source does not', async () => {
      const timelineRef = '01JM4K5N7P0000000000000018';

      const localTree = createFileSystemHandleTree({
        'project.json': JSON.stringify({ slug: 'ados-talks' }),
        [`timelines/${timelineRef}/assembly.json`]: JSON.stringify({
          clips: [],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        }),
        [`timelines/${timelineRef}/registry.json`]: JSON.stringify({
          assets: {
            'asset-original': {
              file: 'clips/original.mp4',
              type: 'video/mp4',
              duration: 3,
            },
          },
        }),
        'sources/clips/original.mp4': new Blob(['original-video'], { type: 'video/mp4' }),
      });
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);

      const parser = makeMockParser(
        'com.example.authoring-loop.parser',
        'com.example.authoring-loop',
        {
          acceptMimeTypes: ['video/mp4'],
        },
      );

      const enrichedEntryPatch = {
        file: 'clips/original.mp4',
        type: 'video/mp4',
        duration: 3,
        metadata: {
          integrity: { algorithm: 'sha256', hash: 'abcdef1234567890', size: 14 },
          provenance: { importedAt: '2026-06-19T10:00:00.000Z', source: 'authoring-loop-test' },
          enrichment: {
            pending: 1,
            failed: 0,
            claims: [
              {
                claimId: 'claim-authoring-1',
                parserId: 'com.example.authoring-loop',
                timestamp: '2026-06-19T10:00:00.000Z',
                field: 'description',
                summary: 'Authoring loop enrichment claim',
              },
            ],
          },
          extensions: {
            'com.example.authoring-loop': { analyzed: true, score: 0.95 },
          },
        },
      };

      vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
        entry: enrichedEntryPatch,
        diagnostics: [
          {
            severity: 'info',
            code: 'parser/claim-enqueued',
            message: 'Enqueued enrichment claim for authoring loop.',
            extensionId: 'com.example.authoring-loop',
            contributionId: 'com.example.authoring-loop.parser',
          },
        ],
        blocked: false,
      });

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
        registeredParsers: [parser],
      });

      const loaded = await provider.loadTimeline(timelineRef);
      const initialRegistry = await provider.loadAssetRegistry(timelineRef);

      expect(loaded.config.tracks).toHaveLength(1);
      expect(initialRegistry.assets['asset-original']).toBeDefined();
      expect(initialRegistry.assets['asset-original'].file).toBe('clips/original.mp4');

      await provider.registerAsset(timelineRef, 'asset-original', enrichedEntryPatch);

      const secondAssetEntry = {
        file: 'clips/second.mp4',
        type: 'video/mp4',
        duration: 5,
        metadata: {
          integrity: { algorithm: 'sha256', hash: 'deadbeef9999', size: 50 },
          extensions: {
            'com.example.authoring-loop': { analyzed: true, score: 0.8 },
          },
        },
      };
      await provider.registerAsset(timelineRef, 'asset-second', secondAssetEntry);

      const patchedConfig = {
        output: { resolution: '1920x1080', fps: 24, file: 'patched-output.mp4' },
        clips: [
          { id: 'clip-1', assetId: 'asset-original', trackId: 'V1', start: 0, end: 3 },
        ],
        tracks: [
          { id: 'V1', kind: 'visual', label: 'V1' },
          { id: 'A1', kind: 'audio', label: 'A1' },
        ],
      };

      const version = await provider.saveTimeline(
        timelineRef,
        patchedConfig,
        1,
        {
          assets: {
            'asset-original': enrichedEntryPatch,
            'asset-second': secondAssetEntry,
          },
        },
      );
      expect(version).toBeGreaterThanOrEqual(1);

      const savedRegistryRaw = String(localTree.files[`timelines/${timelineRef}/registry.json`]);
      const savedRegistry = JSON.parse(savedRegistryRaw);
      const savedAssemblyRaw = String(localTree.files[`timelines/${timelineRef}/assembly.json`]);
      const savedAssembly = JSON.parse(savedAssemblyRaw);

      expect(savedRegistry.assets['asset-original']).toBeDefined();
      expect(savedRegistry.assets['asset-original'].metadata).toBeDefined();
      expect(savedRegistry.assets['asset-original'].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'abcdef1234567890',
        size: 14,
      });
      expect(savedRegistry.assets['asset-original'].metadata.provenance).toEqual({
        importedAt: '2026-06-19T10:00:00.000Z',
        source: 'authoring-loop-test',
      });
      expect(savedRegistry.assets['asset-original'].metadata.enrichment.pending).toBe(1);
      expect(savedRegistry.assets['asset-original'].metadata.enrichment.claims).toHaveLength(1);
      expect(savedRegistry.assets['asset-original'].metadata.extensions['com.example.authoring-loop']).toEqual({
        analyzed: true,
        score: 0.95,
      });
      expect(savedRegistry.assets['asset-second']).toBeDefined();
      expect(savedRegistry.assets['asset-second'].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'deadbeef9999',
        size: 50,
      });

      expect(savedAssembly.output.resolution).toBe('1920x1080');
      expect(savedAssembly.output.fps).toBe(24);
      expect(savedAssembly.clips).toHaveLength(1);
      expect(savedAssembly.clips[0].assetId).toBe('asset-original');
      expect(savedAssembly.tracks).toHaveLength(2);
      expect(savedAssembly.tracks[1].id).toBe('A1');

      expect(savedRegistryRaw).not.toContain('function');
      expect(savedRegistryRaw).not.toContain('handler');
      expect(savedRegistryRaw).not.toContain('makeMockParser');
      expect(savedRegistryRaw).not.toContain('vi.fn');
      expect(savedAssemblyRaw).not.toContain('function');
      expect(savedAssemblyRaw).not.toContain('handler');
      expect(savedAssemblyRaw).not.toContain('registeredParsers');

      expect(savedRegistryRaw).not.toContain('com.example.authoring-loop.parser');
      expect(savedRegistryRaw).not.toContain('acceptMimeTypes');
      expect(savedAssemblyRaw).not.toContain('com.example.authoring-loop.parser');
      expect(savedAssemblyRaw).not.toContain('acceptMimeTypes');

      expect(savedRegistryRaw).toContain('com.example.authoring-loop');

      const reloadedProvider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
      });

      const reloadedTimeline = await reloadedProvider.loadTimeline(timelineRef);
      const reloadedRegistry = await reloadedProvider.loadAssetRegistry(timelineRef);

      expect(reloadedTimeline.config.output.resolution).toBe('1920x1080');
      expect(reloadedTimeline.config.output.fps).toBe(24);
      expect(reloadedTimeline.config.clips).toHaveLength(1);
      expect(reloadedTimeline.config.tracks).toHaveLength(2);

      expect(reloadedRegistry.assets['asset-original']).toBeDefined();
      expect(reloadedRegistry.assets['asset-original'].metadata).toBeDefined();
      expect(reloadedRegistry.assets['asset-original'].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'abcdef1234567890',
        size: 14,
      });
      expect(reloadedRegistry.assets['asset-original'].metadata.enrichment).toEqual({
        pending: 1,
        failed: 0,
        claims: [
          {
            claimId: 'claim-authoring-1',
            parserId: 'com.example.authoring-loop',
            timestamp: '2026-06-19T10:00:00.000Z',
            field: 'description',
            summary: 'Authoring loop enrichment claim',
          },
        ],
      });
      expect(reloadedRegistry.assets['asset-original'].metadata.extensions).toEqual({
        'com.example.authoring-loop': { analyzed: true, score: 0.95 },
      });
      expect(reloadedRegistry.assets['asset-second']).toBeDefined();
      expect(reloadedRegistry.assets['asset-second'].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'deadbeef9999',
        size: 50,
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // T26: End-to-end M6 workflow — parser + compile-only export + stub
    //       search provider + asset ingestion + Astrid reload + metadata/search
    //       UI state + deterministic metadata export artifact
    // -----------------------------------------------------------------------
    it('registers a parser, compile-only export, and stub search provider; ingests an asset; persists metadata through Astrid reload; renders metadata/search UI state; and exports a deterministic artifact', async () => {
      const timelineRef = '01JM4K5N7P00000000000000E2E';

      // ---- 1. Create file system tree with assembly.json, registry.json, and assets ----
      const localTree = createFileSystemHandleTree({
        'project.json': JSON.stringify({ slug: 'ados-talks' }),
        [`timelines/${timelineRef}/assembly.json`]: JSON.stringify({
          clips: [],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        }),
        [`timelines/${timelineRef}/registry.json`]: JSON.stringify({
          assets: {
            'asset-initial': {
              file: 'clips/initial.mp4',
              type: 'video/mp4',
              duration: 3,
            },
          },
        }),
        'sources/clips/initial.mp4': new Blob(['initial-video'], { type: 'video/mp4' }),
      });
      vi.mocked(getDirectoryHandle).mockResolvedValue(localTree.projectRootHandle);

      // ---- 2. Register a parser that produces integrity + provenance + enrichment + extensions ----
      const parser = makeMockParser(
        'com.example.e2e.integrity-parser',
        'com.example.e2e',
        {
          acceptMimeTypes: ['video/mp4'],
        },
      );

      const enrichedEntry = {
        file: 'clips/initial.mp4',
        type: 'video/mp4',
        duration: 3,
        metadata: {
          integrity: { algorithm: 'sha256', hash: 'e2e-hash-abcdef1234567890', size: 14 },
          provenance: { importedAt: '2026-06-19T12:00:00.000Z', source: 'e2e-test', importedBy: 'e2e-runner' },
          enrichment: {
            pending: 1,
            failed: 0,
            claims: [
              {
                claimId: 'e2e-claim-1',
                parserId: 'com.example.e2e',
                timestamp: '2026-06-19T12:00:00.000Z',
                field: 'description',
                summary: 'E2E test enrichment claim',
              },
            ],
          },
          extensions: {
            'com.example.e2e': { parsedBy: 'e2e-parser', version: 1, tags: ['e2e', 'test'] },
          },
        },
      };

      vi.mocked(enrichRegistryEntryWithParsers).mockResolvedValue({
        entry: enrichedEntry,
        diagnostics: [
          {
            severity: 'info',
            code: 'parser/claim-enqueued',
            message: 'E2E parser produced enrichment claim.',
            extensionId: 'com.example.e2e',
            contributionId: 'com.example.e2e.integrity-parser',
          },
        ],
        blocked: false,
      });

      const registerAssetSpy = vi.spyOn(AstridBridgeDataProvider.prototype, 'registerAsset')
        .mockResolvedValue(undefined);

      // ---- 3. Create provider with registered parsers and upload an asset ----
      const provider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
        registeredParsers: [parser],
      });

      const result = await provider.uploadAsset(
        new File(['e2e-video-data'], 'initial.mp4', { type: 'video/mp4' }),
        { timelineId: timelineRef, userId: 'e2e-runner' },
      );

      // ---- 4. Assert parser enrichment was called and result carries enriched metadata ----
      expect(enrichRegistryEntryWithParsers).toHaveBeenCalled();
      expect(result.entry.metadata).toBeDefined();
      expect(result.entry.metadata.integrity.hash).toBe('e2e-hash-abcdef1234567890');
      expect(result.entry.metadata.provenance.source).toBe('e2e-test');
      expect(result.entry.metadata.enrichment.claims).toHaveLength(1);
      expect(result.entry.metadata.extensions['com.example.e2e']).toEqual({
        parsedBy: 'e2e-parser',
        version: 1,
        tags: ['e2e', 'test'],
      });

      // ---- 5. Save timeline to persist the enriched metadata ----
      const version = await provider.saveTimeline(
        timelineRef,
        {
          output: { resolution: '1920x1080', fps: 30, file: 'e2e-output.mp4' },
          clips: [],
          tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        },
        1,
        {
          assets: {
            'asset-initial': enrichedEntry,
          },
        },
      );
      expect(version).toBeGreaterThanOrEqual(1);

      // Verify on-disk registry.json contains the enriched metadata
      const savedRegistryRaw = String(localTree.files[`timelines/${timelineRef}/registry.json`]);
      const savedRegistry = JSON.parse(savedRegistryRaw);
      expect(savedRegistry.assets['asset-initial'].metadata.integrity.hash).toBe('e2e-hash-abcdef1234567890');
      expect(savedRegistry.assets['asset-initial'].metadata.provenance.source).toBe('e2e-test');
      expect(savedRegistry.assets['asset-initial'].metadata.extensions['com.example.e2e']).toEqual({
        parsedBy: 'e2e-parser',
        version: 1,
        tags: ['e2e', 'test'],
      });
      expect(savedRegistryRaw).not.toContain('handler');
      expect(savedRegistryRaw).not.toContain('makeMockParser');

      // ---- 6. Simulate Astrid reload: fresh provider loads from local files ----
      const reloadedProvider = new AstridBridgeDataProvider({
        projectSlug: 'ados-talks',
        timelineRef,
        timelineId: timelineRef,
      });

      const reloadedRegistry = await reloadedProvider.loadAssetRegistry(timelineRef);

      // Assert enriched metadata survived the reload
      expect(reloadedRegistry.assets['asset-initial']).toBeDefined();
      expect(reloadedRegistry.assets['asset-initial'].metadata).toBeDefined();
      expect(reloadedRegistry.assets['asset-initial'].metadata.integrity).toEqual({
        algorithm: 'sha256',
        hash: 'e2e-hash-abcdef1234567890',
        size: 14,
      });
      expect(reloadedRegistry.assets['asset-initial'].metadata.provenance).toEqual({
        importedAt: '2026-06-19T12:00:00.000Z',
        source: 'e2e-test',
        importedBy: 'e2e-runner',
      });
      expect(reloadedRegistry.assets['asset-initial'].metadata.enrichment.pending).toBe(1);
      expect(reloadedRegistry.assets['asset-initial'].metadata.enrichment.failed).toBe(0);
      expect(reloadedRegistry.assets['asset-initial'].metadata.enrichment.claims).toHaveLength(1);
      expect(reloadedRegistry.assets['asset-initial'].metadata.extensions['com.example.e2e']).toEqual({
        parsedBy: 'e2e-parser',
        version: 1,
        tags: ['e2e', 'test'],
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();

      // ---- 7. Metadata/search UI state assertions (data-level) ----
      // Verify hasSearchableMetadata returns true for host-owned fields
      expect(hasSearchableMetadata(reloadedRegistry.assets['asset-initial'])).toBe(true);

      // Verify shouldShowMetadataSearch returns true when registry has searchable metadata
      expect(shouldShowMetadataSearch(reloadedRegistry.assets)).toBe(true);

      // ---- 8. Stub search provider result integration ----
      const stubProviderResult: SearchProviderResultEnvelope = {
        providerId: 'com.example.e2e.search',
        providerLabel: 'E2E Search Provider',
        providerOrder: 10,
        result: {
          matches: [
            { ref: 'asset-initial', kind: 'asset', score: 0.85, excerpt: 'E2E semantic match' },
            { ref: 'mat-1', kind: 'material', score: 0.75, excerpt: 'Material match from e2e' },
          ],
          totalCount: 2,
          hasMore: false,
          diagnostics: [],
        },
      };

      const mergedResults = mergeSearchProviderResults(
        reloadedRegistry.assets,
        'e2e-hash',
        [stubProviderResult],
      );

      // Assert merge ordering: built-in metadata filter match scores highest
      expect(mergedResults.matches.length).toBeGreaterThanOrEqual(1);
      const assetMatch = mergedResults.matches.find(m => m.ref === 'asset-initial');
      expect(assetMatch).toBeDefined();
      // Built-in metadata filter matches the integrity hash text, so score should be 1.0
      if (assetMatch) {
        expect(assetMatch.matchSource).toBe('metadata-filter');
        expect(assetMatch.score).toBe(1.0);
        expect(assetMatch.sourceProviderId).toBe('__host__');
      }

      // Provider match for the same asset should be present as well
      const providerMatches = mergedResults.matches.filter(m => m.sourceProviderId === 'com.example.e2e.search');
      expect(providerMatches.length).toBeGreaterThanOrEqual(1);

      // Material match should be present
      const matMatch = mergedResults.matches.find(m => m.ref === 'mat-1');
      expect(matMatch).toBeDefined();
      if (matMatch) {
        expect(matMatch.kind).toBe('material');
        expect(matMatch.excerpt).toBe('Material match from e2e');
      }

      // Diagnostics should be empty (no provider errors)
      expect(mergedResults.diagnostics).toEqual([]);

      // ---- 9. Compile-only metadata export artifact ----
      // Build a compile-only output format handler that serializes the asset metadata to JSON
      const exportHandler: OutputFormatHandler = (ctx: OutputFormatContext): CompileOnlyOutputResult => {
        const assetsObj: Record<string, unknown> = {};
        ctx.assets.forEach((meta, key) => {
          assetsObj[key] = {
            integrity: meta.integrity ?? null,
            provenance: meta.provenance ?? null,
            consent: meta.consent ?? null,
            enrichment: meta.enrichment ?? null,
            extensions: meta.extensions ?? null,
          };
        });

        const exportDoc = {
          exportInfo: {
            format: 'metadata-json',
            version: '1.0.0',
            extensionId: ctx.extensionId,
            contributionId: ctx.contributionId,
            exportedAt: '2026-06-19T12:00:00.000Z',
          },
          timeline: {
            projectId: ctx.timeline.projectId,
            baseVersion: ctx.timeline.baseVersion,
            currentVersion: ctx.timeline.currentVersion,
            assetKeys: ctx.timeline.assetKeys,
          },
          assets: assetsObj,
        };

        const json = JSON.stringify(exportDoc);
        return {
          data: new TextEncoder().encode(json),
          mimeType: 'application/json',
          filename: 'metadata-export.json',
          hasBlockingErrors: false,
        };
      };

      const exportContribution: OutputFormatContribution = {
        id: 'com.example.e2e.metadata-json',
        kind: 'outputFormat',
        label: 'E2E Metadata JSON Export',
        requiresRender: false,
        outputExtension: 'json',
        outputMimeType: 'application/json',
        description: 'Deterministic metadata JSON export for e2e test',
        order: 0,
      };

      const registry = createCompileOnlyOutputFormatRegistry([
        {
          contribution: exportContribution,
          handler: exportHandler,
          extensionId: 'com.example.e2e',
          extensionVersion: '1.0.0',
        },
      ]);

      const timelineSnapshot: TimelineSnapshot = {
        projectId: timelineRef,
        baseVersion: 1,
        currentVersion: version,
        extensionRequirements: [],
        clips: [],
        tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
        assetKeys: ['asset-initial'],
        app: {},
      };

      const assetsMap: ReadonlyMap<string, Readonly<AssetMetadata>> = new Map(
        Object.entries(reloadedRegistry.assets).map(([key, entry]) => [key, Object.freeze(entry.metadata ?? {})]),
      );

      const exportResult = executeCompileOnlyOutputSync(registry, {
        formatId: 'com.example.e2e.metadata-json',
        timeline: timelineSnapshot,
        assets: assetsMap,
        extensionId: 'com.example.e2e',
        extensionVersion: '1.0.0',
      });

      // Assert compile-only export succeeded
      expect(exportResult).not.toBeNull();
      expect(exportResult!.hasBlockingErrors).toBe(false);

      // Parse the exported JSON artifact
      const exportedJson = JSON.parse(new TextDecoder().decode(exportResult!.data));
      expect(exportedJson.exportInfo.format).toBe('metadata-json');
      expect(exportedJson.exportInfo.extensionId).toBe('com.example.e2e');
      expect(exportedJson.timeline.assetKeys).toEqual(['asset-initial']);
      expect(exportedJson.assets['asset-initial']).toBeDefined();

      // Assert the enriched metadata is present in the export artifact
      expect(exportedJson.assets['asset-initial'].integrity).toEqual({
        algorithm: 'sha256',
        hash: 'e2e-hash-abcdef1234567890',
        size: 14,
      });
      expect(exportedJson.assets['asset-initial'].provenance).toEqual({
        importedAt: '2026-06-19T12:00:00.000Z',
        source: 'e2e-test',
        importedBy: 'e2e-runner',
      });
      expect(exportedJson.assets['asset-initial'].enrichment.pending).toBe(1);
      expect(exportedJson.assets['asset-initial'].enrichment.claims).toHaveLength(1);
      expect(exportedJson.assets['asset-initial'].extensions).toEqual({
        'com.example.e2e': { parsedBy: 'e2e-parser', version: 1, tags: ['e2e', 'test'] },
      });

      // Assert determinism: two exports produce byte-identical results
      const exportResult2 = executeCompileOnlyOutputSync(registry, {
        formatId: 'com.example.e2e.metadata-json',
        timeline: timelineSnapshot,
        assets: assetsMap,
        extensionId: 'com.example.e2e',
        extensionVersion: '1.0.0',
      });
      expect(exportResult2).not.toBeNull();
      const json1 = new TextDecoder().decode(exportResult!.data);
      const json2 = new TextDecoder().decode(exportResult2!.data);
      expect(json1).toBe(json2);

      // Cleanup
      registerAssetSpy.mockRestore();
    });

  });

});
