import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME,
  resolveVideoEditorExtensionRuntime,
  resolveVideoEditorExtensionRuntimeWithDiagnostics,
  resolveVideoEditorPanelRegistry,
  type ResolveVideoEditorExtensionRuntimeResult,
  type VideoEditorExtensionConfig,
  type VideoEditorExtensionInput,
  type VideoEditorRenderContext,
} from '@/tools/video-editor/runtime/extensionSurface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slotRenderer(label: string) {
  return () => label;
}

function dialogDescriptor(id: string, order?: number): VideoEditorExtensionConfig['dialogHost'] {
  return { dialogs: [{ id, order, render: slotRenderer(id) }] };
}

function panelDescriptor(id: string, order?: number): VideoEditorExtensionConfig['registry'] {
  return { panels: [{ id, placement: 'asset-panel' as const, order, render: slotRenderer(id) }] };
}

function inspectorDescriptor(
  id: string,
  placement: 'before-default' | 'after-default' = 'before-default',
  order?: number,
): VideoEditorExtensionConfig['registry'] {
  return { inspectorSections: [{ id, placement, order, render: slotRenderer(id) }] };
}

function configWithEnabling(enabled: boolean): VideoEditorExtensionConfig {
  return { enabled, slots: { toolbar: slotRenderer('enabled-toolbar') } };
}

function configWithSlots(
  ...pairs: readonly [string, (() => string)][]
): VideoEditorExtensionConfig {
  const slots: Record<string, () => string> = {};
  for (const [name, fn] of pairs) {
    slots[name] = fn;
  }
  return { slots: slots as VideoEditorExtensionConfig['slots'] };
}

