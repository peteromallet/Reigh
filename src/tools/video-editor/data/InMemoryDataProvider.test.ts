import { describe, expect, it } from 'vitest';
import {
  TimelineVersionConflictError,
  isTimelineVersionConflictError,
} from '@reigh/editor-sdk';
import {
  InMemoryDataProvider,
  createLocalAssetResolver,
} from '@/tools/video-editor/lib/browser-runtime';
import {
  TimelineNotFoundError,
  type TimelineConfig,
} from '@/tools/video-editor';
import {
  TimelineBundleParseError,
  parseTimelineBundle,
  type TimelineBundleEnvelope,
} from '@/tools/video-editor/data/typed/timelineBundle';

function buildConfig(): TimelineConfig {
  return {
    output: {
      resolution: '1920x1080',
      fps: 30,
      file: 'timeline.mp4',
    },
    tracks: [
      { id: 'V1', kind: 'visual', label: 'V1' },
    ],
    clips: [],
  };
}

describe('InMemoryDataProvider', () => {
  it('loads, saves, checkpoints, and registers assets with optimistic versioning', async () => {
    const provider = new InMemoryDataProvider({
      timelines: {
        'timeline-1': {
          config: buildConfig(),
          registry: { assets: {} },
        },
      },
    });

    const initial = await provider.loadTimeline('timeline-1');
    expect(initial.configVersion).toBe(1);

    const nextVersion = await provider.saveTimeline('timeline-1', {
      ...initial.config,
      clips: [{
        id: 'clip-1',
        clipType: 'media',
        track: 'V1',
        at: 0,
        hold: 5,
      }],
    }, initial.configVersion, { assets: {} });
    expect(nextVersion).toBe(2);

    const checkpointId = await provider.saveCheckpoint?.('timeline-1', {
      timelineId: 'timeline-1',
      config: initial.config,
      createdAt: new Date('2026-05-04T00:00:00.000Z').toISOString(),
      triggerType: 'manual',
      label: 'Manual checkpoint',
      editsSinceLastCheckpoint: 1,
    });
    expect(checkpointId).toBeTruthy();
    expect(await provider.loadCheckpoints?.('timeline-1')).toHaveLength(1);

    await provider.registerAsset?.('timeline-1', 'asset-1', {
      file: 'clips/demo.mp4',
      type: 'video/mp4',
      duration: 4,
    });

    const registry = await provider.loadAssetRegistry('timeline-1');
    expect(registry.assets['asset-1']).toEqual(expect.objectContaining({
      file: 'clips/demo.mp4',
      type: 'video/mp4',
      duration: 4,
    }));
  });

  it('throws the public not-found and conflict errors', async () => {
    const provider = new InMemoryDataProvider({
      timelines: {
        'timeline-1': {
          config: buildConfig(),
        },
      },
    });

    await expect(provider.loadTimeline('missing')).rejects.toBeInstanceOf(TimelineNotFoundError);
    await expect(provider.saveTimeline('timeline-1', buildConfig(), 999)).rejects.toBeInstanceOf(TimelineVersionConflictError);
    await expect(provider.saveTimeline('timeline-1', buildConfig(), 999)).rejects.toSatisfy(isTimelineVersionConflictError);
  });

  it('supports local/file asset resolution through the public resolver seam', async () => {
    const resolver = createLocalAssetResolver({ assetRoot: 'https://cdn.example/assets/' });
    const provider = new InMemoryDataProvider({
      timelines: {
        'timeline-1': {
          config: buildConfig(),
        },
      },
      resolveAssetUrl: resolver.resolveAssetUrl,
    });

    await expect(provider.resolveAssetUrl('video/demo.mp4')).resolves.toBe('https://cdn.example/assets/video/demo.mp4');
    await expect(provider.resolveAssetUrl('https://example.com/absolute.mp4')).resolves.toBe('https://example.com/absolute.mp4');
  });

  // -------------------------------------------------------------------------
  // Strict expectedVersion conflict handling (T14)
  // -------------------------------------------------------------------------
  describe('strict expectedVersion conflict handling', () => {
    it('rejects save when expectedVersion is behind the current version by 1', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig() } },
      });

      // First save succeeds with correct version
      const v2 = await provider.saveTimeline('timeline-1', buildConfig(), 1);
      expect(v2).toBe(2);

      // Stale (version 1) is now behind — must reject
      await expect(
        provider.saveTimeline('timeline-1', buildConfig(), 1),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);
    });

    it('rejects save when expectedVersion is behind by more than 1', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig() } },
      });

      // Advance to version 3
      await provider.saveTimeline('timeline-1', buildConfig(), 1); // → 2
      await provider.saveTimeline('timeline-1', buildConfig(), 2); // → 3

      // Stale (version 1, now behind by 2) must reject
      await expect(
        provider.saveTimeline('timeline-1', buildConfig(), 1),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);
    });

    it('rejects save when expectedVersion is ahead of the current version', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig() } },
      });

      // Current version is 1; expected version 5 is ahead — must reject
      await expect(
        provider.saveTimeline('timeline-1', buildConfig(), 5),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);
    });

    it('does NOT mutate stored config when a version conflict is thrown', async () => {
      const originalConfig = buildConfig();
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: originalConfig } },
      });

      // Advance to version 2 with a modified config
      const modifiedConfig = {
        ...buildConfig(),
        clips: [{ id: 'clip-1', clipType: 'hold' as const, track: 'V1', at: 0, hold: 3 }],
      };
      await provider.saveTimeline('timeline-1', modifiedConfig, 1);

      // Now try to save with stale version — must throw and NOT overwrite
      const conflictConfig = {
        ...buildConfig(),
        clips: [{ id: 'clip-evil', clipType: 'hold' as const, track: 'V1', at: 99, hold: 1 }],
      };
      await expect(
        provider.saveTimeline('timeline-1', conflictConfig, 1),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);

      // Reload — must see the config from the successful save, not the conflict payload
      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.configVersion).toBe(2);
      expect(loaded.config.clips).toHaveLength(1);
      expect(loaded.config.clips[0].id).toBe('clip-1');
    });

    it('monotonically increments version by exactly 1 on each successful save', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig() } },
      });

      let version = 1;
      for (let i = 0; i < 5; i++) {
        const next = await provider.saveTimeline('timeline-1', buildConfig(), version);
        expect(next).toBe(version + 1);
        version = next;
      }

      expect(version).toBe(6);
    });

    it('returns the new version on successful save independent of the config payload', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig(), configVersion: 3 } },
      });

      const v4 = await provider.saveTimeline('timeline-1', buildConfig(), 3);
      expect(v4).toBe(4);

      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.configVersion).toBe(4);
    });

    it('loadTimeline returns the current version after multiple saves', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig() } },
      });

      await provider.saveTimeline('timeline-1', buildConfig(), 1); // → 2
      await provider.saveTimeline('timeline-1', buildConfig(), 2); // → 3

      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.configVersion).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Local monotonic stale invalidation behavior (T14)
  // -------------------------------------------------------------------------
  describe('local monotonic stale invalidation behavior', () => {
    it('provider-level CAS catches stale writes before any data mutation occurs', async () => {
      // This test demonstrates that the InMemoryDataProvider's strict
      // compare-and-swap on saveTimeline is the second line of defence.
      // The first line is useTimelineOps.apply() which checks patch.version
      // against dataRef.current.configVersion before calling commitData.
      // When both layers are in place, a stale patch is caught locally
      // and never reaches the provider. This test verifies the provider
      // layer works correctly for the case where the local check is
      // bypassed (e.g. direct provider usage without useTimelineOps).

      const originalConfig = buildConfig();
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: originalConfig } },
      });

      // Simulate: client A reads version 1, client B writes and advances to 2,
      // then client A tries to write with expectedVersion=1.
      const clientARead = await provider.loadTimeline('timeline-1');
      expect(clientARead.configVersion).toBe(1);

      // Client B writes first
      await provider.saveTimeline('timeline-1', {
        ...buildConfig(),
        clips: [{ id: 'clip-b', clipType: 'hold', track: 'V1', at: 0, hold: 1 }],
      }, 1); // → version 2

      // Client A's stale write must be rejected
      await expect(
        provider.saveTimeline('timeline-1', {
          ...buildConfig(),
          clips: [{ id: 'clip-a', clipType: 'hold', track: 'V1', at: 10, hold: 1 }],
        }, 1),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);

      // After rejection, only client B's change should persist
      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.configVersion).toBe(2);
      expect(loaded.config.clips).toHaveLength(1);
      expect(loaded.config.clips[0].id).toBe('clip-b');
    });

    it('provides a clear conflict error name and code for upstream error handling', () => {
      const error = new TimelineVersionConflictError('stale baseVersion — patch at 1, timeline at 3');
      expect(error.name).toBe('TimelineVersionConflictError');
      expect(error.code).toBe('timeline_version_conflict');
      expect(error.message).toContain('stale baseVersion');
    });

    it('the provider never silently overwrites data on version mismatch', async () => {
      const provider = new InMemoryDataProvider({
        timelines: { 'timeline-1': { config: buildConfig(), configVersion: 5 } },
      });

      const originalLoaded = await provider.loadTimeline('timeline-1');
      expect(originalLoaded.configVersion).toBe(5);

      // Try every plausible wrong version
      for (const wrongVersion of [1, 2, 3, 4, 6, 7, 10, 999]) {
        await expect(
          provider.saveTimeline('timeline-1', buildConfig(), wrongVersion),
        ).rejects.toBeInstanceOf(TimelineVersionConflictError);
      }

      // Version must still be unchanged
      const finalLoaded = await provider.loadTimeline('timeline-1');
      expect(finalLoaded.configVersion).toBe(5);
    });
  });
  // -------------------------------------------------------------------------
  // dataKind V2 Batch 3: bundle persistence on the save path
  // -------------------------------------------------------------------------

  describe('data bundle persistence', () => {
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
    const makeEnvelope = (): TimelineBundleEnvelope => ({
      schema_version: 1,
      itemsBySchemaRef: { 'reigh.transcript_segment/v1': [makeItem()] },
    });

    it('seeds and loads a bundle', async () => {
      const provider = new InMemoryDataProvider({
        timelines: {
          'timeline-1': {
            config: buildConfig(),
            bundle: makeEnvelope(),
          },
        },
      });

      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.bundle).toEqual(makeEnvelope());
    });

    it('save → load round-trips a bundle and advances the version', async () => {
      const provider = new InMemoryDataProvider({
        timelines: {
          'timeline-1': {
            config: buildConfig(),
          },
        },
      });

      const nextVersion = await provider.saveTimeline(
        'timeline-1',
        buildConfig(),
        1,
        { assets: {} },
        makeEnvelope(),
      );
      expect(nextVersion).toBe(2);

      const loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.bundle).toEqual(makeEnvelope());
      expect(loaded.configVersion).toBe(2);
    });

    it('a malformed bundle fails the save atomically', async () => {
      const provider = new InMemoryDataProvider({
        timelines: {
          'timeline-1': {
            config: buildConfig(),
          },
        },
      });

      const initial = await provider.loadTimeline('timeline-1');
      const malformed = { ...makeEnvelope(), schema_version: 99 };
      expect(() => parseTimelineBundle(malformed)).toThrow(TimelineBundleParseError);

      await expect(
        provider.saveTimeline('timeline-1', buildConfig(), 1, { assets: {} }, malformed),
      ).rejects.toBeInstanceOf(TimelineBundleParseError);

      const reloaded = await provider.loadTimeline('timeline-1');
      expect(reloaded.configVersion).toBe(1);
      expect(reloaded.config).toEqual(initial.config);
      expect(reloaded.bundle ?? null).toBeNull();
    });

    it('undefined preserves and null clears the stored bundle', async () => {
      const provider = new InMemoryDataProvider({
        timelines: {
          'timeline-1': {
            config: buildConfig(),
          },
        },
      });

      await provider.saveTimeline('timeline-1', buildConfig(), 1, { assets: {} }, makeEnvelope());

      let loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.bundle).toEqual(makeEnvelope());

      await provider.saveTimeline('timeline-1', buildConfig(), 2, { assets: {} });
      loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.bundle).toEqual(makeEnvelope());

      await provider.saveTimeline('timeline-1', buildConfig(), 3, { assets: {} }, null);
      loaded = await provider.loadTimeline('timeline-1');
      expect(loaded.bundle ?? null).toBeNull();
    });

    it('stale expectedVersion still conflicts with a valid bundle attached', async () => {
      const provider = new InMemoryDataProvider({
        timelines: {
          'timeline-1': {
            config: buildConfig(),
          },
        },
      });

      await provider.saveTimeline('timeline-1', buildConfig(), 1, { assets: {} }, makeEnvelope());

      await expect(
        provider.saveTimeline('timeline-1', buildConfig(), 1, undefined, makeEnvelope()),
      ).rejects.toBeInstanceOf(TimelineVersionConflictError);

      const reloaded = await provider.loadTimeline('timeline-1');
      expect(reloaded.bundle).toEqual(makeEnvelope());
      expect(reloaded.configVersion).toBe(2);
    });
  });

});

