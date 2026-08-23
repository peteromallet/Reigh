import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps, TimelinePatch } from '@reigh/editor-sdk';
import {
  BUILD_CHROMATIC_CONSTELLATION_COMMAND,
  CHROMATIC_CONSTELLATION_DATA_KEY,
  CHROMATIC_CONSTELLATION_EXTENSION_ID,
  CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID,
  CHROMATIC_CONSTELLATION_SCHEMA_VERSION,
  MAX_CHROMATIC_CONSTELLATION_MARKERS,
  buildChromaticConstellationPatch,
  chromaticConstellationExtension,
  deriveChromaticConstellation,
  normalizeConstellationTime,
  readChromaticConstellation,
  readChromaticConstellationEnvelope,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

const tracks = [
  { id: 'V1', kind: 'visual' as const, label: 'Editorial Picture', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted Auxiliary', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Sound', muted: false },
];

describe('Structural Pacing Palette extension', () => {
  it('keeps the JSON manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(chromaticConstellationExtension.manifest);
  });

  it('scopes suggestions to the primary visual track and preserves its real label/order', () => {
    const clips = [
      { id: 'long', track: 'V1', at: 5, duration: 5, managed: false },
      { id: 'gap', track: 'V1', at: 12, duration: 1, managed: false },
      { id: 'quick', track: 'A1', at: 0, duration: 0.5, managed: false },
      { id: 'muted', track: 'V2', at: 20, duration: 1, managed: false },
      { id: 'middle', track: 'V1', at: 2, duration: 2, managed: false },
    ];
    const forward = deriveChromaticConstellation({ clips, tracks });
    const reverse = deriveChromaticConstellation({ clips: [...clips].reverse(), tracks });
    expect(forward).toEqual(reverse);
    expect(forward.map((marker) => marker.sourceClipId)).toEqual(['middle', 'long', 'gap']);
    expect(forward.every((marker) => marker.trackId === 'V1')).toBe(true);
    expect(forward.every((marker) => marker.trackLabel === 'Editorial Picture')).toBe(true);
    expect(forward.every((marker) => marker.trackOrder === 0)).toBe(true);
    expect(forward.every((marker) => marker.label.includes('Editorial Picture'))).toBe(true);
  });

  it('keeps source IDs invariant under insertion and uses timing classes, not emotional claims', () => {
    const base = deriveChromaticConstellation({
      tracks: [tracks[0]],
      clips: [{ id: 'a', track: 'V1', at: 4000, duration: 2, managed: false }],
    });
    const inserted = deriveChromaticConstellation({
      tracks: [tracks[0]],
      clips: [
        { id: 'a', track: 'V1', at: 4000, duration: 2, managed: false },
        { id: 'new', track: 'V1', at: 4100, duration: 1, managed: false },
      ],
    });
    expect(base[0].id).toBe('constellation-a');
    expect(inserted.find((marker) => marker.sourceClipId === 'a')?.id).toBe('constellation-a');
    expect(base[0].pacingClass).toBe('open');
    expect(base[0].label).toContain('gap ≥ 2s');
  });

  it('excludes malformed, negative, and missing-track timing', () => {
    const markers = deriveChromaticConstellation({
      tracks: [tracks[0]],
      clips: [
        { id: 'nan', track: 'V1', at: Number.NaN, duration: 1, managed: false },
        { id: 'inf', track: 'V1', at: Number.POSITIVE_INFINITY, duration: 1, managed: false },
        { id: 'negative-start', track: 'V1', at: -1, duration: 1, managed: false },
        { id: 'negative-duration', track: 'V1', at: 1, duration: -1, managed: false },
        { id: 'missing-track', track: 'V9', at: 2, duration: 1, managed: false },
        { id: 'valid', track: 'V1', at: 3, duration: 1, managed: false },
      ],
    });
    expect(markers.map((marker) => marker.sourceClipId)).toEqual(['valid']);
  });

  it('computes the full stream beyond one hour and reports truthful display coverage', () => {
    const clips = Array.from({ length: MAX_CHROMATIC_CONSTELLATION_MARKERS + 20 }, (_, index) => ({
      id: `clip-${index}`, track: 'V1', at: 100_000 + index * 2, duration: 1, managed: false,
    }));
    const markers = deriveChromaticConstellation({ tracks: [tracks[0]], clips });
    expect(markers).toHaveLength(MAX_CHROMATIC_CONSTELLATION_MARKERS + 20);
    expect(markers[0].time).toBe(100_000);
    const patch = buildChromaticConstellationPatch(
      CHROMATIC_CONSTELLATION_EXTENSION_ID,
      createCreativeLabSnapshot({ baseVersion: 8 }),
      markers,
    );
    const value = patch.operations[0].payload?.value as any;
    expect(value.entries).toHaveLength(markers.length);
    expect(value.coverage).toMatchObject({
      totalCandidates: markers.length,
      persistedCount: markers.length,
      displayLimit: MAX_CHROMATIC_CONSTELLATION_MARKERS,
      displayedCount: MAX_CHROMATIC_CONSTELLATION_MARKERS,
      omittedCount: 20,
      status: 'truncated',
    });
    expect(normalizeConstellationTime(100_000)).toBe(100_000);
  });

  it('migrates legacy mood arrays and preserves generated version/coverage metadata', () => {
    const legacy = {
      id: 'constellation-a-electric', sourceClipId: 'a', trackId: 'V1', mood: 'electric',
      time: 2, duration: 1, intensity: 0.5, color: '#ff5c8a', label: 'electric · track 1',
    };
    const migrated = readChromaticConstellationEnvelope({
      app: { [CHROMATIC_CONSTELLATION_EXTENSION_ID]: { [CHROMATIC_CONSTELLATION_DATA_KEY]: [legacy] } },
    });
    expect(migrated).toMatchObject({ schemaVersion: CHROMATIC_CONSTELLATION_SCHEMA_VERSION, generatedFromVersion: 0 });
    expect(migrated.entries[0]).toMatchObject({ id: legacy.id, pacingClass: 'compact', trackLabel: 'V1' });
    expect(migrated.coverage).toMatchObject({ totalCandidates: 1, displayedCount: 1, omittedCount: 0, status: 'complete' });
    const envelope = readChromaticConstellationEnvelope({
      app: { [CHROMATIC_CONSTELLATION_EXTENSION_ID]: { [CHROMATIC_CONSTELLATION_DATA_KEY]: {
        schemaVersion: 1, generatedFromVersion: 12, coverage: { totalCandidates: 3 }, entries: [legacy],
      } } },
    });
    expect(envelope.generatedFromVersion).toBe(12);
    expect(envelope.coverage.totalCandidates).toBe(3);
  });

  it('writes a versioned read-only derived-suggestion patch', () => {
    const markers = deriveChromaticConstellation({ tracks: [tracks[0]], clips: [
      { id: 'a', track: 'V1', at: 1, duration: 2, managed: false },
    ] });
    const patch = buildChromaticConstellationPatch(
      CHROMATIC_CONSTELLATION_EXTENSION_ID,
      createCreativeLabSnapshot({ baseVersion: 7 }),
      markers,
    );
    expect(patch.meta).toMatchObject({
      kind: 'structural-pacing-palette-build',
      generatedFromVersion: 7,
      readOnlyDerivedSuggestions: true,
    });
    expect(patch.operations[0]).toMatchObject({
      op: 'project-data.write', target: CHROMATIC_CONSTELLATION_EXTENSION_ID,
      payload: { value: { schemaVersion: 1, generatedFromVersion: 7, entries: markers } },
    });
  });

  it('registers, invokes, and idempotently disposes both handles', () => {
    const harness = createCreativeLabExtensionHarness(chromaticConstellationExtension, createCreativeLabSnapshot({ tracks }));
    const activation = chromaticConstellationExtension.activate?.(harness.ctx);
    expect(harness.getCommand(BUILD_CHROMATIC_CONSTELLATION_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));
    harness.getCommand(BUILD_CHROMATIC_CONSTELLATION_COMMAND)?.({ commandId: BUILD_CHROMATIC_CONSTELLATION_COMMAND });
    expect(harness.patches).toHaveLength(1);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders non-color labels and keeps derived suggestions read-only', () => {
    const markers = deriveChromaticConstellation({ tracks: [tracks[0]], clips: [
      { id: 'a', track: 'V1', at: 1, duration: 2, managed: false },
    ] });
    const app = { [CHROMATIC_CONSTELLATION_EXTENSION_ID]: {
      [CHROMATIC_CONSTELLATION_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 3, coverage: {
        totalCandidates: 1, persistedCount: 1, displayLimit: 128, displayedCount: 1, omittedCount: 0,
        sourceTrackId: 'V1', sourceTrackLabel: 'Editorial Picture', status: 'complete',
      }, entries: markers },
    } };
    const harness = createCreativeLabExtensionHarness(chromaticConstellationExtension, createCreativeLabSnapshot({ tracks: [tracks[0]], clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }], app }));
    const activation = chromaticConstellationExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(CHROMATIC_CONSTELLATION_OVERLAY_RENDER_ID);
    const rendered = renderer?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.interactive).toBe(false);
    expect(rendered.onChange).toBeUndefined();
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('read-only suggestion');
    expect(custom.props.children).toContain(markers[0].pacingClass);
    activation?.dispose();
  });

  it('ignores malformed and foreign records', () => {
    expect(readChromaticConstellation({
      app: { [CHROMATIC_CONSTELLATION_EXTENSION_ID]: { [CHROMATIC_CONSTELLATION_DATA_KEY]: { entries: [{ nope: true }] } } },
    })).toEqual([]);
    expect(readChromaticConstellation({ app: { other: { [CHROMATIC_CONSTELLATION_DATA_KEY]: [] } } })).toEqual([]);
  });

  it('keeps the patch type explicit for public contract checks', () => {
    const patch: TimelinePatch = buildChromaticConstellationPatch(
      CHROMATIC_CONSTELLATION_EXTENSION_ID,
      createCreativeLabSnapshot(),
      [],
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