// Minimal render context for resolveVideoEditorPanelRegistry tests
function stubRenderContext(): VideoEditorRenderContext {
  return {
    provider: {} as VideoEditorRenderContext['provider'],
    timelineId: 'test-timeline',
    timelineName: 'Test Timeline',
    userId: 'u-1',
    extensions: DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME,
    data: {} as VideoEditorRenderContext['data'],
    ops: {} as VideoEditorRenderContext['ops'],
    chrome: {} as VideoEditorRenderContext['chrome'],
    playback: {} as VideoEditorRenderContext['playback'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveVideoEditorExtensionRuntime', () => {
  // ---- no input / empty input ----

  it('returns DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME identity for undefined input', () => {
    const result = resolveVideoEditorExtensionRuntime(undefined);
    expect(result).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
  });

  it('returns DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME identity for empty array', () => {
    const result = resolveVideoEditorExtensionRuntime([]);
    expect(result).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
  });

  // ---- disabled filtering ----

  it('returns DEFAULT identity when the only config has enabled: false', () => {
    const result = resolveVideoEditorExtensionRuntime({ enabled: false });
    expect(result).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
  });

  it('returns DEFAULT identity when every config has enabled: false', () => {
    const result = resolveVideoEditorExtensionRuntime([
      configWithEnabling(false),
      configWithEnabling(false),
    ]);
    expect(result).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
  });

  it('filters out disabled configs and merges only enabled ones', () => {
    const enabled = configWithSlots(['toolbar', slotRenderer('enabled')]);
    const disabled = { ...configWithSlots(['statusBar', slotRenderer('disabled')]), enabled: false as const };

    const result = resolveVideoEditorExtensionRuntime([enabled, disabled]);
    expect(result.slots.toolbar).toBeDefined();
    expect(result.slots.statusBar).toBeUndefined();
  });

  it('treats enabled: true and omitted enabled as equivalent', () => {
    const explicit = resolveVideoEditorExtensionRuntime({
      enabled: true,
      slots: { toolbar: slotRenderer('explicit') },
    });
    const implicit = resolveVideoEditorExtensionRuntime({
      slots: { toolbar: slotRenderer('implicit') },
    });
    expect(explicit.slots.toolbar).toBeDefined();
    expect(implicit.slots.toolbar).toBeDefined();
  });

  // ---- single config (non-array) ----

  it('normalizes a single config object to a one-element resolved runtime', () => {
    const result = resolveVideoEditorExtensionRuntime(
      configWithSlots(['toolbar', slotRenderer('single')]),
    );
    expect(result.slots.toolbar).toBeDefined();
    // Should not be DEFAULT identity because there is effective input
    expect(result).not.toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
    expect(result.dialogHost.dialogs).toEqual([]);
    expect(result.registry.panels).toEqual([]);
    expect(result.registry.inspectorSections).toEqual([]);
  });

  // ---- array order / contribution order ----

  it('merges slot contributions in array order with later-extension-wins semantics', () => {
    const first = configWithSlots(['toolbar', slotRenderer('first')]);
    const second = configWithSlots(['toolbar', slotRenderer('second')]);

    const result = resolveVideoEditorExtensionRuntime([first, second]);
    // Later wins
    expect(result.slots.toolbar?.({} as VideoEditorRenderContext)).toBe('second');
  });

  it('concatenates dialog descriptors in array order', () => {
    const a = { dialogHost: dialogDescriptor('a', 1) };
    const b = { dialogHost: dialogDescriptor('b', 2) };

    const result = resolveVideoEditorExtensionRuntime([a, b]);
    expect(result.dialogHost.dialogs).toHaveLength(2);
    expect(result.dialogHost.dialogs[0].id).toBe('a');
    expect(result.dialogHost.dialogs[1].id).toBe('b');
  });

  it('concatenates panel descriptors in array order', () => {
    const a = { registry: panelDescriptor('a', 1) };
    const b = { registry: panelDescriptor('b', 2) };

    const result = resolveVideoEditorExtensionRuntime([a, b]);
    expect(result.registry.panels).toHaveLength(2);
    expect(result.registry.panels[0].id).toBe('a');
    expect(result.registry.panels[1].id).toBe('b');
  });

  it('concatenates inspector section descriptors in array order', () => {
    const a = { registry: inspectorDescriptor('a', 'before-default', 1) };
    const b = { registry: inspectorDescriptor('b', 'after-default', 2) };

    const result = resolveVideoEditorExtensionRuntime([a, b]);
    expect(result.registry.inspectorSections).toHaveLength(2);
    expect(result.registry.inspectorSections[0].id).toBe('a');
    expect(result.registry.inspectorSections[1].id).toBe('b');
  });

  // ---- slot collisions (multiple slots) ----

  it('later-extension-wins applies per-slot, not wholesale', () => {
    const a = configWithSlots(['toolbar', slotRenderer('a-toolbar')], ['statusBar', slotRenderer('a-status')]);
    const b = configWithSlots(['toolbar', slotRenderer('b-toolbar')]);

    const result = resolveVideoEditorExtensionRuntime([a, b]);
    expect(result.slots.toolbar?.({} as VideoEditorRenderContext)).toBe('b-toolbar');
    // statusBar only defined in a — should survive
    expect(result.slots.statusBar?.({} as VideoEditorRenderContext)).toBe('a-status');
  });

  // ---- duplicate descriptor ID: no throw, diagnostics + fail-closed ----

  it('no longer throws on duplicate dialog descriptor IDs; first-wins, diagnostic emitted', () => {
    const a = { dialogHost: dialogDescriptor('dup', 1) };
    const b = { dialogHost: dialogDescriptor('dup', 2) };

    // Legacy wrapper must not throw
    const runtime = resolveVideoEditorExtensionRuntime([a, b]);
    expect(runtime.dialogHost.dialogs).toHaveLength(1);
    expect(runtime.dialogHost.dialogs[0].id).toBe('dup');

    // Diagnostics-aware resolver emits diagnostic
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    expect(result.runtime.dialogHost.dialogs).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('duplicate_descriptor_id');
    expect(result.diagnostics[0].source).toBe('extension-runtime');
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].detail).toEqual({ descriptorId: 'dup', collection: 'dialogs' });
  });

  it('no longer throws on duplicate panel descriptor IDs; first-wins, diagnostic emitted', () => {
    const a = { registry: panelDescriptor('dup') };
    const b = { registry: panelDescriptor('dup') };

    // Legacy wrapper must not throw
    expect(() => resolveVideoEditorExtensionRuntime([a, b])).not.toThrow();

    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    expect(result.runtime.registry.panels).toHaveLength(1);
    expect(result.runtime.registry.panels[0].id).toBe('dup');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].detail).toEqual({ descriptorId: 'dup', collection: 'panels' });
  });

  it('no longer throws on duplicate inspector section descriptor IDs; first-wins, diagnostic emitted', () => {
    const a = { registry: inspectorDescriptor('dup', 'before-default') };
    const b = { registry: inspectorDescriptor('dup', 'after-default') };

    // Legacy wrapper must not throw
    expect(() => resolveVideoEditorExtensionRuntime([a, b])).not.toThrow();

    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    expect(result.runtime.registry.inspectorSections).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].detail).toEqual({ descriptorId: 'dup', collection: 'inspectorSections' });
  });

  it('allows the same ID in different collections (dialog vs panel)', () => {
    const a = { dialogHost: dialogDescriptor('shared-id'), registry: panelDescriptor('shared-id') };

    // Should not throw or produce diagnostics — cross-collection duplicates are allowed
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a]);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.runtime.dialogHost.dialogs).toHaveLength(1);
    expect(result.runtime.registry.panels).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveVideoEditorExtensionRuntimeWithDiagnostics
