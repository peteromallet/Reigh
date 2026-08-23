// dataKind V1 (groken round-4/5 G1 completion): DEV-only provider decorator
// for the transcript-lane example. The stock bridge/embed providers return no
// asset profiles (`loadAssetProfile` → `null` / absent), so "Seeing a lane"
// had nothing to paint. This decorator answers EVERY asset with the same
// fixture segments — any sound-bearing media clip shows the lane.
//
// Method preservation matters: DataProvider methods live on the class
// prototype, so a `{...provider}` spread produces an object whose
// `resolveAssetUrl`/`loadTimeline` are undefined and the editor throws before
// the lane plane runs. `Object.create(provider)` keeps the whole prototype
// chain; only `loadAssetProfile` is shadowed with the fixture answer.
//
// Install only under `import.meta.env.DEV` AND an explicit opt-in URL flag
// (`?transcriptLaneFixture=1`); see pages/VideoEditorPage.tsx. Production
// builds dead-code-eliminate this module via the DEV guard.
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
import type { AssetProfile } from '@/tools/video-editor/data/AssetResolver.ts';

const FIXTURE_SEGMENTS = [
  { start: 2, end: 4, text: 'Fixture segment one' },
  { start: 5, end: 8, text: 'Fixture segment two' },
] as const;

/**
 * Short, deterministic export fixture.  The awkward timings deliberately
 * exercise fractional frame boundaries at every supported release rate.
 * Speaker labels stay in the text because the v1 transcript adapter's public
 * payload is intentionally only `{ text }`.
 */
const RENDER_MATRIX_FIXTURE_SEGMENTS = [
  { start: 0, end: 0.205, text: 'Ava: café — 👩🏽‍🚀' },
  { start: 0.167, end: 0.409, text: 'Борис: overlapping reply' },
  { start: 0.44, end: 0.52, text: '   ' },
  { start: 0.584, end: 0.792, text: '李: second speaker after gap' },
  // Wider than one 23.976 fps frame so every supported release rate contains
  // at least one encoded frame with both speakers visible.
  { start: 0.73, end: 1.25, text: 'Ava + 李: final overlap — مرحبًا' },
] as const;

export const RENDER_MATRIX_TRANSCRIPT_CAPTION_COUNT = 4;
export const RENDER_MATRIX_TRANSCRIPT_SEGMENT_COUNT = RENDER_MATRIX_FIXTURE_SEGMENTS.length;

/** Browser-only stress fixture for viewport virtualization acceptance. */
export const DENSE_TRANSCRIPT_FIXTURE_SEGMENT_COUNT = 500;

function denseFixtureSegments() {
  return Array.from({ length: DENSE_TRANSCRIPT_FIXTURE_SEGMENT_COUNT }, (_, index) => {
    const start = index * (4 / DENSE_TRANSCRIPT_FIXTURE_SEGMENT_COUNT);
    return {
      start,
      end: start + 0.006,
      text: `Dense fixture segment ${index + 1}`,
    };
  });
}

export interface TranscriptFixtureOptions {
  readonly dense?: boolean;
  readonly renderMatrix?: boolean;
}

/**
 * Wrap any DataProvider so every asset profiles as the default two-segment
 * transcript, or an explicitly requested dense browser stress fixture, while
 * every other method (prototype or own) keeps working via the original
 * instance. Every asset answers with the same segments by design: the fixture
 * must paint a lane on ANY project that has at least one sound-bearing media
 * clip, regardless of that clip's asset id.
 */
export function withTranscriptFixture(
  provider: DataProvider,
  options: TranscriptFixtureOptions = {},
): DataProvider {
  const decorated: DataProvider = Object.create(provider);
  decorated.loadAssetProfile = async (assetId: string): Promise<AssetProfile> => ({
    transcript: {
      segments: options.renderMatrix
        // The matrix has a separate AAC asset.  Keep transcript evidence on
        // its video carrier only so one source segment cannot materialize as
        // duplicate captions merely because the audio mix is also present.
        ? (assetId === 'demo-clip'
          ? RENDER_MATRIX_FIXTURE_SEGMENTS.map((segment) => ({ ...segment }))
          : [])
        : options.dense
          ? denseFixtureSegments()
          : FIXTURE_SEGMENTS.map((segment) => ({ ...segment })),
    },
  });
  return decorated;
}

/** Opt-in flag name for the DEV fixture lane (checked against location.search). */
export const TRANSCRIPT_LANE_FIXTURE_PARAM = 'transcriptLaneFixture';
