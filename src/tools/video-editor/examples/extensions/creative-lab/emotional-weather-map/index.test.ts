import { describe, expect, it } from 'vitest';
import type {
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import {
  BUILD_EMOTIONAL_WEATHER_MAP_COMMAND,
  EMOTIONAL_WEATHER_MAP_DATA_KEY,
  EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
  EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID,
  MAX_WEATHER_MAP_CLIPS,
  MAX_WEATHER_MAP_MARKERS,
  buildWeatherMapPatch,
  deriveWeatherMap,
  emotionalWeatherMapExtension,
  normalizeWeatherTime,
  readWeatherMap,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

describe('Emotional Weather Map extension', () => {
  it('keeps the JSON manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    const jsonManifest = manifestModule.default.manifest;
    expect(jsonManifest).toEqual(emotionalWeatherMapExtension.manifest);
  });

  it('derives sorted pacing weather deterministically from starts, durations, and gaps', () => {
    const clips = [
      { id: 'sun', track: 'V1', at: 3, duration: 5, managed: false },
      { id: 'fog', track: 'V1', at: 10, duration: 2, managed: false },
      { id: 'lightning', track: 'V1', at: 0, duration: 0.5, managed: false },
      { id: 'breeze', track: 'V1', at: 1.5, duration: 2, managed: false },
    ];
    const forward = deriveWeatherMap({ clips });
    const reverse = deriveWeatherMap({ clips: [...clips].reverse() });

    expect(forward).toEqual(reverse);
    expect(forward.map((marker) => [marker.sourceClipId, marker.kind, marker.time])).toEqual([
      ['lightning', 'lightning', 0],
      ['breeze', 'breeze', 1.5],
      ['sun', 'sunshine', 3],
      ['fog', 'fog', 10],
    ]);
    expect(forward.every((marker) => marker.time >= 0)).toBe(true);
    expect(forward.every((marker) => marker.intensity >= 0 && marker.intensity <= 1)).toBe(true);
  });

  it('bounds computation and hostile numeric input', () => {
    const clips = Array.from({ length: MAX_WEATHER_MAP_CLIPS + 40 }, (_, index) => ({
      id: `clip-${index}`,
      track: 'V1',
      at: index,
      duration: 1,
      managed: false,
    }));
    expect(deriveWeatherMap({ clips })).toHaveLength(MAX_WEATHER_MAP_MARKERS);
    expect(normalizeWeatherTime(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeWeatherTime(Number.NaN)).toBe(0);
    expect(normalizeWeatherTime(-4)).toBe(0);
    expect(normalizeWeatherTime(99999)).toBe(99999);
  });

  it('uses the primary unmuted visual editorial track and ignores overlays/audio beds', () => {
    const tracks = [
      { id: 'A1', kind: 'audio' as const, label: 'Bed', muted: false },
      { id: 'V1', kind: 'visual' as const, label: 'Picture', muted: false },
      { id: 'V2', kind: 'visual' as const, label: 'Muted picture', muted: true },
    ];
    const clips = [
      { id: 'bed', track: 'A1', at: 0, duration: 100, clipType: 'audio', managed: false },
      { id: 'shot-a', track: 'V1', at: 0, duration: 5, clipType: 'video', managed: false },
      { id: 'title', track: 'V1', at: 1, duration: 2, clipType: 'text', managed: false },
      { id: 'shot-b', track: 'V1', at: 5, duration: 5, clipType: 'video', managed: false },
      { id: 'muted', track: 'V2', at: 2, duration: 1, clipType: 'video', managed: false },
    ];
    expect(deriveWeatherMap({ clips, tracks }).map((marker) => marker.sourceClipId))
      .toEqual(['shot-a', 'shot-b']);
  });

  it('samples a bounded map across the full timeline rather than truncating the beginning', () => {
    const clips = Array.from({ length: MAX_WEATHER_MAP_MARKERS * 2 }, (_, index) => ({
      id: `clip-${index}`,
      track: 'V1',
      at: index,
      duration: 1,
      clipType: 'video',
      managed: false,
    }));
    const markers = deriveWeatherMap({ clips });
    expect(markers).toHaveLength(MAX_WEATHER_MAP_MARKERS);
    expect(markers[0].sourceClipId).toBe('clip-0');
    expect(markers.at(-1)?.sourceClipId).toBe(`clip-${clips.length - 1}`);
  });

  it('builds an extension-owned project-data patch', () => {
    const snapshot = createCreativeLabSnapshot({ baseVersion: 7 });
    const markers = deriveWeatherMap({
      clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 1, managed: false }],
    });
    const patch = buildWeatherMapPatch(EMOTIONAL_WEATHER_MAP_EXTENSION_ID, snapshot, markers);

    expect(patch).toMatchObject({
      version: 7,
      source: EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
      meta: { kind: 'emotional-weather-map-build' },
    });
    expect(patch.operations).toEqual([expect.objectContaining({
      op: 'project-data.write',
      target: EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
      payload: { key: EMOTIONAL_WEATHER_MAP_DATA_KEY, mode: 'replace', value: markers },
    })]);
  });

  it('registers command and overlay, then disposes both handles', () => {
    const harness = createCreativeLabExtensionHarness(emotionalWeatherMapExtension);
    const activation = emotionalWeatherMapExtension.activate?.(harness.ctx);
    expect(harness.getCommand(BUILD_EMOTIONAL_WEATHER_MAP_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));

    harness.getCommand(BUILD_EMOTIONAL_WEATHER_MAP_COMMAND)?.({
      commandId: BUILD_EMOTIONAL_WEATHER_MAP_COMMAND,
      extensionId: EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
    });
    expect(harness.patches).toHaveLength(1);
    expect(harness.patches[0].operations[0]).toMatchObject({
      op: 'project-data.write',
      target: EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
    });

    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders source-aware read-only derived markers', () => {
    const stored = deriveWeatherMap({
      clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 1, managed: false }],
    });
    const harness = createCreativeLabExtensionHarness(
      emotionalWeatherMapExtension,
      createCreativeLabSnapshot({
        app: { [EMOTIONAL_WEATHER_MAP_EXTENSION_ID]: { [EMOTIONAL_WEATHER_MAP_DATA_KEY]: stored } },
      }),
    );
    const activation = emotionalWeatherMapExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(
      EMOTIONAL_WEATHER_MAP_OVERLAY_RENDER_ID,
    );
    const rendered = renderer?.({
      primitives: { markerLayer: (options: unknown) => options },
    } as TimelineOverlayRenderProps) as any;

    expect(rendered.markers).toHaveLength(1);
    expect(rendered.markers[0].time).toBe(1);
    expect(rendered.markers[0].label).toContain('clip-a');
    expect(rendered.interactive).toBe(false);
    expect(rendered.onChange).toBeUndefined();
    expect(harness.patches).toHaveLength(0);
    activation?.dispose();
  });

  it('ignores malformed or foreign persisted project data', () => {
    const malformed = {
      app: {
        [EMOTIONAL_WEATHER_MAP_EXTENSION_ID]: {
          [EMOTIONAL_WEATHER_MAP_DATA_KEY]: [
            null,
            { id: 'bad', sourceClipId: 'x', kind: 'hail', time: 1 },
            { id: 'also-bad', sourceClipId: 'x', kind: 'fog', time: Number.NaN },
          ],
        },
      },
    };
    expect(readWeatherMap(malformed)).toEqual([]);
    expect(readWeatherMap({ app: { other: { [EMOTIONAL_WEATHER_MAP_DATA_KEY]: [] } } })).toEqual([]);
  });

  it('keeps the patch type explicit for future contract checks', () => {
    const patch: TimelinePatch = buildWeatherMapPatch(
      EMOTIONAL_WEATHER_MAP_EXTENSION_ID,
      createCreativeLabSnapshot(),
      [],
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
