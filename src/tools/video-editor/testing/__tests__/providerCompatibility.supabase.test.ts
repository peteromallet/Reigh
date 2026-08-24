import { describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDB, IDBKeyRange } from 'fake-indexeddb';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider.ts';
import { TimelineVersionConflictError } from '@/sdk/video/timeline/errors.ts';

(globalThis as Record<string, unknown>).indexedDB = createFakeIndexedDB();
(globalThis as Record<string, unknown>).IDBKeyRange = IDBKeyRange;

const config = { output: { fps: 24, width: 1280, height: 720 }, tracks: [], clips: [] };
const registry = { assets: {} };

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('retired Supabase provider bridge compatibility', () => {
  it('preserves versioned load/save and canonical conflict semantics', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ timeline_id: 'tl', timeline_ulid: 'tl', config, registry, config_version: 9 }))
      .mockResolvedValueOnce(response({
        error: 'timeline_version_conflict',
        detail: 'stale head',
        config_version: 10,
      }, 409));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SupabaseDataProvider({ projectId: 'p', userId: 'u' });

    const loaded = await provider.loadTimeline('tl');
    expect(loaded.configVersion).toBe(9);
    expect(loaded.config.output).toMatchObject({ fps: 24, resolution: '1280x720' });
    await expect(provider.saveTimeline('tl', config, 9, registry)).rejects.toBeInstanceOf(TimelineVersionConflictError);
  });

  it('never advertises retired cloud extension persistence', () => {
    const provider = new SupabaseDataProvider({ projectId: 'p', userId: 'u' });
    expect('createExtensionPersistenceService' in provider).toBe(false);
    expect(provider.supportsEditorSync).toBe(false);
  });
});

describe('data bundle persistence (compat)', () => {
  const makeItem = (overrides: Record<string, unknown> = {}) => ({
    id: 'assetA:src:0',
    shape: 'interval',
    domain: 'source_seconds',
    extent: { start: 0, end: 1.5 },
    schemaRef: 'reigh.transcript_segment/v1',
    payload: { text: 'hello' },
    sourceArtifactRef: { assetId: 'assetA' },
    provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
    ...overrides,
  });
  const makeEnvelope = () => ({
    schema_version: 1 as const,
    itemsBySchemaRef: {
      'reigh.transcript_segment/v1': [makeItem()],
    },
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', createFakeIndexedDB());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal('fetch', vi.fn());
  });

  it('save with bundle posts the bundle alongside config and registry', async () => {
    const envelope = makeEnvelope();
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        timeline_id: 'timeline-1',
        timeline_ulid: 'timeline-1',
        slug: 'timeline-1',
        name: 'Timeline 1',
        config,
        registry,
        config_version: 8,
      }))
      .mockResolvedValueOnce(response({
        timeline_id: 'timeline-1',
        timeline_ulid: 'timeline-1',
        slug: 'timeline-1',
        name: 'Timeline 1',
        config,
        registry,
        config_version: 9,
        bundle: envelope,
      }));

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-123' });
    const nextVersion = await provider.saveTimeline('timeline-1', config, 8, registry, envelope);

    expect(nextVersion).toBe(9);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[1];
    const body = JSON.parse(String(init?.body));
    expect(body.bundle).toEqual(envelope);
  });

  it('save with a valid bundle and stale expectedVersion still rejects with TimelineVersionConflictError', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(response({
        timeline_id: 'timeline-1',
        timeline_ulid: 'timeline-1',
        slug: 'timeline-1',
        name: 'Timeline 1',
        config,
        registry,
        config_version: 8,
      }))
      .mockResolvedValueOnce(response({
        error: 'timeline_version_conflict',
        detail: 'stale head',
        config_version: 12,
      }, 409));

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-123' });
    await expect(
      provider.saveTimeline('timeline-1', config, 8, registry, makeEnvelope()),
    ).rejects.toBeInstanceOf(TimelineVersionConflictError);
  });

  it('loads the bundle only from the bridge response', async () => {
    const envelope = makeEnvelope();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      response({
        timeline_id: 'timeline-1',
        timeline_ulid: 'timeline-1',
        slug: 'timeline-1',
        name: 'Timeline 1',
        config,
        registry,
        config_version: 7,
        bundle: envelope,
      }),
    );
    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const loaded = await provider.loadTimeline('timeline-1');

    expect(loaded.config).toBeDefined();
    expect(loaded.configVersion).toBe(7);
    expect(loaded.bundle).toEqual(envelope);
  });
});
