import { describe, expect, it } from 'vitest';
import { createDefaultTimelineConfig } from '@tbd/schema';
import { TimelineVersionConflictError } from './DataProvider';
import { InMemoryDataProvider } from './InMemoryDataProvider';

describe('InMemoryDataProvider', () => {
  it('loads and saves timelines with optimistic versions', async () => {
    const provider = new InMemoryDataProvider({
      demo: {
        config: createDefaultTimelineConfig(),
      },
    });

    const loaded = await provider.loadTimeline('demo');
    expect(loaded.configVersion).toBe(1);

    const nextVersion = await provider.saveTimeline('demo', loaded.config, loaded.configVersion, { assets: {} });
    expect(nextVersion).toBe(2);
  });

  it('throws a version conflict on stale saves', async () => {
    const provider = new InMemoryDataProvider({
      demo: {
        config: createDefaultTimelineConfig(),
      },
    });

    await expect(provider.saveTimeline('demo', createDefaultTimelineConfig(), 0)).rejects.toBeInstanceOf(TimelineVersionConflictError);
  });
});
