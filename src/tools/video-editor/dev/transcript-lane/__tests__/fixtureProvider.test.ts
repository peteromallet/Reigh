import { describe, expect, it } from 'vitest';
import { SupabaseDataProvider } from '@/tools/video-editor/data/SupabaseDataProvider.ts';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import {
  DENSE_TRANSCRIPT_FIXTURE_SEGMENT_COUNT,
  RENDER_MATRIX_TRANSCRIPT_CAPTION_COUNT,
  RENDER_MATRIX_TRANSCRIPT_SEGMENT_COUNT,
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

  it('provides the bounded dense browser fixture only when explicitly requested', async () => {
    const base = new SupabaseDataProvider({ projectId: 'p1', userId: 'u1' }) as unknown as DataProvider;
    const profile = await withTranscriptFixture(base, { dense: true }).loadAssetProfile!('any-asset-id');
    expect(profile?.transcript?.segments).toHaveLength(DENSE_TRANSCRIPT_FIXTURE_SEGMENT_COUNT);
    expect(profile?.transcript?.segments?.[0]).toMatchObject({ start: 0, text: 'Dense fixture segment 1' });
    expect(profile?.transcript?.segments?.at(-1)?.end).toBeLessThanOrEqual(4.01);
  });

  it('provides Unicode, overlap, gap, and empty-text export evidence only on the matrix carrier', async () => {
    const base = new SupabaseDataProvider({ projectId: 'p1', userId: 'u1' }) as unknown as DataProvider;
    const wrapped = withTranscriptFixture(base, { renderMatrix: true });
    const carrier = await wrapped.loadAssetProfile!('demo-clip');
    const audio = await wrapped.loadAssetProfile!('matrix-audio');
    const segments = carrier?.transcript?.segments ?? [];

    expect(segments).toHaveLength(RENDER_MATRIX_TRANSCRIPT_SEGMENT_COUNT);
    expect(segments.filter((segment) => segment.text.trim() !== '')).toHaveLength(
      RENDER_MATRIX_TRANSCRIPT_CAPTION_COUNT,
    );
    expect(segments[0]?.text).toContain('👩🏽‍🚀');
    expect(segments[1]?.start).toBeLessThan(segments[0]!.end);
    expect(segments[3]?.start).toBeGreaterThan(segments[1]!.end);
    expect(segments[4]?.start).toBeLessThan(segments[3]!.end);
    expect(audio?.transcript?.segments).toEqual([]);
  });

  it('exposes the opt-in flag name', () => {
    expect(TRANSCRIPT_LANE_FIXTURE_PARAM).toBe('transcriptLaneFixture');
  });
});
