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
