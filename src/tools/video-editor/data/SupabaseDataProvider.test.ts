import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider';

const mocks = vi.hoisted(() => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: (...args: unknown[]) => mocks.getSupabaseClient(...args),
}));

type QueryChain<T> = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle?: ReturnType<typeof vi.fn>;
  order?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  neq?: ReturnType<typeof vi.fn>;
  lt?: ReturnType<typeof vi.fn>;
} & PromiseLike<{ data: T; error: unknown }>;

function buildMaybeSingleChain<T>(data: T, error: unknown = null): QueryChain<T> {
  const response = Promise.resolve({ data, error });
  const chain = {
    then: response.then.bind(response),
    catch: response.catch.bind(response),
    finally: response.finally.bind(response),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
  };
  return chain;
}

function buildOrderChain<T>(data: T, error: unknown = null): QueryChain<T> {
  const response = Promise.resolve({ data, error });
  const chain = {
    then: response.then.bind(response),
    catch: response.catch.bind(response),
    finally: response.finally.bind(response),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
  };
  return chain;
}

function buildDeleteChain(error: unknown = null): QueryChain<null> {
  const response = Promise.resolve({ data: null, error });
  const chain = {
    then: response.then.bind(response),
    catch: response.catch.bind(response),
    finally: response.finally.bind(response),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    lt: vi.fn(() => chain),
  };
  return chain;
}

describe('SupabaseDataProvider ingress canonicalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('canonicalizes legacy timeline loads before validation', async () => {
    const legacyConfig = {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 1 }],
      pinnedShotGroups: [{
        shotId: 'shot-1',
        trackId: 'V1',
        clipIds: ['clip-1'],
        mode: 'images',
      }],
    };

    const from = vi.fn((table: string) => {
      if (table === 'timelines') {
        return buildMaybeSingleChain({
          config: legacyConfig,
          config_version: 4,
        });
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.getSupabaseClient.mockReturnValue({ from });

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const loaded = await provider.loadTimeline('timeline-1');

    expect(loaded.configVersion).toBe(4);
    expect(loaded.config.app).toEqual({
      'x-reigh': {
        pinnedShotGroups: legacyConfig.pinnedShotGroups,
      },
    });
    expect(loaded.config.pinnedShotGroups).toEqual(legacyConfig.pinnedShotGroups);
  });

  it('canonicalizes checkpoint loads before history restore sees them', async () => {
    const legacyCheckpointConfig = {
      output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
      clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 1 }],
      pinnedShotGroups: [{
        shotId: 'shot-2',
        trackId: 'V1',
        clipIds: ['clip-1'],
        mode: 'images',
      }],
    };

    const cleanupChain = buildDeleteChain();
    const rowsChain = buildOrderChain([
      {
        id: 'checkpoint-1',
        timeline_id: 'timeline-1',
        config: legacyCheckpointConfig,
        created_at: '2026-04-20T10:00:00.000Z',
        trigger_type: 'manual',
        label: 'Manual checkpoint',
        edits_since_last_checkpoint: 0,
      },
    ]);

    const from = vi.fn((table: string) => {
      if (table !== 'timeline_checkpoints') {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        delete: cleanupChain.delete,
        eq: vi.fn(() => ({
          neq: cleanupChain.neq,
          order: rowsChain.order,
        })),
        select: rowsChain.select,
      };
    });

    const deleteChain = {
      delete: cleanupChain.delete,
      eq: cleanupChain.eq,
      neq: cleanupChain.neq,
      lt: cleanupChain.lt,
    };
    const selectChain = {
      select: rowsChain.select,
      eq: rowsChain.eq,
      order: rowsChain.order,
    };

    from.mockImplementationOnce(() => deleteChain as never);
    from.mockImplementationOnce(() => selectChain as never);
    mocks.getSupabaseClient.mockReturnValue({ from });

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const checkpoints = await provider.loadCheckpoints('timeline-1');

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].config.app).toEqual({
      'x-reigh': {
        pinnedShotGroups: legacyCheckpointConfig.pinnedShotGroups,
      },
    });
    expect(checkpoints[0].config.pinnedShotGroups).toEqual(legacyCheckpointConfig.pinnedShotGroups);
  });
});
