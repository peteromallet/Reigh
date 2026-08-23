import { describe, expect, it } from 'vitest';
import type { TimelineOverlayRenderProps, TimelinePatch } from '@reigh/editor-sdk';
import {
  BUILD_LOCKLINE_REPORT_COMMAND,
  LOCKLINE_INSPECTOR_EXTENSION_ID,
  LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID,
  LOCKLINE_REPORT_DATA_KEY,
  LOCKLINE_REPORT_SCHEMA_VERSION,
  MAX_LOCKLINE_FINDINGS,
  buildLocklinePatch,
  deriveLocklineAnalysis,
  deriveLocklineFindings,
  isLocklineReportStale,
  locklineInspectorExtension,
  normalizeLocklineTime,
  readLocklineEnvelope,
  readLocklineFindings,
} from './index';
import {
  createCreativeLabExtensionHarness,
  createCreativeLabSnapshot,
} from '../testing/createCreativeLabHarness';

const tracks = [
  { id: 'V1', kind: 'visual' as const, label: 'Picture', muted: false },
  { id: 'V2', kind: 'visual' as const, label: 'Muted alt', muted: true },
  { id: 'A1', kind: 'audio' as const, label: 'Audio', muted: false },
];

describe('Lockline Inspector extension', () => {
  it('keeps the JSON manifest aligned with the public extension manifest', async () => {
    const manifestModule = await import('./reigh-extension.json');
    expect(manifestModule.default.manifest).toEqual(locklineInspectorExtension.manifest);
  });

  it('reports only public registry/provenance inconsistencies with useful identities', () => {
    const snapshot = {
      clips: [{
        id: 'asset-clip',
        track: 'V1',
        at: 12.25,
        duration: 2,
        managed: false,
        materialRefs: [
          { id: 'missing-ref', clipId: 'asset-clip', assetKey: 'missing.mov' },
          { id: 'wrong-material-owner', clipId: 'other', assetKey: 'online.mov' },
        ],
        sourceRefs: [{
          id: 'wrong-source-owner',
          clipId: 'other',
          sourceKind: 'generation' as const,
          generationId: 'generation-1',
        }],
      }],
      tracks,
      assetKeys: ['online.mov'],
    };
    const forward = deriveLocklineFindings(snapshot);
    const reverse = deriveLocklineFindings({ ...snapshot, clips: [...snapshot.clips].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward.map((item) => item.kind)).toEqual([
      'material-ref-clip-mismatch',
      'missing-registry-asset-key',
      'source-ref-clip-mismatch',
    ]);
    expect(forward.find((item) => item.kind === 'missing-registry-asset-key')).toMatchObject({
      severity: 'error',
      sourceClipId: 'asset-clip',
      trackId: 'V1',
      time: 12.25,
      referenceIds: ['missing-ref'],
      assetKeys: ['missing.mov'],
    });
    expect(forward.every((item) => item.label.includes('clip asset-clip'))).toBe(true);
  });

  it('does not flag ordinary unmanaged clips or duplicate Faultline continuity findings', () => {
    const findings = deriveLocklineFindings({
      clips: [
        { id: 'picture-a', track: 'V1', at: 0, duration: 0.1, managed: false },
        { id: 'picture-b', track: 'V1', at: 0.05, duration: 1, managed: false },
        { id: 'muted-gap', track: 'V2', at: 50, duration: 0.2, managed: false },
        { id: 'audio-a', track: 'A1', at: 0, duration: 0.1, managed: false },
        { id: 'audio-b', track: 'A1', at: 100, duration: 0.1, managed: false },
      ],
      tracks,
      assetKeys: [],
    });
    expect(findings).toEqual([]);
  });

  it('does not let ordinary clips starve a later missing-key error', () => {
    const ordinary = Array.from({ length: 300 }, (_, index) => ({
      id: `ordinary-${index}`,
      track: 'V1',
      at: index,
      duration: 0.5,
      managed: false,
    }));
    const findings = deriveLocklineFindings({
      clips: [...ordinary, {
        id: 'late-error',
        track: 'V1',
        at: 301,
        duration: 1,
        managed: false,
        materialRefs: [{ id: 'late-ref', clipId: 'late-error', assetKey: 'missing.mov' }],
      }],
      tracks,
      assetKeys: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'missing-registry-asset-key',
      sourceClipId: 'late-error',
      referenceIds: ['late-ref'],
    });
  });

  it('collects before bounding, prioritizes errors, and records omitted coverage', () => {
    const warningClips = Array.from({ length: MAX_LOCKLINE_FINDINGS }, (_, index) => ({
      id: `warning-${index}`,
      track: 'V1',
      at: index,
      duration: 1,
      managed: true,
      sourceRefs: [{
        id: `source-${index}`,
        clipId: 'wrong-owner',
        sourceKind: 'unknown' as const,
      }],
    }));
    const analysis = deriveLocklineAnalysis({
      clips: [...warningClips, {
        id: 'late-error',
        track: 'V1',
        at: 300,
        duration: 1,
        managed: true,
        materialRefs: [{ id: 'missing-ref', clipId: 'late-error', assetKey: 'missing.mov' }],
      }],
      tracks,
      assetKeys: [],
    });
    expect(analysis.entries).toHaveLength(MAX_LOCKLINE_FINDINGS);
    expect(analysis.entries.some((item) => item.sourceClipId === 'late-error')).toBe(true);
    expect(analysis.coverage).toMatchObject({
      totalClips: MAX_LOCKLINE_FINDINGS + 1,
      scannedClips: MAX_LOCKLINE_FINDINGS + 1,
      candidateFindings: MAX_LOCKLINE_FINDINGS + 1,
      persistedFindings: MAX_LOCKLINE_FINDINGS,
      omittedFindings: 1,
      omittedClips: 0,
    });
  });

  it('aggregates multiple missing registry keys and material-ref identities per clip', () => {
    const findings = deriveLocklineFindings({
      clips: [{
        id: 'multi-ref',
        track: 'V1',
        at: 2,
        duration: 1,
        managed: true,
        materialRefs: [
          { id: 'ref-b', clipId: 'multi-ref', assetKey: 'b.mov' },
          { id: 'ref-a', clipId: 'multi-ref', assetKey: 'a.mov' },
          { id: 'ref-a-duplicate', clipId: 'multi-ref', assetKey: 'a.mov' },
        ],
      }],
      tracks,
      assetKeys: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'lockline-missing-registry-asset-key-multi-ref',
      referenceIds: ['ref-a', 'ref-a-duplicate', 'ref-b'],
      assetKeys: ['a.mov', 'b.mov'],
    });
  });

  it('excludes malformed root-broken clips without manufacturing secondary findings', () => {
    const analysis = deriveLocklineAnalysis({
      clips: [
        {
          id: 'nan', track: 'V1', at: Number.NaN, duration: 1, managed: false,
          materialRefs: [{ id: 'nan-ref', clipId: 'nan', assetKey: 'missing.mov' }],
        },
        {
          id: 'negative', track: 'V1', at: -1, duration: -2, managed: false,
          materialRefs: [{ id: 'negative-ref', clipId: 'negative', assetKey: 'missing.mov' }],
        },
        {
          id: 'missing-track', track: 'V9', at: 1, duration: 1, managed: false,
          materialRefs: [{ id: 'track-ref', clipId: 'missing-track', assetKey: 'missing.mov' }],
        },
        {
          id: 'zero', track: 'V1', at: 1, duration: 0, managed: false,
          materialRefs: [{ id: 'zero-ref', clipId: 'zero', assetKey: 'missing.mov' }],
        },
      ],
      tracks,
      assetKeys: [],
    });
    expect(analysis.entries).toEqual([]);
    expect(analysis.coverage).toMatchObject({ scannedClips: 4, eligibleClips: 0, skippedInvalidClips: 4 });
    expect(normalizeLocklineTime(Number.NaN)).toBe(0);
    expect(normalizeLocklineTime(-1)).toBe(0);
  });

  it('preserves finding times beyond one hour', () => {
    const findings = deriveLocklineFindings({
      clips: [{
        id: 'feature-length',
        track: 'V1',
        at: 7_200.1254,
        duration: 1,
        managed: true,
        materialRefs: [{ id: 'feature-ref', clipId: 'feature-length', assetKey: 'missing.mov' }],
      }],
      tracks,
      assetKeys: [],
    });
    expect(findings[0].time).toBe(7_200.125);
    expect(normalizeLocklineTime(99_999)).toBe(99_999);
  });

  it('uses source facts, not unrelated global version advances, to detect staleness', () => {
    const source = createCreativeLabSnapshot({
      baseVersion: 7,
      currentVersion: 7,
      tracks,
      clips: [{
        id: 'asset',
        track: 'V1',
        at: 1,
        duration: 1,
        managed: true,
        materialRefs: [{ id: 'asset-ref', clipId: 'asset', assetKey: 'missing.mov' }],
      }],
      assetKeys: [],
    });
    const analysis = deriveLocklineAnalysis(source);
    expect(analysis.sourceSignature).toMatch(/^reigh-fnv1a64-v1:[0-9a-f]{16}$/);
    const patch = buildLocklinePatch(LOCKLINE_INSPECTOR_EXTENSION_ID, source, analysis);
    const envelope = (patch.operations[0] as any).payload.value;
    expect(patch).toMatchObject({
      version: 7,
      source: LOCKLINE_INSPECTOR_EXTENSION_ID,
      meta: { analysis: 'public-registry-provenance-only', generatedFromVersion: 7 },
    });
    expect(envelope).toMatchObject({
      schemaVersion: LOCKLINE_REPORT_SCHEMA_VERSION,
      generatedFromVersion: 7,
      sourceSignature: analysis.sourceSignature,
      coverage: analysis.coverage,
      entries: analysis.entries,
    });

    const persisted = createCreativeLabSnapshot({
      ...source,
      baseVersion: 8,
      currentVersion: 8,
      app: { [LOCKLINE_INSPECTOR_EXTENSION_ID]: { [LOCKLINE_REPORT_DATA_KEY]: envelope } },
    });
    const read = readLocklineEnvelope(persisted);
    expect(isLocklineReportStale(persisted, read)).toBe(false);
    expect(isLocklineReportStale({ ...persisted, baseVersion: 18, currentVersion: 18 }, read)).toBe(false);
    expect(isLocklineReportStale({ ...persisted, assetKeys: ['missing.mov'] }, read)).toBe(true);
    expect(isLocklineReportStale({
      ...persisted,
      clips: [{
        ...persisted.clips[0],
        materialRefs: [{ id: 'asset-ref-2', clipId: 'asset', assetKey: 'missing.mov' }],
      }],
    }, read)).toBe(true);
    expect(isLocklineReportStale({
      ...persisted,
      clips: [{ ...persisted.clips[0], at: 2 }],
    }, read)).toBe(true);
    expect(isLocklineReportStale({
      ...persisted,
      tracks: [...persisted.tracks, {
        id: 'A2', kind: 'audio', label: 'New audio', muted: false,
      }],
    }, read)).toBe(true);
    expect(isLocklineReportStale(persisted, { ...read, schemaVersion: 0 })).toBe(true);
    expect(isLocklineReportStale(persisted, { ...read, generatedFromVersion: 99 })).toBe(true);
  });

  it('renders detailed stale-aware findings as a read-only marker layer', () => {
    const source = createCreativeLabSnapshot({
      baseVersion: 4,
      currentVersion: 4,
      tracks,
      clips: [{
        id: 'asset',
        track: 'V1',
        at: 2,
        duration: 1,
        managed: true,
        materialRefs: [{ id: 'asset-ref', clipId: 'asset', assetKey: 'missing.mov' }],
      }],
      assetKeys: [],
    });
    const analysis = deriveLocklineAnalysis(source);
    const envelope = (buildLocklinePatch(LOCKLINE_INSPECTOR_EXTENSION_ID, source, analysis).operations[0] as any)
      .payload.value;
    const harness = createCreativeLabExtensionHarness(locklineInspectorExtension, createCreativeLabSnapshot({
      ...source,
      baseVersion: 6,
      currentVersion: 6,
      clips: [{ ...source.clips[0], duration: 2 }],
      app: { [LOCKLINE_INSPECTOR_EXTENSION_ID]: { [LOCKLINE_REPORT_DATA_KEY]: envelope } },
    }));
    const activation = locklineInspectorExtension.activate?.(harness.ctx);
    const renderer = harness.getRenderer<TimelineOverlayRenderProps>(LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID);
    const rendered = renderer?.({ primitives: { markerLayer: (options: unknown) => options } } as TimelineOverlayRenderProps) as any;
    expect(rendered).toMatchObject({ interactive: false, snap: false });
    expect(rendered.onChange).toBeUndefined();
    expect(rendered.markers).toHaveLength(1);
    expect(rendered.markers[0].label).toContain('stale · error · clip asset');
    expect(rendered.markers[0].label).toContain('missing registry asset key');
    expect(rendered.markers[0].label).toContain('asset-ref');
    activation?.dispose();
  });

  it('registers the command, writes the envelope, and disposes idempotently', () => {
    const harness = createCreativeLabExtensionHarness(locklineInspectorExtension, createCreativeLabSnapshot({
      tracks,
      clips: [{
        id: 'asset',
        track: 'V1',
        at: 1,
        duration: 1,
        managed: false,
        materialRefs: [{ id: 'asset-ref', clipId: 'asset', assetKey: 'missing.mov' }],
      }],
    }));
    const activation = locklineInspectorExtension.activate?.(harness.ctx);
    expect(harness.getCommand(BUILD_LOCKLINE_REPORT_COMMAND)).toEqual(expect.any(Function));
    expect(harness.getRenderer(LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID)).toEqual(expect.any(Function));
    harness.getCommand(BUILD_LOCKLINE_REPORT_COMMAND)?.({
      commandId: BUILD_LOCKLINE_REPORT_COMMAND,
      extensionId: LOCKLINE_INSPECTOR_EXTENSION_ID,
    });
    expect(harness.patches).toHaveLength(1);
    expect((harness.patches[0].operations[0] as any).payload.value.entries).toHaveLength(1);
    activation?.dispose();
    activation?.dispose();
    expect(harness.commandDisposals).toBe(1);
    expect(harness.rendererDisposals).toBe(1);
  });

  it('rolls back an earlier registration when activation fails partway through', () => {
    const harness = createCreativeLabExtensionHarness(locklineInspectorExtension);
    const failingContext = {
      ...harness.ctx,
      ui: {
        ...harness.ctx.ui,
        registerRenderer(): never {
          throw new Error('renderer unavailable');
        },
      },
    } as typeof harness.ctx;
    expect(() => locklineInspectorExtension.activate?.(failingContext)).toThrow('renderer unavailable');
    expect(harness.commandDisposals).toBe(1);
    expect(harness.getCommand(BUILD_LOCKLINE_REPORT_COMMAND)).toBeUndefined();
  });

  it('rejects malformed, legacy, or foreign persisted project data', () => {
    expect(readLocklineFindings({
      app: {
        [LOCKLINE_INSPECTOR_EXTENSION_ID]: {
          [LOCKLINE_REPORT_DATA_KEY]: {
            schemaVersion: 1,
            generatedFromVersion: 1,
            sourceSignature: 'sig',
            coverage: {},
            entries: [null, { nope: true }, { id: 'bad', kind: 'gap', time: Number.NaN }],
          },
        },
      },
    })).toEqual([]);
    expect(readLocklineEnvelope({
      app: { [LOCKLINE_INSPECTOR_EXTENSION_ID]: { [LOCKLINE_REPORT_DATA_KEY]: [] } },
    }).sourceSignature).toBe('');
    expect(readLocklineFindings({ app: { other: { [LOCKLINE_REPORT_DATA_KEY]: [] } } })).toEqual([]);
  });

  it('keeps the patch type explicit for public contract checks', () => {
    const snapshot = createCreativeLabSnapshot();
    const patch: TimelinePatch = buildLocklinePatch(
      LOCKLINE_INSPECTOR_EXTENSION_ID,
      snapshot,
      deriveLocklineAnalysis(snapshot),
    );
    expect(patch.operations[0].op).toBe('project-data.write');
  });
});
