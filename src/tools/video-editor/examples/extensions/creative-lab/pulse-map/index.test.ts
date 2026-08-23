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
  BUILD_PULSE_MAP_COMMAND,
  PULSE_MAP_DATA_KEY,
  PULSE_MAP_EXTENSION_ID,
  PULSE_MAP_OVERLAY_RENDER_ID,
  PULSE_MAP_SCHEMA_VERSION,
  buildPulseMapPatch,
  derivePulseMap,
  normalizePulseTime,
  pulseMapExtension,
  readPulseMap,
  readPulseMapEnvelope,
  rebuildPulseMap,
} from './index';

function snapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    projectId: 'pulse-fixture', baseVersion: 7, currentVersion: 7,
    extensionRequirements: [], clips: [], tracks: [], assetKeys: [], app: {}, ...overrides,
  };
}

function createHarness(initial: TimelineSnapshot = snapshot()): {
  ctx: ExtensionContext;
  patches: TimelinePatch[];
  setSnapshot(next: TimelineSnapshot): void;
  getCommand(): ((run: unknown) => void) | undefined;
  getRenderer(): ExtensionRenderer<TimelineOverlayRenderProps> | undefined;
  commandDisposals: number;
  rendererDisposals: number;
} {
  let current = initial;
  let command: ((run: unknown) => void) | undefined;
  let renderer: ExtensionRenderer<TimelineOverlayRenderProps> | undefined;
  let commandDisposals = 0;
  let rendererDisposals = 0;
  const patches: TimelinePatch[] = [];
  const commands: ExtensionCommandService = {
    registerCommand(_id, handler): DisposeHandle {
      command = handler as (run: unknown) => void;
      return { dispose: () => { commandDisposals += 1; } };
    },
  };
  const ui: ExtensionUiService = {
    registerRenderer(_id, nextRenderer): DisposeHandle {
      renderer = nextRenderer as ExtensionRenderer<TimelineOverlayRenderProps>;
      return { dispose: () => { rendererDisposals += 1; } };
    },
  };
  const reader: TimelineReader = { snapshot: () => current };
  const timeline = { apply(patch: TimelinePatch): TimelineDiff { patches.push(patch); return {} as TimelineDiff; } } as TimelineOps;
  const ctx = createExtensionContext(pulseMapExtension, { reader, timeline }, commands, undefined, undefined, undefined, undefined, undefined, undefined, ui);
  return {
    ctx, patches, setSnapshot(next) { current = next; },
    getCommand() { return command; }, getRenderer() { return renderer; },
    get commandDisposals() { return commandDisposals; }, get rendererDisposals() { return rendererDisposals; },
  };
}

