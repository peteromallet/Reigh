import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  DisposeHandle,
  ExtensionCommandService,
  ExtensionContext,
  ExtensionRenderer,
  ExtensionUiService,
  TimelineDiff,
  TimelineOps,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineReader,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import {
  BUILD_TERRAIN_COMMAND,
  SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID,
  TERRAIN_DATA_KEY,
  TERRAIN_OVERLAY_RENDER_ID,
  TERRAIN_SCHEMA_VERSION,
  buildTerrainPatch,
  deriveTerrainCues,
  normalizeTerrainTime,
  readTerrainCues,
  readTerrainEnvelope,
  rebuildTerrainCues,
  soundtrackCartographerExtension,
} from './index';

function snapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    projectId: 'cartographer-fixture', baseVersion: 7, currentVersion: 7,
    extensionRequirements: [], clips: [], tracks: [], assetKeys: [], app: {}, ...overrides,
  };
}

function createHarness(initial: TimelineSnapshot = snapshot()) {
  let current = initial;
  let command: ((run: unknown) => void) | undefined;
  let renderer: ExtensionRenderer<TimelineOverlayRenderProps> | undefined;
  let commandDisposals = 0;
  let rendererDisposals = 0;
  const patches: TimelinePatch[] = [];
  const commands: ExtensionCommandService = {
    registerCommand(_id, handler): DisposeHandle { command = handler as (run: unknown) => void; return { dispose: () => { commandDisposals += 1; } }; },
  };
  const ui: ExtensionUiService = {
    registerRenderer(_id, nextRenderer): DisposeHandle { renderer = nextRenderer as ExtensionRenderer<TimelineOverlayRenderProps>; return { dispose: () => { rendererDisposals += 1; } }; },
  };
  const reader: TimelineReader = { snapshot: () => current };
  const timeline = { apply(patch: TimelinePatch): TimelineDiff { patches.push(patch); return {} as TimelineDiff; } } as TimelineOps;
  const ctx = createExtensionContext(soundtrackCartographerExtension, { reader, timeline }, commands, undefined, undefined, undefined, undefined, undefined, undefined, ui);
  return {
    ctx, patches, setSnapshot(next: TimelineSnapshot) { current = next; },
    getCommand() { return command; }, getRenderer() { return renderer; },
    get commandDisposals() { return commandDisposals; }, get rendererDisposals() { return rendererDisposals; },
  };
}

