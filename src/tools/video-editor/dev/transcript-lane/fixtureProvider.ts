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
 * Wrap any DataProvider so every asset profiles as a two-segment fixture
 * transcript while every other method (prototype or own) keeps working via
 * the original instance. Every asset answers with the same segments by
 * design: the fixture must paint a lane on ANY project that has at least one
 * sound-bearing media clip, regardless of that clip's asset id.
 */
export function withTranscriptFixture(provider: DataProvider): DataProvider {
  const decorated: DataProvider = Object.create(provider);
  decorated.loadAssetProfile = async (): Promise<AssetProfile> => ({
    transcript: { segments: FIXTURE_SEGMENTS.map((segment) => ({ ...segment })) },
  });
  return decorated;
}

/** Opt-in flag name for the DEV fixture lane (checked against location.search). */
export const TRANSCRIPT_LANE_FIXTURE_PARAM = 'transcriptLaneFixture';
