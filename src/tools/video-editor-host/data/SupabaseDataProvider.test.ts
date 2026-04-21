import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPinnedShotGroups,
  getTimelineAppNamespace,
  REIGH_TIMELINE_APP_NAMESPACE,
  setPinnedShotGroups,
} from '@/tools/video-editor/lib/config-utils';
import type { TimelineConfig } from '@/tools/video-editor/types';
import { SupabaseDataProvider } from './SupabaseDataProvider';

const getSupabaseClientMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => getSupabaseClientMock(),
}));

const makeLegacyConfig = (): TimelineConfig => ({
  output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
  tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
  clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
  pinnedShotGroups: [{
    shotId: 'shot-1',
    trackId: 'V1',
    clipIds: ['clip-1'],
    mode: 'images',
  }],
} as unknown as TimelineConfig);

const makeNamespacedConfig = (): TimelineConfig => setPinnedShotGroups(
  {
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [{ id: 'clip-1', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
  },
  [{
    shotId: 'shot-1',
    trackId: 'V1',
    clipIds: ['clip-1'],
    mode: 'images',
  }],
);

describe('video-editor-host SupabaseDataProvider', () => {
  beforeEach(() => {
    getSupabaseClientMock.mockReset();
  });

  it('repairs legacy top-level pinnedShotGroups when loading timelines', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { config: makeLegacyConfig(), config_version: 7 },
      error: null,
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    getSupabaseClientMock.mockReturnValue({ from });

    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const loaded = await provider.loadTimeline('timeline-1');

    expect(from).toHaveBeenCalledWith('timelines');
    expect(loaded.configVersion).toBe(7);
    expect(getPinnedShotGroups(loaded.config)).toEqual([{
      shotId: 'shot-1',
      trackId: 'V1',
      clipIds: ['clip-1'],
      mode: 'images',
    }]);
    expect(Object.prototype.hasOwnProperty.call(loaded.config, 'pinnedShotGroups')).toBe(false);
    expect(getTimelineAppNamespace(loaded.config, REIGH_TIMELINE_APP_NAMESPACE)?.pinnedShotGroups).toEqual(
      getPinnedShotGroups(loaded.config),
    );
  });

  it('rejects saveTimeline configs that still use top-level pinnedShotGroups', async () => {
    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });

    await expect(provider.saveTimeline('timeline-1', makeLegacyConfig(), 3)).rejects.toThrow(/unrecognized key/i);
    expect(getSupabaseClientMock).not.toHaveBeenCalled();
  });

  it('rejects saveCheckpoint configs that still use top-level pinnedShotGroups', async () => {
    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });

    await expect(provider.saveCheckpoint('timeline-1', {
      timelineId: 'timeline-1',
      config: makeLegacyConfig(),
      createdAt: '2026-04-20T00:00:00.000Z',
      triggerType: 'semantic',
      label: 'Autosave',
      editsSinceLastCheckpoint: 1,
    })).rejects.toThrow(/unrecognized key/i);
    expect(getSupabaseClientMock).not.toHaveBeenCalled();
  });

  it('passes namespaced pinnedShotGroups through saveTimeline unchanged', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ config_version: 8 }], error: null });
    getSupabaseClientMock.mockReturnValue({ rpc });
    const provider = new SupabaseDataProvider({ projectId: 'project-1', userId: 'user-1' });
    const config = makeNamespacedConfig();

    await expect(provider.saveTimeline('timeline-1', config, 7)).resolves.toBe(8);

    expect(rpc).toHaveBeenCalledWith('update_timeline_config_versioned', {
      p_timeline_id: 'timeline-1',
      p_expected_version: 7,
      p_config: config,
    });
  });
});
