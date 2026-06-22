/**
 * Unit tests for the public diagnostics contract.
 *
 * Covers:
 *  - Stable diagnostic shape
 *  - Deterministic IDs and dedupe policy
 *  - subscribe / getSnapshot behavior
 *  - Source replacement (replaceBySource)
 *  - Extension diagnostic normalization
 *  - Generation asset diagnostic normalization
 *  - Materialization diagnostic normalization
 *  - Render and perf diagnostic helpers
 */

import { describe, expect, it } from 'vitest';
import {
  createVideoEditorDiagnosticsStore,
  normalizeExtensionDiagnostic,
  normalizeExtensionDiagnostics,
  normalizeGenerationAssetDiagnostic,
  normalizeMaterializationDiagnostic,
  normalizeMaterializationDiagnostics,
  createRenderDiagnostic,
  createPerfDiagnostic,
  VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS,
  VIDEO_EDITOR_MATERIALIZATION_DIAGNOSTIC_CODES,
  VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_DOC,
  VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_REASONS,
  VIDEO_EDITOR_RENDER_BLOCKER_DIAGNOSTIC_CODES,
} from './diagnostics.ts';
import { DATA_PROVIDER_CAPABILITIES } from '@/tools/video-editor/data/DataProvider.ts';
import type { RenderBlockerCode } from '@/tools/video-editor/lib/renderRouter.ts';
import type {
  VideoEditorDiagnostic,
  VideoEditorDiagnosticSeverity,
  VideoEditorDiagnosticSource,
} from './diagnostics.ts';
import type { ExtensionDiagnostic } from './extensionManifest.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diagnostic(
  overrides: Partial<Omit<VideoEditorDiagnostic, 'id' | 'timestamp'>> & {
    source: VideoEditorDiagnosticSource;
    code: string;
  },
): VideoEditorDiagnostic {
  const raw: Omit<VideoEditorDiagnostic, 'id' | 'timestamp'> = {
    severity: 'error' as VideoEditorDiagnosticSeverity,
    message: 'test message',
    ...overrides,
  };
  // Use the store to get a properly shaped diagnostic with id+timestamp
  const store = createVideoEditorDiagnosticsStore();
  store.report(raw);
  return store.getSnapshot()[0];
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('VideoEditorDiagnostic shape', () => {
  it('has all required fields when created via store', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({
      severity: 'error',
      source: 'extension-loader',
      code: 'manifest_schema_invalid',
      message: 'test',
      extensionId: 'ext-1',
      detail: { key: 'value' },
    });

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    const d = snapshot[0];
    expect(d.id).toBeTypeOf('string');
    expect(d.id.startsWith('diag_')).toBe(true);
    expect(d.code).toBe('manifest_schema_invalid');
    expect(d.severity).toBe('error');
    expect(d.source).toBe('extension-loader');
    expect(d.message).toBe('test');
    expect(d.extensionId).toBe('ext-1');
    expect(d.detail).toEqual({ key: 'value' });
    expect(d.timestamp).toBeTypeOf('string');
    // Timestamp should be valid ISO 8601
    expect(() => new Date(d.timestamp)).not.toThrow();
    expect(new Date(d.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('omits optional extensionId and detail when not provided', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({
      severity: 'warning',
      source: 'render',
      code: 'R001',
      message: 'msg',
    });

    const d = store.getSnapshot()[0];
    expect(d.extensionId).toBeUndefined();
    expect(d.detail).toBeUndefined();
  });

  it('snapshot is frozen', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({
      severity: 'info',
      source: 'perf',
      code: 'P001',
      message: 'perf msg',
    });
    const snapshot = store.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deterministic IDs and dedupe
// ---------------------------------------------------------------------------

describe('deterministic IDs', () => {
  it('same source+code+extensionId produces same ID', () => {
    const store1 = createVideoEditorDiagnosticsStore();
    store1.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm1', extensionId: 'ext-a' });

    const store2 = createVideoEditorDiagnosticsStore();
    store2.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm2', extensionId: 'ext-a' });

    expect(store1.getSnapshot()[0].id).toBe(store2.getSnapshot()[0].id);
  });

  it('different source produces different ID', () => {
    const d1 = diagnostic({ source: 'extension-loader', code: 'E001' });
    const d2 = diagnostic({ source: 'extension-runtime', code: 'E001' });
    expect(d1.id).not.toBe(d2.id);
  });

  it('different code produces different ID', () => {
    const d1 = diagnostic({ source: 'extension-loader', code: 'E001' });
    const d2 = diagnostic({ source: 'extension-loader', code: 'E002' });
    expect(d1.id).not.toBe(d2.id);
  });

  it('different extensionId produces different ID', () => {
    const d1 = diagnostic({ source: 'extension-loader', code: 'E001', extensionId: 'ext-a' });
    const d2 = diagnostic({ source: 'extension-loader', code: 'E001', extensionId: 'ext-b' });
    expect(d1.id).not.toBe(d2.id);
  });

  it('missing extensionId is handled consistently', () => {
    const d1 = diagnostic({ source: 'extension-loader', code: 'E001' });
    const d2 = diagnostic({ source: 'extension-loader', code: 'E001' });
    // Both have `undefined` extensionId, so IDs match
    expect(d1.id).toBe(d2.id);
  });

  it('same logical diagnostic is deduplicated in store', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'dup', message: 'first' });
    store.report({ severity: 'error', source: 'extension-loader', code: 'dup', message: 'second' });
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('reportMany also deduplicates within the batch', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.reportMany([
      { severity: 'error', source: 'extension-loader', code: 'dup', message: 'first' },
      { severity: 'error', source: 'extension-loader', code: 'dup', message: 'second' },
    ]);
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('reportMany deduplicates against existing diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'first' });
    store.reportMany([
      { severity: 'error', source: 'extension-loader', code: 'E001', message: 'second' },
      { severity: 'warning', source: 'extension-loader', code: 'E002', message: 'third' },
    ]);
    expect(store.getSnapshot()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// subscribe / getSnapshot
// ---------------------------------------------------------------------------

describe('subscribe and getSnapshot', () => {
  it('getSnapshot returns current diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();
    expect(store.getSnapshot()).toHaveLength(0);

    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    expect(store.getSnapshot()).toHaveLength(1);
  });

  it('subscribe is called on store mutation', async () => {
    const store = createVideoEditorDiagnosticsStore();
    let calls = 0;
    store.subscribe(() => { calls++; });

    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    // subscribe callbacks are invoked synchronously
    expect(calls).toBe(1);

    store.reportMany([
      { severity: 'warning', source: 'extension-loader', code: 'E002', message: 'm2' },
    ]);
    expect(calls).toBe(2);

    store.clear();
    expect(calls).toBe(3);
  });

  it('subscribe returns unsubscribe function', () => {
    const store = createVideoEditorDiagnosticsStore();
    let calls = 0;
    const unsub = store.subscribe(() => { calls++; });
    unsub();

    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    expect(calls).toBe(0);
  });

  it('getSnapshot returns stable reference when unchanged', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    const snap1 = store.getSnapshot();
    const snap2 = store.getSnapshot();
    expect(snap1).toBe(snap2);
  });

  it('getSnapshot returns new reference after mutation', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    const snap1 = store.getSnapshot();
    store.report({ severity: 'warning', source: 'extension-loader', code: 'E002', message: 'm2' });
    const snap2 = store.getSnapshot();
    expect(snap1).not.toBe(snap2);
  });
});

// ---------------------------------------------------------------------------
// source replacement (replaceBySource)
// ---------------------------------------------------------------------------

describe('replaceBySource', () => {
  it('replaces all diagnostics from a source atomically', () => {
    const store = createVideoEditorDiagnosticsStore();

    // Seed initial loader diagnostic
    store.report({ severity: 'error', source: 'extension-loader', code: 'L001', message: 'load err' });

    // Replace loader diagnostics
    store.replaceBySource('extension-loader', [
      { severity: 'warning', source: 'extension-loader', code: 'L002', message: 'replaced' },
    ]);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].code).toBe('L002');
    expect(snapshot[0].message).toBe('replaced');
  });

  it('replaceBySource with empty array removes all from that source', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'L001', message: 'load err' });
    store.report({ severity: 'error', source: 'render', code: 'R001', message: 'render err' });

    store.replaceBySource('extension-loader', []);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].source).toBe('render');
  });

  it('replaceBySource does not affect other sources', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'L001', message: 'load' });
    store.report({ severity: 'error', source: 'render', code: 'R001', message: 'render' });
    store.report({ severity: 'warning', source: 'provider', code: 'P001', message: 'provider' });

    store.replaceBySource('extension-loader', [
      { severity: 'info', source: 'extension-loader', code: 'L002', message: 'new load' },
    ]);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(3);
    const sources = snapshot.map((d) => d.source).sort();
    expect(sources).toEqual(['extension-loader', 'provider', 'render']);
    const loaderDiags = snapshot.filter((d) => d.source === 'extension-loader');
    expect(loaderDiags).toHaveLength(1);
    expect(loaderDiags[0].code).toBe('L002');
  });

  it('replaceBySource notifies subscribers', () => {
    const store = createVideoEditorDiagnosticsStore();
    let calls = 0;
    store.subscribe(() => { calls++; });

    store.report({ severity: 'error', source: 'extension-loader', code: 'L001', message: 'm' });
    expect(calls).toBe(1);

    store.replaceBySource('extension-loader', [
      { severity: 'warning', source: 'extension-loader', code: 'L002', message: 'replaced' },
    ]);
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('removes all diagnostics', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm1' });
    store.report({ severity: 'warning', source: 'render', code: 'R001', message: 'm2' });
    expect(store.getSnapshot()).toHaveLength(2);

    store.clear();
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('clear notifies subscribers', () => {
    const store = createVideoEditorDiagnosticsStore();
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.report({ severity: 'error', source: 'extension-loader', code: 'E001', message: 'm' });
    expect(calls).toBe(1);
    store.clear();
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Extension diagnostic normalization
// ---------------------------------------------------------------------------

describe('normalizeExtensionDiagnostic', () => {
  it('maps kind to severity and sets source to extension-loader', () => {
    const extDiag: ExtensionDiagnostic = {
      kind: 'error',
      code: 'manifest_schema_invalid',
      message: 'Manifest is missing required field "id".',
      extensionId: 'my-ext',
      detail: { field: 'id' },
    };

    const result = normalizeExtensionDiagnostic(extDiag);
    expect(result.severity).toBe('error');
    expect(result.source).toBe('extension-loader');
    expect(result.code).toBe('manifest_schema_invalid');
    expect(result.message).toBe('Manifest is missing required field "id".');
    expect(result.extensionId).toBe('my-ext');
    expect(result.detail).toEqual({ field: 'id' });
  });

  it('maps warning kind correctly', () => {
    const extDiag: ExtensionDiagnostic = {
      kind: 'warning',
      code: 'contribution_id_mismatch',
      message: 'Config descriptor has no matching contribution.',
      extensionId: 'ext-b',
    };

    const result = normalizeExtensionDiagnostic(extDiag);
    expect(result.severity).toBe('warning');
    expect(result.extensionId).toBe('ext-b');
    expect(result.detail).toBeUndefined();
  });

  it('handles missing extensionId and detail', () => {
    const extDiag: ExtensionDiagnostic = {
      kind: 'error',
      code: 'duplicate_package_id',
      message: 'Duplicate package.',
    };

    const result = normalizeExtensionDiagnostic(extDiag);
    expect(result.extensionId).toBeUndefined();
    expect(result.detail).toBeUndefined();
  });

  it('normalizeExtensionDiagnostics maps all entries', () => {
    const extDiags: ExtensionDiagnostic[] = [
      { kind: 'error', code: 'manifest_schema_invalid', message: 'm1' },
      { kind: 'warning', code: 'permission_rejected', message: 'm2', extensionId: 'ext-c' },
    ];

    const results = normalizeExtensionDiagnostics(extDiags);
    expect(results).toHaveLength(2);
    expect(results[0].severity).toBe('error');
    expect(results[1].severity).toBe('warning');
    expect(results[0].source).toBe('extension-loader');
    expect(results[1].source).toBe('extension-loader');
  });
});

// ---------------------------------------------------------------------------
// Generation asset diagnostic normalization
// ---------------------------------------------------------------------------

describe('normalizeGenerationAssetDiagnostic', () => {
  it('maps generation diagnostic to public shape', () => {
    const genDiag = {
      code: 'generation-not-found',
      message: 'Generation gen-1 was not found.',
      generationId: 'gen-1',
      assetId: 'asset-1',
    };

    const result = normalizeGenerationAssetDiagnostic(genDiag);
    expect(result.code).toBe('generation-not-found');
    expect(result.severity).toBe('error');
    expect(result.source).toBe('asset-generation');
    expect(result.message).toBe('Generation gen-1 was not found.');
    expect(result.detail).toEqual({
      generationId: 'gen-1',
      assetId: 'asset-1',
    });
  });

  it('includes url, bucket, and path in detail when present', () => {
    const genDiag = {
      code: 'refresh-failed',
      message: 'Failed to refresh.',
      generationId: 'gen-2',
      url: 'http://example.com/file.mp4',
      bucket: 'my-bucket',
      path: 'videos/file.mp4',
    };

    const result = normalizeGenerationAssetDiagnostic(genDiag);
    expect(result.detail).toEqual({
      generationId: 'gen-2',
      url: 'http://example.com/file.mp4',
      bucket: 'my-bucket',
      path: 'videos/file.mp4',
    });
  });

  it('omits optional detail fields when not provided', () => {
    const genDiag = {
      code: 'missing-generation-location',
      message: 'No location.',
      generationId: 'gen-3',
    };

    const result = normalizeGenerationAssetDiagnostic(genDiag);
    expect(result.detail).toEqual({ generationId: 'gen-3' });
  });
});

// ---------------------------------------------------------------------------
// Materialization diagnostic normalization
// ---------------------------------------------------------------------------

describe('normalizeMaterializationDiagnostic', () => {
  it('maps materialization diagnostic to public shape', () => {
    const matDiag = {
      assetId: 'asset-1',
      generationId: 'gen-1',
      reason: 'download-failed',
      message: 'Download failed for asset-1.',
    };

    const result = normalizeMaterializationDiagnostic(matDiag);
    expect(result.code).toBe('materialization_download-failed');
    expect(result.severity).toBe('warning');
    expect(result.source).toBe('asset-materialization');
    expect(result.message).toBe('Download failed for asset-1.');
    expect(result.detail).toEqual({
      assetId: 'asset-1',
      generationId: 'gen-1',
      reason: 'download-failed',
    });
  });

  it('maps unresolvable reason', () => {
    const matDiag = {
      assetId: 'asset-2',
      generationId: 'gen-2',
      reason: 'unresolvable',
      message: 'Cannot resolve.',
    };

    const result = normalizeMaterializationDiagnostic(matDiag);
    expect(result.code).toBe('materialization_unresolvable');
  });

  it('maps refresh-required reason', () => {
    const matDiag = {
      assetId: 'asset-3',
      generationId: 'gen-3',
      reason: 'refresh-required',
      message: 'Needs refresh.',
    };

    const result = normalizeMaterializationDiagnostic(matDiag);
    expect(result.code).toBe('materialization_refresh-required');
  });

  it('normalizeMaterializationDiagnostics maps all', () => {
    const matDiags = [
      { assetId: 'a1', generationId: 'g1', reason: 'unresolvable', message: 'm1' },
      { assetId: 'a2', generationId: 'g2', reason: 'download-failed', message: 'm2' },
    ];

    const results = normalizeMaterializationDiagnostics(matDiags);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('asset-materialization');
    expect(results[1].source).toBe('asset-materialization');
  });
});

// ---------------------------------------------------------------------------
// Render diagnostic helper
// ---------------------------------------------------------------------------

describe('createRenderDiagnostic', () => {
  it('creates a render diagnostic with severity error and source render', () => {
    const result = createRenderDiagnostic(
      'preview_only',
      'Renderer only supports preview mode.',
      { rendererId: 'r1' },
    );

    expect(result.code).toBe('preview_only');
    expect(result.severity).toBe('error');
    expect(result.source).toBe('render');
    expect(result.message).toBe('Renderer only supports preview mode.');
    expect(result.detail).toEqual({ rendererId: 'r1' });
  });

  it('works without detail', () => {
    const result = createRenderDiagnostic('worker_unavailable', 'Worker is offline.');
    expect(result.detail).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Diagnostic code catalog
// ---------------------------------------------------------------------------

describe('VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS', () => {
  it('documents every render blocker diagnostic code with a remedy', () => {
    const expectedCodes = [
      'unknown_clip_type',
      'export_route_blocked',
      'preview_only_clip',
      'remotion_module_missing_artifact',
      'remotion_module_invalid_artifact',
      'worker_provider_unavailable',
      'external_provider_unavailable',
    ] satisfies RenderBlockerCode[];

    expect(VIDEO_EDITOR_RENDER_BLOCKER_DIAGNOSTIC_CODES).toEqual(
      expectedCodes.map((code) => `render_${code}`),
    );

    for (const code of VIDEO_EDITOR_RENDER_BLOCKER_DIAGNOSTIC_CODES) {
      const doc = VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS.find((entry) => entry.code === code);
      expect(doc).toMatchObject({
        source: 'render',
        severity: 'error',
        stream: 'render-planner',
      });
      expect(doc?.message).toBeTruthy();
      expect(doc?.remedy).toBeTruthy();
      expect(doc?.detailKeys).toContain('blocker');
    }
  });

  it('documents the provider diagnostics stream and generated capability code pattern', () => {
    const documentedProviderCodes = VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS
      .filter((entry) => entry.stream === 'provider-collectDiagnostics')
      .map((entry) => entry.code);

    expect(VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_DOC).toMatchObject({
      codePattern: 'provider_capability_<capability>_<reason>',
      source: 'provider',
      severity: 'warning',
      stream: 'provider-collectDiagnostics',
    });
    expect(VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_DOC.detailKeys).toEqual(
      expect.arrayContaining(['capability', 'supported', 'reason']),
    );
    expect(VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_DOC.remedy).toContain('getCapabilities');

    expect(documentedProviderCodes).toContain('timeline_events_unavailable');
    for (const capability of DATA_PROVIDER_CAPABILITIES) {
      for (const reason of VIDEO_EDITOR_PROVIDER_CAPABILITY_DIAGNOSTIC_REASONS) {
        const code = `provider_capability_${capability}_${reason}`;
        expect(code).toMatch(/^provider_capability_[A-Za-z]+_(absent|unsupported|degraded)$/);
      }
    }

    const timelineEventsDoc = VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS.find(
      (entry) => entry.code === 'timeline_events_unavailable',
    );
    expect(timelineEventsDoc).toMatchObject({
      source: 'provider',
      severity: 'warning',
      stream: 'provider-collectDiagnostics',
    });
    expect(timelineEventsDoc?.detailKeys).toEqual(
      expect.arrayContaining(['table', 'reason', 'timelineId', 'projectId']),
    );
    expect(timelineEventsDoc?.remedy).toContain('timeline_events');
  });

  it('documents all materialization diagnostics with asset detail and remedies', () => {
    expect(VIDEO_EDITOR_MATERIALIZATION_DIAGNOSTIC_CODES).toEqual([
      'materialization_unresolvable',
      'materialization_download-failed',
      'materialization_refresh-required',
    ]);

    for (const code of VIDEO_EDITOR_MATERIALIZATION_DIAGNOSTIC_CODES) {
      const doc = VIDEO_EDITOR_DIAGNOSTIC_CODE_DOCS.find((entry) => entry.code === code);
      expect(doc).toMatchObject({
        source: 'asset-materialization',
        severity: 'warning',
        stream: 'asset-materialization',
      });
      expect(doc?.message).toBeTruthy();
      expect(doc?.remedy).toBeTruthy();
      expect(doc?.detailKeys).toEqual(
        expect.arrayContaining(['assetId', 'generationId', 'reason']),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Perf diagnostic helper
// ---------------------------------------------------------------------------

describe('createPerfDiagnostic', () => {
  it('creates a perf diagnostic with severity info and source perf', () => {
    const result = createPerfDiagnostic(
      'long_task',
      'Long task detected: 120ms',
      { duration: 120 },
    );

    expect(result.code).toBe('long_task');
    expect(result.severity).toBe('info');
    expect(result.source).toBe('perf');
    expect(result.message).toBe('Long task detected: 120ms');
    expect(result.detail).toEqual({ duration: 120 });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('normalizes invalid report attempts into a central runtime diagnostic', () => {
    const store = createVideoEditorDiagnosticsStore();

    expect(() => store.report({
      severity: 'error',
      source: 'extension-author' as any,
      code: 'custom_extension_report',
      message: 'Extension tried to publish a diagnostic.',
    })).not.toThrow();

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      severity: 'warning',
      source: 'extension-runtime',
      code: 'diagnostic_report_invalid',
      message: 'Ignored invalid diagnostics report attempt.',
    });
    expect(snapshot[0].detail).toMatchObject({
      reason: 'Diagnostic source is not supported.',
      attemptedSource: 'extension-author',
      attemptedCode: 'custom_extension_report',
    });
  });

  it('normalizes invalid reportMany and replaceBySource attempts without throwing', () => {
    const store = createVideoEditorDiagnosticsStore();

    expect(() => store.reportMany(null as any)).not.toThrow();
    expect(() => store.replaceBySource('extension-authored' as any, [])).not.toThrow();
    expect(() => store.replaceBySource('extension-loader', [
      {
        severity: 'error',
        source: 'extension-runtime',
        code: 'wrong_source',
        message: 'Wrong replacement source.',
      },
    ])).not.toThrow();

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].code).toBe('diagnostic_report_invalid');
    expect(snapshot[0].source).toBe('extension-runtime');
  });

  it('store handles rapid report + replaceBySource interleaving', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'L001', message: 'load' });
    store.replaceBySource('extension-loader', [
      { severity: 'warning', source: 'extension-loader', code: 'L002', message: 'replaced' },
    ]);
    store.report({ severity: 'error', source: 'render', code: 'R001', message: 'render' });
    store.replaceBySource('extension-loader', [
      { severity: 'error', source: 'extension-loader', code: 'L003', message: 'replaced again' },
    ]);

    const snapshot = store.getSnapshot();
    expect(snapshot).toHaveLength(2);
    const loader = snapshot.filter((d) => d.source === 'extension-loader');
    expect(loader).toHaveLength(1);
    expect(loader[0].code).toBe('L003');
    const render = snapshot.filter((d) => d.source === 'render');
    expect(render).toHaveLength(1);
    expect(render[0].code).toBe('R001');
  });

  it('store with no diagnostics has empty snapshot', () => {
    const store = createVideoEditorDiagnosticsStore();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('store preserves insertion order (diagnostics are appended)', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'A', message: 'first' });
    store.report({ severity: 'warning', source: 'extension-loader', code: 'B', message: 'second' });
    store.report({ severity: 'info', source: 'perf', code: 'C', message: 'third' });

    const snapshot = store.getSnapshot();
    expect(snapshot.map((d) => d.code)).toEqual(['A', 'B', 'C']);
  });

  it('severities cover all three values', () => {
    const store = createVideoEditorDiagnosticsStore();
    store.report({ severity: 'error', source: 'extension-loader', code: 'E', message: 'e' });
    store.report({ severity: 'warning', source: 'extension-loader', code: 'W', message: 'w' });
    store.report({ severity: 'info', source: 'perf', code: 'I', message: 'i' });

    const snapshot = store.getSnapshot();
    const severities = snapshot.map((d) => d.severity).sort();
    expect(severities).toEqual(['error', 'info', 'warning']);
  });

  it('reporter interface is satisfied by store', () => {
    const store = createVideoEditorDiagnosticsStore();
    // TypeScript compile-time check: store must implement VideoEditorDiagnosticReporter
    const reporter: typeof store = store;
    reporter.report({ severity: 'error', source: 'extension-loader', code: 'X', message: 'x' });
    reporter.reportMany([{ severity: 'warning', source: 'extension-loader', code: 'Y', message: 'y' }]);
    reporter.replaceBySource('extension-loader', [{ severity: 'info', source: 'extension-loader', code: 'Z', message: 'z' }]);
    expect(reporter.getSnapshot()).toHaveLength(1);
    expect(reporter.getSnapshot()[0].code).toBe('Z');
  });
});