describe('Pulse Map extension', () => {
  it('keeps the JSON manifest fully aligned with the public manifest', () => {
    const packageManifest = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'reigh-extension.json'), 'utf8')).manifest;
    expect(packageManifest).toEqual(pulseMapExtension.manifest);
  });

  it('derives bounded pulses beyond one hour with insertion-stable source IDs', () => {
    const base = derivePulseMap({ clips: [
      { id: 'a', track: 'V1', at: 4000, duration: 2, managed: false },
      { id: 'b', track: 'V1', at: 5000, duration: 1, managed: false },
    ] });
    const inserted = derivePulseMap({ clips: [
      { id: 'a', track: 'V1', at: 4000, duration: 2, managed: false },
      { id: 'x', track: 'V1', at: 4500, duration: 1, managed: false },
      { id: 'b', track: 'V1', at: 5000, duration: 1, managed: false },
    ] });
    expect(base.find((entry) => entry.sourceClipId === 'a' && entry.edge === 'start')?.id)
      .toBe('pulse-a-start');
    expect(inserted.find((entry) => entry.sourceClipId === 'a' && entry.edge === 'start')?.id)
      .toBe('pulse-a-start');
    expect(base.find((entry) => entry.id === 'pulse-a-start')?.time).toBe(4000);
    expect(normalizePulseTime(100_000)).toBe(100_000);
  });

  it('migrates raw arrays and preserves explicit manual offsets on rebuild', () => {
    const oldEntry = { id: 'pulse-a-start', sourceClipId: 'a', edge: 'start', time: 4, intensity: 0.5, color: '#fff' };
    const migrated = readPulseMapEnvelope(snapshot({ app: { [PULSE_MAP_EXTENSION_ID]: { [PULSE_MAP_DATA_KEY]: [oldEntry] } } }));
    expect(migrated).toMatchObject({ schemaVersion: PULSE_MAP_SCHEMA_VERSION, generatedFromVersion: 0 });
    expect(migrated.entries[0].offset).toBe(0);
    const previous = [{ ...migrated.entries[0], time: 4.5, offset: 0.5 }];
    const rebuilt = rebuildPulseMap(snapshot({ clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] }), previous);
    expect(rebuilt.find((entry) => entry.id === 'pulse-a-start')).toMatchObject({ time: 1.5, offset: 0.5 });
  });

  it('writes a versioned extension-owned envelope and distinguishes build/move metadata', () => {
    const entries = derivePulseMap({ clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] });
    const build = buildPulseMapPatch(PULSE_MAP_EXTENSION_ID, snapshot(), entries);
    const move = buildPulseMapPatch(PULSE_MAP_EXTENSION_ID, snapshot({ baseVersion: 9 }), entries, { mode: 'move', generatedFromVersion: 7 });
    expect(build.meta).toMatchObject({ kind: 'pulse-map-build', generatedFromVersion: 7 });
    expect(move.meta).toMatchObject({ kind: 'pulse-map-move', generatedFromVersion: 7 });
    expect(build.operations[0]).toMatchObject({ op: 'project-data.write', target: PULSE_MAP_EXTENSION_ID });
    expect(build.operations[0].payload?.value).toMatchObject({ schemaVersion: 1, generatedFromVersion: 7, entries });
  });

  it('registers, invokes, and guardedly disposes command and renderer', () => {
    const harness = createHarness(snapshot({ clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] }));
    const activation = pulseMapExtension.activate?.(harness.ctx);
    harness.getCommand()?.({ commandId: BUILD_PULSE_MAP_COMMAND });
    expect(harness.patches[0].meta).toMatchObject({ kind: 'pulse-map-build' });
    activation?.dispose(); activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders intensity and source-aware labels, then moves against a fresh snapshot', () => {
    const entries = derivePulseMap({ clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }] });
    const harness = createHarness(snapshot({ app: { [PULSE_MAP_EXTENSION_ID]: { [PULSE_MAP_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 7, entries } } } }));
    const activation = pulseMapExtension.activate?.(harness.ctx);
    const rendered = harness.getRenderer()?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(2);
    expect(rendered.markers[0].label).toContain('a');
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('a');
    expect(custom.props.style.height).toBeTruthy();
    harness.setSnapshot(snapshot({ baseVersion: 11, currentVersion: 11, clips: [{ id: 'a', track: 'V1', at: 1, duration: 2, managed: false }], app: { [PULSE_MAP_EXTENSION_ID]: { [PULSE_MAP_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 7, entries } } } }));
    rendered.onChange({ id: entries[0].id, time: 1.5, phase: 'commit' });
    expect(harness.patches[0]).toMatchObject({ version: 11, meta: { kind: 'pulse-map-move', generatedFromVersion: 7 } });
    expect(harness.patches[0].operations[0].payload?.value).toMatchObject({ entries: expect.arrayContaining([expect.objectContaining({ id: entries[0].id, offset: 0.5 })]) });
    activation?.dispose();
  });

  it('collapses coincident boundaries and moves the full cluster from fresh data', () => {
    const entries = derivePulseMap({ clips: [
      { id: 'a', track: 'V1', at: 1, duration: 2, managed: false },
      { id: 'b', track: 'V1', at: 1, duration: 0, managed: false },
    ] });
    const app = { [PULSE_MAP_EXTENSION_ID]: {
      [PULSE_MAP_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 3, entries },
    } };
    const harness = createHarness(snapshot({ app }));
    const activation = pulseMapExtension.activate?.(harness.ctx);
    const rendered = harness.getRenderer()?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(2);
    const cluster = rendered.markers.find((marker: any) => marker.time === 1);
    expect(cluster.data.cluster.entries).toHaveLength(2);
    expect(cluster.label).toContain('(2 cues)');
    expect(rendered.renderMarker(cluster).props['aria-label']).toContain('b start');

    harness.setSnapshot(snapshot({
      baseVersion: 12,
      currentVersion: 12,
      clips: [
        { id: 'a', track: 'V1', at: 1, duration: 2, managed: false },
        { id: 'b', track: 'V1', at: 1, duration: 0, managed: false },
      ],
      app,
    }));
    rendered.onChange({ id: cluster.id, time: 2.5, phase: 'commit' });
    const movedEntries = harness.patches[0].operations[0].payload?.value.entries;
    expect(movedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pulse-a-start', time: 2.5, offset: 1.5 }),
      expect.objectContaining({ id: 'pulse-b-start', time: 2.5, offset: 1.5 }),
    ]));
    activation?.dispose();
  });

  it('ignores malformed persisted data', () => {
    expect(readPulseMap({ app: { [PULSE_MAP_EXTENSION_ID]: { [PULSE_MAP_DATA_KEY]: { entries: [{ nope: true }] } } } })).toEqual([]);
  });
});