// ---------------------------------------------------------------------------

describe('resolveVideoEditorExtensionRuntimeWithDiagnostics', () => {
  it('returns empty diagnostics for undefined input', () => {
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics(undefined);
    expect(result.runtime).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
    expect(result.diagnostics).toEqual([]);
  });

  it('returns empty diagnostics for empty array input', () => {
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([]);
    expect(result.runtime).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
    expect(result.diagnostics).toEqual([]);
  });

  it('returns empty diagnostics for valid configs without duplicates', () => {
    const a = { dialogHost: dialogDescriptor('a', 1) };
    const b = { dialogHost: dialogDescriptor('b', 2) };

    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    expect(result.diagnostics).toEqual([]);
    expect(result.runtime.dialogHost.dialogs).toHaveLength(2);
  });

  it('returns empty diagnostics when all configs are disabled', () => {
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([
      configWithEnabling(false),
      configWithEnabling(false),
    ]);
    expect(result.runtime).toBe(DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME);
    expect(result.diagnostics).toEqual([]);
  });

  it('collects multiple duplicate diagnostics across different collections', () => {
    const a: VideoEditorExtensionConfig = {
      dialogHost: dialogDescriptor('shared', 1),
      registry: panelDescriptor('shared'),
    };
    const b: VideoEditorExtensionConfig = {
      dialogHost: dialogDescriptor('shared', 2),
      registry: panelDescriptor('shared'),
    };

    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.detail?.collection).sort()).toEqual(['dialogs', 'panels']);

    // Fail-closed: only first occurrence of each survives
    expect(result.runtime.dialogHost.dialogs).toHaveLength(1);
    expect(result.runtime.registry.panels).toHaveLength(1);
  });

  it('legacy wrapper returns same runtime as diagnostics-aware resolver', () => {
    const extA: VideoEditorExtensionConfig = {
      slots: { toolbar: slotRenderer('a-toolbar') },
      dialogHost: dialogDescriptor('a-dialog', 10),
      registry: {
        panels: [{ id: 'a-panel', placement: 'asset-panel', order: 20, render: slotRenderer('a-panel') }],
      },
    };
    const extB: VideoEditorExtensionConfig = {
      slots: { toolbar: slotRenderer('b-toolbar') },
      registry: {
        panels: [{ id: 'b-panel', placement: 'asset-panel', order: 10, render: slotRenderer('b-panel') }],
      },
    };

    const legacy = resolveVideoEditorExtensionRuntime([extA, extB]);
    const withDiags = resolveVideoEditorExtensionRuntimeWithDiagnostics([extA, extB]);

    // Runtime configs must be structurally equivalent
    expect(legacy.slots.toolbar).toBe(withDiags.runtime.slots.toolbar);
    expect(legacy.dialogHost.dialogs).toEqual(withDiags.runtime.dialogHost.dialogs);
    expect(legacy.registry.panels).toEqual(withDiags.runtime.registry.panels);
    expect(withDiags.diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortRegistryDescriptors (tested indirectly through resolveVideoEditorPanelRegistry)
// ---------------------------------------------------------------------------

describe('resolveVideoEditorPanelRegistry', () => {
  // ---- empty registry ----

  it('returns EMPTY_RESOLVED_PANEL_REGISTRY for empty registry', () => {
    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(
      DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME.registry,
      context,
    );
    expect(result.assetPanels).toHaveLength(0);
    expect(result.inspectorSections.all).toHaveLength(0);
    expect(result.inspectorSections.beforeDefault).toHaveLength(0);
    expect(result.inspectorSections.afterDefault).toHaveLength(0);
  });

  // ---- explicit order sorting ----

  it('sorts panels by explicit order ascending', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      { registry: panelDescriptor('c', 30) },
      { registry: panelDescriptor('a', 10) },
      { registry: panelDescriptor('b', 20) },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.assetPanels.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts inspector sections by explicit order ascending', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      { registry: inspectorDescriptor('c', 'before-default', 30) },
      { registry: inspectorDescriptor('a', 'before-default', 10) },
      { registry: inspectorDescriptor('b', 'after-default', 20) },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.inspectorSections.all.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  // ---- equal-order insertion stability ----

  it('preserves insertion order for descriptors with equal order', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      { registry: panelDescriptor('first', 10) },
      { registry: panelDescriptor('second', 10) },
      { registry: panelDescriptor('third', 10) },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.assetPanels.map((p) => p.id)).toEqual(['first', 'second', 'third']);
  });

  it('preserves insertion order for equal-order inspectors', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      { registry: inspectorDescriptor('x', 'before-default', 0) },
      { registry: inspectorDescriptor('y', 'before-default', 0) },
      { registry: inspectorDescriptor('z', 'after-default', 0) },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.inspectorSections.all.map((s) => s.id)).toEqual(['x', 'y', 'z']);
  });

  // ---- default order (undefined) ----

  it('treats undefined order as 0', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      { registry: panelDescriptor('no-order') },
      { registry: panelDescriptor('zero-order', 0) },
      { registry: panelDescriptor('min-order', 0) },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    // All three have effective order 0 → insertion order preserved
    expect(result.assetPanels.map((p) => p.id)).toEqual(['no-order', 'zero-order', 'min-order']);
  });

  // ---- when predicate filtering ----

  it('filters out descriptors whose when predicate returns false', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      {
        registry: {
          panels: [
            { id: 'visible', placement: 'asset-panel' as const, order: 1, render: slotRenderer('v') },
            { id: 'hidden', placement: 'asset-panel' as const, order: 2, render: slotRenderer('h'), when: () => false },
          ],
        },
      },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.assetPanels).toHaveLength(1);
    expect(result.assetPanels[0].id).toBe('visible');
  });

  it('includes descriptors whose when predicate returns true', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      {
        registry: {
          panels: [
            { id: 'always', placement: 'asset-panel' as const, render: slotRenderer('a'), when: () => true },
          ],
        },
      },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.assetPanels).toHaveLength(1);
    expect(result.assetPanels[0].id).toBe('always');
  });

  it('returns EMPTY_RESOLVED_PANEL_REGISTRY when all descriptors are filtered out', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      {
        registry: {
          panels: [
            { id: 'hidden', placement: 'asset-panel' as const, render: slotRenderer('h'), when: () => false },
          ],
        },
      },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.assetPanels).toHaveLength(0);
    expect(result.inspectorSections.all).toHaveLength(0);
  });

  // ---- inspector placement buckets ----

  it('partitions inspector sections into beforeDefault and afterDefault', () => {
    const runtime = resolveVideoEditorExtensionRuntime([
      {
        registry: {
          inspectorSections: [
            { id: 'before-1', placement: 'before-default' as const, order: 1, render: slotRenderer('b1') },
            { id: 'after-1', placement: 'after-default' as const, order: 2, render: slotRenderer('a1') },
            { id: 'before-2', placement: 'before-default' as const, order: 3, render: slotRenderer('b2') },
          ],
        },
      },
    ]);

    const context = stubRenderContext();
    const result = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(result.inspectorSections.beforeDefault.map((s) => s.id)).toEqual(['before-1', 'before-2']);
    expect(result.inspectorSections.afterDefault.map((s) => s.id)).toEqual(['after-1']);
    expect(result.inspectorSections.all.map((s) => s.id)).toEqual(['before-1', 'after-1', 'before-2']);
  });
});

