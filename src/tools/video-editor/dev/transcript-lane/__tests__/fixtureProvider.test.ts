import { describe, expect, it } from 'vitest';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  TRANSCRIPT_LANE_FIXTURE_PARAM,
  withTranscriptFixture,
} from '../fixtureProvider.ts';

describe('withTranscriptFixture', () => {
  // Round-5 regression: a `{...provider}` class spread dropped prototype
  // methods (`resolveAssetUrl`, `loadTimeline`) and the editor threw before
  // the lane plane ran. The wrapper must preserve the full surface.
  it('keeps prototype methods callable through the wrapper', () => {
    const base = new SupabaseDataProvider({ projectId: 'p1', userId: 'u1' }) as unknown as DataProvider;
    const wrapped = withTranscriptFixture(base);
    expect(typeof wrapped.resolveAssetUrl).toBe('function');
    expect(typeof wrapped.loadTimeline).toBe('function');
    expect(wrapped.loadAssetProfile).not.toBe(base.loadAssetProfile);
  });

  it('answers every asset with the fixture segments', async () => {
    const base = new SupabaseDataProvider({ projectId: 'p1', userId: 'u1' }) as unknown as DataProvider;
    const wrapped = withTranscriptFixture(base);
    const profile = await wrapped.loadAssetProfile!('any-asset-id');
    expect(profile?.transcript?.segments).toHaveLength(2);
    expect(profile?.transcript?.segments?.[0]).toMatchObject({ start: 2, end: 4 });
  });

  it('exposes the opt-in flag name', () => {
    expect(TRANSCRIPT_LANE_FIXTURE_PARAM).toBe('transcriptLaneFixture');
  });
});
