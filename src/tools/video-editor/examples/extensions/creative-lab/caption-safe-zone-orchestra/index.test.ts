import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
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
import {
  BUILD_CAPTION_FINDINGS_COMMAND,
  CAPTION_FINDINGS_DATA_KEY,
  CAPTION_OVERLAY_RENDER_ID,
  CAPTION_SAFE_ZONE_EXTENSION_ID,
  MAX_CAPTION_FINDINGS,
  MAX_CAPTION_SCAN_CLIPS,
  MIN_CAPTION_SECONDS,
  buildCaptionSafeZonePatch,
  captionSafeZoneOrchestraExtension,
  deriveCaptionSafetyFindings,
  normalizeCaptionTime,
  readCaptionSafetyFindings,
} from './index';

function snapshot(overrides: Partial<TimelineSnapshot> = {}): TimelineSnapshot {
  return {
    projectId: 'caption-fixture',
    baseVersion: 7,
    currentVersion: 7,
    extensionRequirements: [],
    clips: [],
    tracks: [],
    assetKeys: [],
    app: {},
    ...overrides,
  };
}

function createHarness(initial: TimelineSnapshot = snapshot()): {
  ctx: ExtensionContext;
  command: { id: string; handler: (run: unknown) => void } | null;
  renderer: ExtensionRenderer<TimelineOverlayRenderProps> | null;
  patches: TimelinePatch[];
  setSnapshot(next: TimelineSnapshot): void;
  commandDisposals: number;
  rendererDisposals: number;
} {
  let command: { id: string; handler: (run: unknown) => void } | null = null;
  let renderer: ExtensionRenderer<TimelineOverlayRenderProps> | null = null;
  let commandDisposals = 0;
  let rendererDisposals = 0;
  const patches: TimelinePatch[] = [];
  const commands: ExtensionCommandService = {
    registerCommand(id, handler): DisposeHandle {
      command = { id, handler: handler as (run: unknown) => void };
      return { dispose: () => { commandDisposals += 1; } };
    },
  };
  const ui: ExtensionUiService = {
    registerRenderer(_id, nextRenderer): DisposeHandle {
      renderer = nextRenderer as ExtensionRenderer<TimelineOverlayRenderProps>;
      return { dispose: () => { rendererDisposals += 1; } };
    },
  };
  let current = initial;
  const reader: TimelineReader = { snapshot: () => current };
  const timeline = {
    apply(patch: TimelinePatch): TimelineDiff {
      patches.push(patch);
      return {} as TimelineDiff;
    },
  } as TimelineOps;
  const ctx = createExtensionContext(
    captionSafeZoneOrchestraExtension,
    { reader, timeline },
    commands,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    ui,
  );
  return {
    ctx,
    get command() { return command; },
    get renderer() { return renderer; },
    patches,
    setSnapshot(next) { current = next; },
    get commandDisposals() { return commandDisposals; },
    get rendererDisposals() { return rendererDisposals; },
  };
}

