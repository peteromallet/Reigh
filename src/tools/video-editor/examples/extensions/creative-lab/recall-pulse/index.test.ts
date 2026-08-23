import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps } from '@reigh/editor-sdk';
import {
  BUILD_RECALL_PULSE_COMMAND,
  RECALL_PULSE_DATA_KEY,
  RECALL_PULSE_EXTENSION_ID,
  RECALL_PULSE_OVERLAY_RENDER_ID,
  RECALL_PULSE_SCHEMA_VERSION,
  buildRecallPulsePatch,
  computeRecallPulseSourceSignature,
  deriveRecallPulseMarkers,
  normalizeRecallPulseTime,
  readRecallPulseEnvelope,
  readRecallPulseMarkers,
  recallPulseExtension,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

const primaryTrack = { id: 'V1', kind: 'visual' as const, label: 'Picture', muted: false };

function clip(
  id: string,
  at: number,
  duration = 2,
  track = 'V1',
) {
  return { id, track, at, duration, managed: false };
}

describe('Structural Learning-Review Scaffold', () => {
  it('keeps the JSON manifest aligned and states the read-only structural scope', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(recallPulseExtension.manifest);
    expect(recallPulseExtension.manifest.label).toBe('Structural Learning-Review Scaffold');
    expect(recallPulseExtension.manifest.description).toContain('read-only');
  });

  it('uses only the first unmuted visual editorial track and excludes unrelated or malformed clips', () => {
    const tracks = [
      primaryTrack,
      { id: 'muted-picture', kind: 'visual' as const, label: 'Muted', muted: true },
      { id: 'aux-picture', kind: 'visual' as const, label: 'Aux', muted: false },
      { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
    ];
    const markers = deriveRecallPulseMarkers({
      tracks,
      clips: [
        clip('primary-a', 0),
        clip('primary-b', 3),
        clip('muted', 1, 2, 'muted-picture'),
        clip('aux', 2, 2, 'aux-picture'),
        clip('audio', 4, 2, 'A1'),
        clip('missing-track', 5, 2, 'gone'),
        clip('negative', -1),
        clip('zero', 6, 0),
        clip('nan', Number.NaN),
      ],
    });

    expect(markers.map((marker) => marker.sourceClipId)).toEqual(['primary-a', 'primary-b']);
    expect(markers.every((marker) => marker.trackId === 'V1')).toBe(true);
    expect(markers.every((marker) => marker.assignment === 'unassigned')).toBe(true);
    expect(markers.every((marker) => marker.prompt.endsWith('?'))).toBe(true);
    expect(markers.every((marker) => marker.method.includes('first-unmuted-visual-track'))).toBe(true);
  });

  it('keeps source and checkpoint IDs invariant when unrelated tracks or IDs are added', () => {
    const base = deriveRecallPulseMarkers({
      tracks: [primaryTrack],
      clips: [clip('source-a', 0), clip('source-b', 2)],
    });
    const withUnrelated = deriveRecallPulseMarkers({
      tracks: [
        primaryTrack,
        { id: 'aux-renamed', kind: 'visual', label: 'Aux', muted: false },
        { id: 'audio-renamed', kind: 'audio', label: 'Audio', muted: false },
      ],
      clips: [
        clip('unrelated', 0, 2, 'aux-renamed'),
        clip('source-a', 0),
        clip('source-b', 2),
        clip('audio-unrelated', 4, 2, 'audio-renamed'),
      ],
    });

    expect(withUnrelated.map(({ sourceClipId, id, checkpointId }) => (
      [sourceClipId, id, checkpointId]
    ))).toEqual(base.map(({ sourceClipId, id, checkpointId }) => (
      [sourceClipId, id, checkpointId]
    )));
  });

  it('covers the full scope beyond 128 entries and timelines beyond one hour', () => {
    const clips = Array.from({ length: 130 }, (_, index) => clip(`clip-${index}`, 7200 + index));
    const markers = deriveRecallPulseMarkers({ clips, tracks: [primaryTrack] });
    expect(markers).toHaveLength(130);
    expect(markers.at(-1)?.sourceClipId).toBe('clip-129');
    expect(markers.at(-1)?.time).toBe(7329);
    expect(normalizeRecallPulseTime(7200)).toBe(7200);
  });

  it('returns no fabricated suggestions for invalid or unsupported snapshots', () => {
    expect(deriveRecallPulseMarkers({ clips: [clip('a', 0)], tracks: [] })).toEqual([]);
    expect(deriveRecallPulseMarkers({
      clips: [clip('bad', Number.NaN), clip('negative', -2, 3)],
      tracks: [primaryTrack],
    })).toEqual([]);
    expect(normalizeRecallPulseTime(Number.NaN)).toBe(0);
    expect(normalizeRecallPulseTime(-1)).toBe(0);
  });

  it('writes a versioned generated envelope with explicit method and stable canonical order', () => {
    const snapshot = createCreativeLabSnapshot({ baseVersion: 7 });
    const markers = deriveRecallPulseMarkers({
      tracks: [primaryTrack],
      clips: [clip('late', 5), clip('early', 1)],
    });
    const patch = buildRecallPulsePatch(RECALL_PULSE_EXTENSION_ID, snapshot, markers.reverse());
    expect(patch).toMatchObject({
      version: 7,
      source: RECALL_PULSE_EXTENSION_ID,
      meta: {
        kind: 'recall-pulse-build',
        generatedFromVersion: 7,
        analysis: expect.stringContaining('interrogative-unassigned-read-only'),
      },
    });
    expect(patch.operations[0]).toMatchObject({
      op: 'project-data.write',
      target: RECALL_PULSE_EXTENSION_ID,
      payload: {
        key: RECALL_PULSE_DATA_KEY,
        mode: 'replace',
        value: {
          schemaVersion: RECALL_PULSE_SCHEMA_VERSION,
          generatedFromVersion: 7,
          stale: false,
          suggestions: expect.arrayContaining([
            expect.objectContaining({ sourceClipId: 'early', assignment: 'unassigned' }),
          ]),
        },
      },
    });
    const value = patch.operations[0].payload?.value as { suggestions: Array<{ time: number }> };
    expect(value.suggestions.map((entry) => entry.time)).toEqual([1, 5]);
  });

  it('sorts reads canonically and exposes staleness after source edit, delete, or version advance', () => {
    const stored = deriveRecallPulseMarkers({
      tracks: [primaryTrack],
      clips: [clip('source-a', 0), clip('source-b', 4)],
    });
    const snapshot = createCreativeLabSnapshot({
      baseVersion: 11,
      currentVersion: 12,
      clips: [clip('source-a', 0)],
      tracks: [primaryTrack],
      app: {
        [RECALL_PULSE_EXTENSION_ID]: {
          [RECALL_PULSE_DATA_KEY]: {
            schemaVersion: RECALL_PULSE_SCHEMA_VERSION,
            generatedFromVersion: 11,
            stale: false,
            suggestions: stored.slice().reverse(),
          },
        },
      },
    });
    const envelope = readRecallPulseEnvelope(snapshot);
    expect(envelope.stale).toBe(true);
    expect(envelope.suggestions.map((entry) => entry.sourceClipId)).toEqual(['source-a', 'source-b']);
    expect(readRecallPulseMarkers(snapshot).map((entry) => entry.time)).toEqual([0, 4]);
    expect(deriveRecallPulseMarkers(snapshot).map((entry) => entry.sourceClipId)).toEqual(['source-a']);
  });

  it('keeps identical source facts fresh across unrelated version writes and stales on source changes', () => {
    const source = {
      clips: [clip('source-a', 0, 2, 'V1'), clip('source-b', 4, 2, 'V1')],
      tracks: [primaryTrack],
    };
    const markers = deriveRecallPulseMarkers(source);
    const sourceSignature = computeRecallPulseSourceSignature(source);
    expect(sourceSignature).toMatch(/^reigh-fnv1a64-v1:[0-9a-f]{16}$/);
    const patch = buildRecallPulsePatch(
      RECALL_PULSE_EXTENSION_ID,
      createCreativeLabSnapshot({ baseVersion: 3 }),
      markers,
      { sourceSignature },
    );
    const storedValue = patch.operations[0].payload?.value;
    const app = { [RECALL_PULSE_EXTENSION_ID]: { [RECALL_PULSE_DATA_KEY]: storedValue } };
    const unchanged = createCreativeLabSnapshot({
      baseVersion: 3,
      currentVersion: 99,
      ...source,
      app,
    });
    expect(readRecallPulseEnvelope(unchanged).stale).toBe(false);

    expect(readRecallPulseEnvelope(createCreativeLabSnapshot({
      baseVersion: 3,
      currentVersion: 99,
      clips: [clip('source-a', 1, 2, 'V1'), clip('source-b', 4, 2, 'V1')],
      tracks: [primaryTrack],
      app,
    })).stale).toBe(true);
    expect(readRecallPulseEnvelope(createCreativeLabSnapshot({
      baseVersion: 3,
      currentVersion: 99,
      clips: [clip('source-a', 0, 2, 'V1')],
      tracks: [primaryTrack],
      app,
    })).stale).toBe(true);
    expect(readRecallPulseEnvelope(createCreativeLabSnapshot({
      baseVersion: 3,
      currentVersion: 99,
      clips: [
        { ...clip('source-a', 0, 2, 'V1'), clipType: 'changed' },
        clip('source-b', 4, 2, 'V1'),
      ],
      tracks: [primaryTrack],
      app,
    })).stale).toBe(true);
    expect(readRecallPulseEnvelope(createCreativeLabSnapshot({
      baseVersion: 3,
      currentVersion: 99,
      ...source,
      tracks: [{ id: 'inserted', kind: 'visual', label: 'Inserted', muted: false }, primaryTrack],
      app,
    })).stale).toBe(true);
  });

  it('ignores malformed persisted data while canonicalizing legacy identity fields', () => {
    const markers = readRecallPulseMarkers({
      app: {
        [RECALL_PULSE_EXTENSION_ID]: {
          [RECALL_PULSE_DATA_KEY]: {
            schemaVersion: 1,
            generatedFromVersion: 2,
            suggestions: [
              { sourceClipId: 'b', category: 'example', time: 3, duration: 1, intensity: 0.5 },
              null,
              { sourceClipId: 'bad', category: 'unknown', time: 1, duration: 1 },
              { sourceClipId: 'negative', category: 'example', time: -1, duration: 1 },
            ],
          },
        },
      },
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: 'recall-suggestion-b',
      checkpointId: 'recall-checkpoint-b',
      assignment: 'unassigned',
      prompt: expect.stringMatching(/\?$/),
    });
  });

  it('guards the command when there is no eligible editorial track', () => {
    const harness = createCreativeLabExtensionHarness(recallPulseExtension);
    const activation = recallPulseExtension.activate?.(harness.ctx);
    harness.getCommand(BUILD_RECALL_PULSE_COMMAND)?.({
      commandId: BUILD_RECALL_PULSE_COMMAND,
      extensionId: RECALL_PULSE_EXTENSION_ID,
    });
    expect(harness.patches).toHaveLength(0);
    activation?.dispose();
  });

  it('builds from the current snapshot and disposes activation handles idempotently', () => {
    const harness = createCreativeLabExtensionHarness(recallPulseExtension, createCreativeLabSnapshot({
      baseVersion: 4,
      clips: [clip('a', 0)],
      tracks: [primaryTrack],
    }));
    const activation = recallPulseExtension.activate?.(harness.ctx);
    harness.getCommand(BUILD_RECALL_PULSE_COMMAND)?.({
      commandId: BUILD_RECALL_PULSE_COMMAND,
      extensionId: RECALL_PULSE_EXTENSION_ID,
    });
    expect(harness.patches).toHaveLength(1);
    expect(harness.patches[0].version).toBe(4);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
    expect(harness.getCommand(BUILD_RECALL_PULSE_COMMAND)).toBeUndefined();
  });

  it('renders read-only markers with no drag/change callback', () => {
    const stored = deriveRecallPulseMarkers({ tracks: [primaryTrack], clips: [clip('a', 0)] });
    const harness = createCreativeLabExtensionHarness(recallPulseExtension, createCreativeLabSnapshot({
      currentVersion: 3,
      app: { [RECALL_PULSE_EXTENSION_ID]: { [RECALL_PULSE_DATA_KEY]: {
        schemaVersion: RECALL_PULSE_SCHEMA_VERSION,
        generatedFromVersion: 3,
        stale: false,
        suggestions: stored,
      } } },
    }));
    const activation = recallPulseExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(RECALL_PULSE_OVERLAY_RENDER_ID);
    const rendered = renderer?.({
      primitives: { markerLayer: (options: unknown) => options },
    } as TimelineOverlayRenderProps) as { interactive: boolean; snap: boolean; onChange?: unknown };
    expect(rendered.interactive).toBe(false);
    expect(rendered.snap).toBe(false);
    expect(rendered.onChange).toBeUndefined();
    activation?.dispose();
  });
});
