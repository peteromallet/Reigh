import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps, TimelinePatch } from '@reigh/editor-sdk';
import {
  DROP_FOLEY_CUES_COMMAND,
  FOLEY_CONSTELLATION_EXTENSION_ID,
  FOLEY_CUES_DATA_KEY,
  FOLEY_OVERLAY_RENDER_ID,
  FOLEY_SCHEMA_VERSION,
  MAX_FOLEY_CLIPS,
  MAX_FOLEY_CUES,
  buildFoleyPatch,
  deriveFoleyCues,
  foleyConstellationExtension,
  normalizeFoleyDistance,
  normalizeFoleyIntensity,
  normalizeFoleyOffset,
  normalizeFoleyPan,
  normalizeFoleyTime,
  readFoleyCues,
  readFoleyEnvelope,
  rebuildFoleyCues,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

const tracks = [
  { id: 'V1', kind: 'visual' as const, label: 'Primary', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted auxiliary', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
];

describe('Foley Cue Scaffolder extension', () => {
  it('keeps the checked-in package manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(foleyConstellationExtension.manifest);
  });

  it('creates neutral deduped boundaries only on the primary unmuted visual track', () => {
    const clips = [
      { id: 'late', track: 'V1', at: 6, duration: 1, managed: false },
      { id: 'first', track: 'V1', at: 0, duration: 5, managed: false },
      { id: 'muted', track: 'V2', at: 20, duration: 1, managed: false },
      { id: 'audio', track: 'A1', at: 30, duration: 1, managed: false },
      { id: 'invalid', track: 'V1', at: Number.NaN, duration: 1, managed: false },
    ];
    const forward = deriveFoleyCues({ clips, tracks });
    const reverse = deriveFoleyCues({ clips: [...clips].reverse(), tracks: [...tracks].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward.map((cue) => [cue.sourceClipId, cue.boundary, cue.id])).toEqual([
      ['first', 'start', 'foley-first-start'],
      ['first', 'end', 'foley-first-end'],
      ['late', 'start', 'foley-late-start'],
      ['late', 'end', 'foley-late-end'],
    ]);
    expect(forward.every((cue) => cue.category === 'unassigned')).toBe(true);
    expect(forward.every((cue) => cue.pan === 0 && cue.distance === 0.5)).toBe(true);
    expect(forward.every((cue) => cue.label.includes('Unassigned Foley cue'))).toBe(true);
  });

  it('supports timelines beyond one hour and bounded structural input', () => {
    const long = deriveFoleyCues({
      tracks,
      clips: [{ id: 'long', track: 'V1', at: 100_000, duration: 2, managed: false }],
    });
    expect(long.find((cue) => cue.id === 'foley-long-start')?.time).toBe(100_000);
    expect(normalizeFoleyTime(100_000)).toBe(100_000);
    const many = Array.from({ length: MAX_FOLEY_CLIPS + 20 }, (_, index) => ({
      id: `clip-${index}`, track: 'V1', at: index * 10, duration: 1, managed: false,
    }));
    expect(deriveFoleyCues({ tracks, clips: many })).toHaveLength(MAX_FOLEY_CUES);
    expect(deriveFoleyCues({ tracks, clips: [{ id: 'bad', track: 'V1', at: Number.NaN, duration: 1, managed: false }] })).toEqual([]);
    expect(normalizeFoleyTime(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeFoleyTime(-4)).toBe(0);
  });

  it('uses a neutral playhead scaffold when no primary visual clips exist', () => {
    const cues = deriveFoleyCues({ clips: [], tracks }, 12.3456);
    expect(cues).toEqual([expect.objectContaining({
      sourceClipId: null,
      boundary: 'playhead',
      category: 'unassigned',
      time: 12.346,
      pan: 0,
      distance: 0.5,
    })]);
    expect(deriveFoleyCues({ clips: [], tracks }, Number.NaN)).toEqual([]);
  });

  it('migrates raw arrays and preserves manual offsets and edits on rebuild', () => {
    const old = {
      id: 'foley-first-start', sourceClipId: 'first', category: 'impact', time: 4,
      pan: 0.75, distance: 0.1, intensity: 0.9, label: 'My authored cue',
    };
    const migrated = readFoleyEnvelope({
      app: { [FOLEY_CONSTELLATION_EXTENSION_ID]: { [FOLEY_CUES_DATA_KEY]: [old] } },
    });
    expect(migrated).toMatchObject({ schemaVersion: FOLEY_SCHEMA_VERSION, generatedFromVersion: 0 });
    expect(migrated.entries[0]).toMatchObject({ category: 'unassigned', boundary: 'start', offset: 0 });
    const rebuilt = rebuildFoleyCues(
      { tracks, clips: [{ id: 'first', track: 'V1', at: 1, duration: 2, managed: false }] },
      [{ ...migrated.entries[0], offset: 0.5, time: 4.5 }],
    );
    expect(rebuilt.find((cue) => cue.id === 'foley-first-start')).toMatchObject({
      time: 1.5, offset: 0.5, pan: 0.75, distance: 0.1, intensity: 0.9, label: 'My authored cue',
    });
    const authored = readFoleyEnvelope({
      app: { [FOLEY_CONSTELLATION_EXTENSION_ID]: { [FOLEY_CUES_DATA_KEY]: {
        schemaVersion: 1, generatedFromVersion: 4, entries: [{ ...old, category: 'Door slam', boundary: 'start', offset: 0 }],
      } } },
    });
    expect(authored.entries[0].category).toBe('Door slam');
  });

  it('writes versioned owned envelopes and distinguishes build/move metadata', () => {
    const cues = deriveFoleyCues({
      tracks,
      clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 0.5, managed: false }],
    });
    const build = buildFoleyPatch(FOLEY_CONSTELLATION_EXTENSION_ID, createCreativeLabSnapshot({ baseVersion: 7 }), cues);
    const move = buildFoleyPatch(
      FOLEY_CONSTELLATION_EXTENSION_ID,
      createCreativeLabSnapshot({ baseVersion: 9 }),
      cues,
      { mode: 'move', generatedFromVersion: 7 },
    );
    expect(build.meta).toMatchObject({ kind: 'foley-cue-scaffolder-build', generatedFromVersion: 7 });
    expect(move.meta).toMatchObject({ kind: 'foley-cue-scaffolder-move', generatedFromVersion: 7 });
    expect(build.operations[0]).toMatchObject({ op: 'project-data.write', target: FOLEY_CONSTELLATION_EXTENSION_ID });
    expect(build.operations[0].payload?.value).toMatchObject({ schemaVersion: 1, generatedFromVersion: 7, entries: cues });
  });

  it('registers, invokes, and guardedly disposes both handles', () => {
    const harness = createCreativeLabExtensionHarness(foleyConstellationExtension, createCreativeLabSnapshot({ tracks }));
    const activation = foleyConstellationExtension.activate?.(harness.ctx);
    expect(harness.getCommand(DROP_FOLEY_CUES_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(FOLEY_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));
    harness.getCommand(DROP_FOLEY_CUES_COMMAND)?.({ commandId: DROP_FOLEY_CUES_COMMAND });
    expect(harness.patches).toHaveLength(1);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders source-aware intensity and preserves a fresh-snapshot drag offset', () => {
    const stored = deriveFoleyCues({ tracks, clips: [{ id: 'clip-a', track: 'V1', at: 24, duration: 12, managed: false }] });
    const app = { [FOLEY_CONSTELLATION_EXTENSION_ID]: {
      [FOLEY_CUES_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 3, entries: stored },
    } };
    const clip = { id: 'clip-a', track: 'V1', at: 24, duration: 12, managed: false };
    const harness = createCreativeLabExtensionHarness(foleyConstellationExtension, createCreativeLabSnapshot({ tracks, clips: [clip], app }));
    const activation = foleyConstellationExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(FOLEY_OVERLAY_RENDER_ID);
    const rendered = renderer?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(2);
    expect(rendered.markers[0].data.pan).toBe(0);
    expect(rendered.markers[0].data.distance).toBe(0.5);
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('clip-a');
    expect(custom.props['aria-label']).toContain('intensity');
    expect(custom.props.style.height).toBeTruthy();
    harness.setSnapshot(createCreativeLabSnapshot({ baseVersion: 11, currentVersion: 11, tracks, clips: [clip], app }));
    rendered.onChange({ id: stored[0].id, time: 25.5, phase: 'commit' });
    expect(harness.patches[0]).toMatchObject({ version: 11, meta: { kind: 'foley-cue-scaffolder-move', generatedFromVersion: 3 } });
    expect(harness.patches[0].operations[0].payload?.value).toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ id: stored[0].id, time: 25.5, offset: 1.5 })]),
    });
    activation?.dispose();
  });

  it('normalizes authored spatial fields and ignores malformed data', () => {
    const result = readFoleyCues({
      app: { [FOLEY_CONSTELLATION_EXTENSION_ID]: { [FOLEY_CUES_DATA_KEY]: {
        entries: [
          { id: 'ok', sourceClipId: null, category: 'unassigned', boundary: 'playhead', time: 2, offset: 0, pan: 4, distance: -2, intensity: 2, label: 'ok' },
          { id: 'bad', sourceClipId: 'x', category: 'laser', time: Number.NaN, pan: 0, distance: 0, intensity: 0, label: 'bad' },
        ],
      } } },
    });
    expect(result).toEqual([expect.objectContaining({ id: 'ok', pan: 1, distance: 0, intensity: 1 })]);
    expect(normalizeFoleyOffset(Number.NaN)).toBe(0);
    expect(normalizeFoleyPan(-2)).toBe(-1);
    expect(normalizeFoleyDistance(2)).toBe(1);
    expect(normalizeFoleyIntensity(-1)).toBe(0);
  });

  it('keeps the patch type explicit for public contract checks', () => {
    const patch: TimelinePatch = buildFoleyPatch(
      FOLEY_CONSTELLATION_EXTENSION_ID,
      createCreativeLabSnapshot(),
      [],
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
