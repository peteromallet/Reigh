import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps, TimelinePatch } from '@reigh/editor-sdk';
import {
  BUILD_TIMELINE_FAULTLINE_COMMAND,
  MAX_FAULTLINE_FINDINGS,
  MAX_FAULTLINE_SCAN_CLIPS,
  TIMELINE_FAULTLINE_DATA_KEY,
  TIMELINE_FAULTLINE_EXTENSION_ID,
  TIMELINE_FAULTLINE_OVERLAY_RENDER_ID,
  TIMELINE_FAULTLINE_SCHEMA_VERSION,
  buildFaultlinePatch,
  deriveFaultlineFindings,
  normalizeFaultlineTime,
  readFaultlineEnvelope,
  readFaultlineFindings,
  timelineFaultlineExtension,
} from './index';
import { createCreativeLabExtensionHarness, createCreativeLabSnapshot } from '../testing/createCreativeLabHarness';

const visualTracks = [
  { id: 'V1', kind: 'visual' as const, label: 'Primary', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted auxiliary', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
];

describe('Timeline Faultline extension', () => {
  it('keeps the JSON manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(timelineFaultlineExtension.manifest);
  });

  it('uses the primary unmuted visual track and excludes invalid clips from continuity', () => {
    const findings = deriveFaultlineFindings({
      tracks: visualTracks,
      clips: [
        { id: 'base', track: 'V1', at: 0, duration: 1, managed: false },
        { id: 'primary-gap', track: 'V1', at: 3, duration: 1, managed: false },
        { id: 'muted-a', track: 'V2', at: 0, duration: 1, managed: false },
        { id: 'muted-b', track: 'V2', at: 10, duration: 1, managed: false },
        { id: 'audio-a', track: 'A1', at: 0, duration: 1, managed: false },
        { id: 'audio-b', track: 'A1', at: 10, duration: 1, managed: false },
        { id: 'invalid', track: 'V1', at: Number.NaN, duration: 1, managed: false },
        { id: 'zero', track: 'V1', at: 4, duration: 0, managed: false },
      ],
    });
    expect(findings.filter((item) => item.kind === 'gap').map((item) => item.sourceClipId))
      .toEqual(['primary-gap']);
    expect(findings.some((item) => item.sourceClipId === 'muted-b' && item.kind === 'gap')).toBe(false);
    expect(findings.some((item) => item.sourceClipId === 'audio-b' && item.kind === 'gap')).toBe(false);
    expect(findings.some((item) => item.sourceClipId === 'invalid' && item.kind === 'gap')).toBe(false);
    expect(findings.some((item) => item.sourceClipId === 'invalid' && item.kind === 'non-finite')).toBe(true);
    expect(findings.some((item) => item.sourceClipId === 'zero' && item.kind === 'zero-duration')).toBe(true);
  });

  it('does not clamp long timelines and prioritizes errors when bounded', () => {
    expect(normalizeFaultlineTime(100_000)).toBe(100_000);
    const many = Array.from({ length: MAX_FAULTLINE_SCAN_CLIPS }, (_, index) => ({
      id: `clip-${index}`,
      track: 'V1',
      at: index * 2,
      duration: 1,
      managed: false,
    }));
    many.push({ id: 'critical', track: 'MISSING', at: 99999, duration: 1, managed: false });
    const findings = deriveFaultlineFindings({
      tracks: [{ id: 'V1', kind: 'visual', label: 'Primary', muted: false }],
      clips: many,
    });
    expect(findings).toHaveLength(MAX_FAULTLINE_FINDINGS);
    expect(findings.some((item) => item.sourceClipId === 'critical' && item.severity === 'error')).toBe(true);
    expect(findings.find((item) => item.sourceClipId === 'critical')?.time).toBe(99999);
  });

  it('migrates raw arrays and writes a versioned stale-aware envelope', () => {
    const finding = {
      id: 'fault-gap-b-a', sourceClipId: 'b', relatedClipId: 'a', kind: 'gap',
      severity: 'warning', time: 4, label: 'gap', color: '#52e8ff',
    } as const;
    const migrated = readFaultlineEnvelope({
      app: { [TIMELINE_FAULTLINE_EXTENSION_ID]: { [TIMELINE_FAULTLINE_DATA_KEY]: [finding] } },
    });
    expect(migrated).toMatchObject({ schemaVersion: TIMELINE_FAULTLINE_SCHEMA_VERSION, generatedFromVersion: 0, entries: [finding] });
    const patch = buildFaultlinePatch(
      TIMELINE_FAULTLINE_EXTENSION_ID,
      createCreativeLabSnapshot({ baseVersion: 7 }),
      [finding],
    );
    expect(patch.meta).toMatchObject({
      kind: 'timeline-faultline-build',
      generatedFromVersion: 7,
      analysis: 'public-structural-read-only-proxy',
    });
    expect(patch.operations[0]).toMatchObject({
      op: 'project-data.write',
      payload: { value: { schemaVersion: 1, generatedFromVersion: 7, entries: [finding] } },
    });
  });

  it('registers, invokes, and guardedly disposes both handles', () => {
    const harness = createCreativeLabExtensionHarness(timelineFaultlineExtension);
    const activation = timelineFaultlineExtension.activate?.(harness.ctx);
    expect(harness.getCommand(BUILD_TIMELINE_FAULTLINE_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(TIMELINE_FAULTLINE_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));
    harness.getCommand(BUILD_TIMELINE_FAULTLINE_COMMAND)?.({ commandId: BUILD_TIMELINE_FAULTLINE_COMMAND });
    expect(harness.patches).toHaveLength(1);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('renders clustered findings as visibly read-only markers', () => {
    const stored = deriveFaultlineFindings({
      tracks: [{ id: 'V1', kind: 'visual', label: 'Primary', muted: false }],
      clips: [
        { id: 'a', track: 'V1', at: 0, duration: 1, managed: false },
        { id: 'b', track: 'V1', at: 0.5, duration: 1, managed: false },
      ],
    });
    const harness = createCreativeLabExtensionHarness(timelineFaultlineExtension, createCreativeLabSnapshot({
      app: { [TIMELINE_FAULTLINE_EXTENSION_ID]: {
        [TIMELINE_FAULTLINE_DATA_KEY]: { schemaVersion: 1, generatedFromVersion: 3, entries: stored },
      } },
    }));
    const activation = timelineFaultlineExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(TIMELINE_FAULTLINE_OVERLAY_RENDER_ID);
    const rendered = renderer?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered.interactive).toBe(false);
    expect(rendered.onChange).toBeUndefined();
    expect(rendered.markers).toHaveLength(1);
    const custom = rendered.renderMarker(rendered.markers[0]);
    expect(custom.props['aria-label']).toContain('Read-only');
    expect(custom.props.style.height).toBeTruthy();
    activation?.dispose();
  });

  it('ignores malformed or foreign persisted project data', () => {
    expect(readFaultlineFindings({
      app: { [TIMELINE_FAULTLINE_EXTENSION_ID]: { [TIMELINE_FAULTLINE_DATA_KEY]: { entries: [{ nope: true }] } } },
    })).toEqual([]);
    expect(readFaultlineFindings({ app: { other: { [TIMELINE_FAULTLINE_DATA_KEY]: [] } } })).toEqual([]);
  });

  it('keeps the patch type explicit for public contract checks', () => {
    const patch: TimelinePatch = buildFaultlinePatch(
      TIMELINE_FAULTLINE_EXTENSION_ID,
      createCreativeLabSnapshot(),
      [],
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
