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
  function mockLoadTimelineTables(timelinesQuerySelect: (columns: string) => unknown) {
    const timelineHeadQuery = mockTimelineHeadSelect(7);
    const syncBookmarkQuery = mockSyncBookmarkSelect();
    mocks.from.mockImplementation((table: string) => {
      if (table === 'timelines') return { select: timelinesQuerySelect };
      if (table === 'timeline_events') return { select: timelineHeadQuery.select };
      if (table === 'sync_bookmarks') return { select: syncBookmarkQuery.select };
      throw new Error(`Unexpected table: ${table}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', createFakeIndexedDB());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubEnv('VITE_REIGH_APPEND_SERVICE_URL', 'https://append-service.example/');
    (import.meta.env as Record<string, string | undefined>).VITE_REIGH_APPEND_SERVICE_URL =
      'https://append-service.example/';
    mocks.readAccessTokenFromStorage.mockReturnValue('cached-user-jwt');
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'session-user-jwt' } },
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  it('save with bundle posts the bundle alongside config and registry', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          config_version: 9,
          db_head: {
            version: 9,
            hash: 'b'.repeat(64),
            event_id: '01ARZ3NDEKTSV4RRFFQ69G5FBB',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const envelope = makeEnvelope();

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-123' });
    const nextVersion = await provider.saveTimeline('timeline-1', config1, 8, registry1, envelope);

    expect(nextVersion).toBe(9);
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.bundle).toEqual(envelope);
  });

  it('save with a valid bundle and stale expectedVersion still rejects with TimelineVersionConflictError', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'version_conflict',
          detail: 'timeline config_version mismatch: expected 8, found 12',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-123' });
    await expect(
      provider.saveTimeline('timeline-1', config1, 8, registry1, makeEnvelope()),
    ).rejects.toBeInstanceOf(TimelineVersionConflictError);
  });

  it('load with a corrupt data_bundle column yields bundle null and keeps config intact', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timelinesQuery = mockTimelinesSelect(config1, 7);
    (timelinesQuery.maybeSingle as { mockResolvedValue: (value: unknown) => unknown }).mockResolvedValue({
      data: {
        config: config1,
        config_version: 7,
        asset_registry: { assets: {} },
        data_bundle: { garbage: true },
      },
      error: null,
    });
    mockLoadTimelineTables(timelinesQuery.select);

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const loaded = await provider.loadTimeline('timeline-1');

    expect(loaded.config).toBeDefined();
    expect(loaded.configVersion).toBe(7);
    expect(loaded.bundle).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith('[SupabaseDataProvider] ignoring unparsable data_bundle', expect.anything());
    warnSpy.mockRestore();
  });
});
