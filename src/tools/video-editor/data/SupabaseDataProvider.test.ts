import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDB, IDBKeyRange } from 'fake-indexeddb';
import { SupabaseDataProvider } from './SupabaseDataProvider.ts';

(globalThis as Record<string, unknown>).indexedDB = createFakeIndexedDB();
(globalThis as Record<string, unknown>).IDBKeyRange = IDBKeyRange;

const config = {
  output: { fps: 24, width: 1920, height: 1080 },
  tracks: [],
  clips: [],
};
const registry = { assets: { hero: { file: 'hero.mp4', type: 'video/mp4' } } };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SupabaseDataProvider Phase C compatibility wrapper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).indexedDB = createFakeIndexedDB();
  });

  it('declares only Astrid-backed capabilities', () => {
    const provider = new SupabaseDataProvider({ projectId: 'demo', userId: 'fixed-user' });
    expect(provider.supportsEditorSync).toBe(false);
    expect(provider.supportsDirectAssetUpload).toBe(true);
    expect('createExtensionPersistenceService' in provider).toBe(false);
  });

  it('loads the timeline and registry through the frozen bridge route', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json({
      timeline_id: 'tl-1',
      timeline_ulid: 'tl-1',
      name: 'Main',
      config,
      config_version: 7,
      registry,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SupabaseDataProvider({ projectId: 'demo project', userId: 'fixed-user' });

    const loaded = await provider.loadTimeline('tl-1');
    expect(loaded.configVersion).toBe(7);
    expect(loaded.config.output).toMatchObject({ fps: 24, resolution: '1280x720' });
    await expect(provider.loadAssetRegistry('tl-1')).resolves.toEqual(registry);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/astrid/projects/demo%20project/timelines/tl-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves with the expected bridge CAS version and registry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ timeline_id: 'tl-1', timeline_ulid: 'tl-1', config, config_version: 3, registry }))
      .mockResolvedValueOnce(json({ timeline_id: 'tl-1', timeline_ulid: 'tl-1', config, config_version: 4, registry }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SupabaseDataProvider({ projectId: 'demo', userId: 'fixed-user' });

    await expect(provider.saveTimeline('tl-1', config, 3, registry)).resolves.toBe(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/astrid/projects/demo/timelines/tl-1/save',
      expect.objectContaining({
        method: 'POST',
        // Astrid persists the authored source lane only. Render output is
        // host-derived and is re-materialized from defaults on load.
        body: JSON.stringify({
          config: { tracks: config.tracks, clips: config.clips },
          registry,
          expected_version: 3,
        }),
      }),
    );
  });

  it('rejects retired cloud sync and pre-load relative URL resolution explicitly', async () => {
    const provider = new SupabaseDataProvider({ projectId: 'demo', userId: 'fixed-user' });
    await expect(provider.syncTimeline({
      timelineId: 'tl-1',
      config,
      currentConfigVersion: 1,
      hasUnsavedEdits: false,
    })).rejects.toMatchObject({ code: 'capability_unavailable' });
    await expect(provider.resolveAssetUrl('relative.mp4')).rejects.toMatchObject({ code: 'capability_unavailable' });
    await expect(provider.resolveAssetUrl('https://example.test/a.mp4')).resolves.toBe('https://example.test/a.mp4');
  });
});