describe('Caption Safe-Zone Orchestra extension', () => {
  it('keeps the checked-in package manifest aligned with the SDK manifest', () => {
    const packageManifest = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'reigh-extension.json'), 'utf8'),
    ).manifest;
    expect(packageManifest).toEqual(captionSafeZoneOrchestraExtension.manifest);
  });

  it('derives deterministic structural caption findings from public metadata', () => {
    const clips = [
      { id: 'subtitle-b', track: 'V1', at: 0.25, duration: 0.5, clipType: 'subtitle', managed: false },
      { id: 'text-a', track: 'V1', at: 0, duration: 0.5, clipType: 'text', managed: false },
      { id: 'caption-audio', track: 'A1', at: 2, duration: 1, clipType: 'caption', managed: false },
    ];
    const tracks = [
      { id: 'V1', kind: 'visual' as const, label: 'Video', muted: false },
      { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
    ];
    const first = deriveCaptionSafetyFindings({ clips, tracks });
    const second = deriveCaptionSafetyFindings({ clips: [...clips].reverse(), tracks });

    expect(first).toEqual(second);
    expect(first.map((item) => [item.sourceClipId, item.kind, item.time])).toEqual([
      ['subtitle-b', 'overlap', 0.25],
      ['text-a', 'too-brief', 0],
      ['subtitle-b', 'too-brief', 0.25],
      ['caption-audio', 'non-visual-track', 2],
    ]);
    expect(first.every((item) => item.time >= 0)).toBe(true);
    expect(first.every((item) => item.kind in {
      'too-brief': true,
      overlap: true,
      'non-visual-track': true,
      'negative-start': true,
    })).toBe(true);
    expect(MIN_CAPTION_SECONDS).toBe(0.8);
  });

  it('bounds malformed numeric input and finding count', () => {
    const malformed = [
      { id: 'nan', track: 'V1', at: Number.NaN, duration: 1, clipType: 'caption', managed: false },
      { id: 'infinite', track: 'V1', at: Number.POSITIVE_INFINITY, duration: 1, clipType: 'caption', managed: false },
      { id: 'negative', track: 'V1', at: -1, duration: 0.5, clipType: 'caption', managed: false },
    ];
    const findings = deriveCaptionSafetyFindings({
      clips: malformed,
      tracks: [{ id: 'V1', kind: 'visual', label: 'Video', muted: false }],
    });
    expect(findings).toEqual([
      expect.objectContaining({ sourceClipId: 'negative', kind: 'negative-start', time: 0 }),
      expect.objectContaining({ sourceClipId: 'negative', kind: 'too-brief', time: 0 }),
    ]);
    const many = Array.from({ length: MAX_CAPTION_SCAN_CLIPS * 2 }, (_, index) => ({
      id: `caption-${index}`,
      track: 'V1',
      at: index * 2,
      duration: 0.5,
      clipType: 'caption',
      managed: false,
    }));
    expect(deriveCaptionSafetyFindings({ clips: many, tracks: [] })).toHaveLength(MAX_CAPTION_FINDINGS);
    expect(normalizeCaptionTime(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeCaptionTime(-4)).toBe(0);
    expect(normalizeCaptionTime(60 * 60 + 2)).toBe(3602);
  });

  it('does not mistake substring-matching custom graphics for captions', () => {
    const clips = [
      { id: 'texture', track: 'V1', at: 0, duration: 0.2, clipType: 'texture', managed: false },
      { id: 'context', track: 'V1', at: 1, duration: 0.2, clipType: 'context-card', managed: false },
      { id: 'real-text', track: 'V1', at: 2, duration: 0.2, clipType: 'text', managed: false },
    ];
    expect(deriveCaptionSafetyFindings({ clips, tracks: [] }).map((item) => item.sourceClipId))
      .toEqual(['real-text']);
  });

  it('reads malformed persisted data defensively', () => {
    expect(readCaptionSafetyFindings({
      app: {
        [CAPTION_SAFE_ZONE_EXTENSION_ID]: {
          [CAPTION_FINDINGS_DATA_KEY]: [
            { nope: true },
            { id: 'bad-time', sourceClipId: 'x', kind: 'overlap', severity: 'error', time: Number.NaN, label: 'x', color: '#fff' },
          ],
        },
      },
    })).toEqual([]);
    expect(readCaptionSafetyFindings({
      app: { [CAPTION_SAFE_ZONE_EXTENSION_ID]: [] },
    })).toEqual([]);
  });

  it('builds an extension-owned project-data write patch', () => {
    const findings = deriveCaptionSafetyFindings({ clips: [], tracks: [] });
    const patch = buildCaptionSafeZonePatch(CAPTION_SAFE_ZONE_EXTENSION_ID, snapshot(), findings);
    expect(patch.version).toBe(7);
    expect(patch.source).toBe(CAPTION_SAFE_ZONE_EXTENSION_ID);
    expect(patch.meta).toMatchObject({ analysis: 'structural-proxy' });
    expect(patch.operations).toEqual([{
      op: 'project-data.write',
      target: CAPTION_SAFE_ZONE_EXTENSION_ID,
      payload: { key: CAPTION_FINDINGS_DATA_KEY, mode: 'replace', value: findings },
    }]);
  });

  it('registers command and overlay, invokes command, and disposes both', () => {
    const harness = createHarness(snapshot({
      clips: [{ id: 'caption-a', track: 'V1', at: 1, duration: 0.5, clipType: 'caption', managed: false }],
      tracks: [{ id: 'V1', kind: 'visual', label: 'Video', muted: false }],
    }));
    const activation = captionSafeZoneOrchestraExtension.activate?.(harness.ctx);
    expect(harness.command?.id).toBe(BUILD_CAPTION_FINDINGS_COMMAND);
    expect(harness.renderer).toEqual(expect.any(Function));
    harness.command?.handler({ commandId: BUILD_CAPTION_FINDINGS_COMMAND });
    expect(harness.patches[0].operations[0]).toMatchObject({
      op: 'project-data.write',
      target: CAPTION_SAFE_ZONE_EXTENSION_ID,
    });
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders source-aware read-only derived findings', () => {
    const stored = deriveCaptionSafetyFindings({
      clips: [{ id: 'caption-a', track: 'V1', at: 1, duration: 0.5, clipType: 'caption', managed: false }],
      tracks: [{ id: 'V1', kind: 'visual', label: 'Video', muted: false }],
    });
    const harness = createHarness(snapshot({
      app: { [CAPTION_SAFE_ZONE_EXTENSION_ID]: { [CAPTION_FINDINGS_DATA_KEY]: stored } },
    }));
    const activation = captionSafeZoneOrchestraExtension.activate?.(harness.ctx);
    const rendered = harness.renderer?.({
      primitives: { markerLayer: (options: unknown) => options },
    } as TimelineOverlayRenderProps) as any;
    expect(rendered.markers).toHaveLength(1);
    expect(rendered.markers[0].time).toBe(1);
    expect(rendered.markers[0].label).toContain('caption-a');
    expect(rendered.interactive).toBe(false);
    expect(rendered.onChange).toBeUndefined();
    expect(harness.patches).toHaveLength(0);
    activation?.dispose();
  });

  it('declares the command and overlay identifiers used at activation', () => {
    expect(captionSafeZoneOrchestraExtension.manifest.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', command: BUILD_CAPTION_FINDINGS_COMMAND }),
      expect.objectContaining({ kind: 'timelineOverlay', render: CAPTION_OVERLAY_RENDER_ID }),
    ]));
  });
});