// ---------------------------------------------------------------------------
// Integration: end-to-end extension resolution covering all aspects
// ---------------------------------------------------------------------------

describe('extension resolution integration', () => {
  it('handles a realistic multi-extension configuration end-to-end', () => {
    const extA: VideoEditorExtensionConfig = {
      slots: { toolbar: slotRenderer('a-toolbar'), statusBar: slotRenderer('a-status') },
      dialogHost: dialogDescriptor('a-dialog', 10),
      registry: {
        panels: [{ id: 'a-panel', placement: 'asset-panel', order: 20, render: slotRenderer('a-panel') }],
        inspectorSections: [
          { id: 'a-inspector', placement: 'before-default', order: 15, render: slotRenderer('a-insp') },
        ],
      },
    };

    const extB: VideoEditorExtensionConfig = {
      slots: { toolbar: slotRenderer('b-toolbar') }, // collision: later-wins
      registry: {
        panels: [{ id: 'b-panel', placement: 'asset-panel', order: 10, render: slotRenderer('b-panel') }],
      },
    };

    const disabledExt: VideoEditorExtensionConfig = {
      enabled: false,
      slots: { header: slotRenderer('should-not-appear') },
      dialogHost: dialogDescriptor('disabled-dialog'),
    };

    const runtime = resolveVideoEditorExtensionRuntime([extA, extB, disabledExt]);

    // Slot collision: b-toolbar wins
    expect(runtime.slots.toolbar?.({} as VideoEditorRenderContext)).toBe('b-toolbar');
    // Non-colliding slot survives
    expect(runtime.slots.statusBar).toBeDefined();
    // Disabled extension slots should not appear
    expect(runtime.slots.header).toBeUndefined();

    // Dialogs: only a-dialog (disabled-dialog filtered out)
    expect(runtime.dialogHost.dialogs).toHaveLength(1);
    expect(runtime.dialogHost.dialogs[0].id).toBe('a-dialog');

    // Panels: b (order 10) before a (order 20)
    const context = stubRenderContext();
    const registry = resolveVideoEditorPanelRegistry(runtime.registry, context);
    expect(registry.assetPanels.map((p) => p.id)).toEqual(['b-panel', 'a-panel']);

    // Inspectors
    expect(registry.inspectorSections.beforeDefault.map((s) => s.id)).toEqual(['a-inspector']);
  });

  it('propagates duplicate ID diagnostics from across separate configs in the same collection', () => {
    const a: VideoEditorExtensionConfig = {
      dialogHost: dialogDescriptor('collision', 1),
      registry: {
        panels: [{ id: 'collision', placement: 'asset-panel', render: slotRenderer('p') }],
      },
    };
    const b: VideoEditorExtensionConfig = {
      dialogHost: dialogDescriptor('collision', 2), // duplicate dialog
    };

    // Legacy wrapper must not throw
    expect(() => resolveVideoEditorExtensionRuntime([a, b])).not.toThrow();

    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics([a, b]);
    // Dialog duplicate produces diagnostic; panel with same ID in different collection is OK
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].detail).toEqual({ descriptorId: 'collision', collection: 'dialogs' });
    // Both panels should be present (different collection, no duplicate)
    expect(result.runtime.registry.panels).toHaveLength(1);
    expect(result.runtime.dialogHost.dialogs).toHaveLength(1);
  });
});