const visualTracks = [
  { id: 'V1', kind: 'visual' as const, label: 'V1', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
];

describe('Soundtrack Cartographer extension', () => {
  it('keeps the checked-in package manifest fully aligned with the public manifest', () => {
    const packageManifest = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'reigh-extension.json'), 'utf8')).manifest;
    expect(packageManifest).toEqual(soundtrackCartographerExtension.manifest);
  });

  it('scopes density to unique starts on unmuted visual tracks and excludes self', () => {
    const cues = deriveTerrainCues({
      tracks: visualTracks,
      clips: [
        { id: 'self', track: 'V1', at: 0, duration: 5, managed: false },
        { id: 'same-start', track: 'V1', at: 0, duration: 1, managed: false },
        { id: 'near', track: 'V1', at: 1, duration: 1, managed: false },
        { id: 'muted', track: 'V2', at: 2, duration: 1, managed: false },
        { id: 'audio', track: 'A1', at: 3, duration: 1, managed: false },
        { id: 'far', track: 'V1', at: 20, duration: 1, managed: false },
      ],
    });
    expect(cues.map((cue) => cue.sourceClipId)).not.toContain('muted');
    expect(cues.map((cue) => cue.sourceClipId)).not.toContain('audio');
    expect(cues.find((cue) => cue.sourceClipId === 'self' && cue.edge === 'start')).toMatchObject({ kind: 'peak' });
    expect(cues.find((cue) => cue.sourceClipId === 'self' && cue.edge === 'start')?.id).toBe('terrain-self-start');
  });

  it('includes the density window boundary and excludes starts just beyond it', () => {
    const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1', muted: false }];
    const atBoundary = deriveTerrainCues({
      tracks,
      clips: [
        { id: 'self', track: 'V1', at: 0, duration: 5, managed: false },
        { id: 'boundary', track: 'V1', at: 8, duration: 1, managed: false },
      ],
    }).find((cue) => cue.id === 'terrain-self-start');
    const beyondBoundary = deriveTerrainCues({
      tracks,
      clips: [
        { id: 'self', track: 'V1', at: 0, duration: 5, managed: false },
        { id: 'outside', track: 'V1', at: 8.001, duration: 1, managed: false },
      ],
    }).find((cue) => cue.id === 'terrain-self-start');
    expect(atBoundary?.intensity).toBe(0.7);
    expect(beyondBoundary?.intensity).toBe(0.6);
  });

  it('keeps source IDs stable and supports timelines beyond one hour', () => {
    const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1', muted: false }];
    const base = deriveTerrainCues({ tracks, clips: [{ id: 'a', track: 'V1', at: 4000, duration: 2, managed: false }] });
    const inserted = deriveTerrainCues({ tracks, clips: [
      { id: 'a', track: 'V1', at: 4000, duration: 2, managed: false },
      { id: 'x', track: 'V1', at: 4100, duration: 1, managed: false },
    ] });
    expect(base.find((cue) => cue.sourceClipId === 'a' && cue.edge === 'start')?.id).toBe('terrain-a-start');
    expect(inserted.find((cue) => cue.sourceClipId === 'a' && cue.edge === 'start')?.id).toBe('terrain-a-start');
    expect(base.find((cue) => cue.id === 'terrain-a-start')?.time).toBe(4000);
    expect(normalizeTerrainTime(100_000)).toBe(100_000);
  });

  it('migrates raw arrays and preserves manual offsets through rebuilds', () => {
    const old = { id: 'terrain-a-start', sourceClipId: 'a', kind: 'rise', time: 4, intensity: 0.4, color: '#fff', label: 'rise' };
    const migrated = readTerrainEnvelope(snapshot({ app: { [SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID]: { [TERRAIN_DATA_KEY]: [old] } } }));
    expect(migrated).toMatchObject({ schemaVersion: TERRAIN_SCHEMA_VERSION, generatedFromVersion: 0 });
    expect(migrated.entries[0].offset).toBe(0);
    const rebuilt = rebuildTerrainCues(
      snapshot({ tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }], clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] }),
      [{ ...migrated.entries[0], offset: 0.5, time: 4.5 }],
    );
    expect(rebuilt.find((cue) => cue.id === 'terrain-a-start')).toMatchObject({ time: 1.5, offset: 0.5 });
  });

  it('writes versioned owned envelopes with distinct build/move metadata', () => {
    const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1', muted: false }];
    const cues = deriveTerrainCues({ tracks, clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] });
    const build = buildTerrainPatch(SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID, snapshot(), cues);
    const move = buildTerrainPatch(SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID, snapshot({ baseVersion: 9 }), cues, { mode: 'move', generatedFromVersion: 7 });
    expect(build.meta).toMatchObject({ kind: 'soundtrack-cartographer-build', analysis: 'structural-soundtrack-proxy' });
    expect(move.meta).toMatchObject({ kind: 'soundtrack-cartographer-move', generatedFromVersion: 7 });
    expect(build.operations[0]).toMatchObject({ op: 'project-data.write', target: SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID });
    expect(build.operations[0].payload?.value).toMatchObject({ schemaVersion: 1, entries: cues });
  });

  it('registers, invokes, and guardedly disposes command and renderer', () => {
    const harness = createHarness(snapshot({ tracks: visualTracks, clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] }));
    const activation = soundtrackCartographerExtension.activate?.(harness.ctx);
    harness.getCommand()?.({ commandId: BUILD_TERRAIN_COMMAND });
    expect(harness.patches[0].meta).toMatchObject({ kind: 'soundtrack-cartographer-build' });
    activation?.dispose(); activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders intensity and source-aware labels, then moves against a fresh snapshot', () => {
    const tracks = [{ id: 'V1', kind: 'visual' as const, label: 'V1', muted: false }];
    const entries = deriveTerrainCues({ tracks, clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] });
    const app = { schemaVersion: 1, generatedFromVersion: 7, entries };
    const harness = createHarness(snapshot({ app: { [SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID]: { [TERRAIN_DATA_KEY]: app } } }));
    const activation = soundtrackCartographerExtension.activate?.(harness.ctx);
    const rendered = harness.getRenderer()?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(2);
    expect(rendered.markers[0].label).toContain('a');
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('a');
    expect(custom.props.style.height).toBeTruthy();
    harness.setSnapshot(snapshot({ baseVersion: 11, currentVersion: 11, tracks, clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }], app: { [SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID]: { [TERRAIN_DATA_KEY]: app } } }));
    rendered.onChange({ id: entries[0].id, time: 1.5, phase: 'commit' });
    expect(harness.patches[0]).toMatchObject({ version: 11, meta: { kind: 'soundtrack-cartographer-move', generatedFromVersion: 7 } });
    expect(harness.patches[0].operations[0].payload?.value).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ id: entries[0].id, offset: 0.5 })]) });
    activation?.dispose();
  });

  it('ignores malformed persisted data', () => {
    expect(readTerrainCues({ app: { [SOUNDTRACK_CARTOGRAPHER_EXTENSION_ID]: { [TERRAIN_DATA_KEY]: { entries: [{ nope: true }] } } } })).toEqual([]);
  });
});
