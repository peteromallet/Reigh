// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { defineExtension, type ContributionId, type ExtensionId } from '@reigh/editor-sdk';
import {
  getExtensionSmokeExtension,
  EXTENSION_SMOKE_ACTIVE_VALUE,
  EXTENSION_SMOKE_CONTRIBUTION_ID,
  EXTENSION_SMOKE_QUERY_PARAM,
} from '@/sdk/smoke/extensionSmoke';
import { getInternalExtensionRenderSurface } from '@/sdk/internalExtensionRenderSurface';
import { normalizeExtensionRuntime } from '@/tools/video-editor/runtime/extensionSurface';
import { createRendererRegistry } from '@/tools/video-editor/runtime/extensionRendererRegistry';
import type { ResolvedTimelineOverlayDescriptor } from '@reigh/editor-sdk';
import {
  createExtensionUiService,
  createInternalExtensionRenderSurface,
  resolveRegisteredRenderers,
} from '@/tools/video-editor/runtime/extensionRenderSurface';

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_EXTENSION_ID = 'com.example.render-surface';

function makeDiagnosticsService() {
  return {
    report: vi.fn(),
    diagnostics: [] as never[],
  };
}

function makeUiExtension() {
  return defineExtension({
    manifest: {
      id: TEST_EXTENSION_ID as ExtensionId,
      version: '1.0.0',
      label: 'Render Surface Test',
      apiVersion: 1,
      contributions: [
        {
          id: 'smoke-slot' as ContributionId,
          kind: 'slot',
          slot: 'statusBar',
          render: 'smoke-slot',
          order: 9999,
          label: 'Smoke',
        },
        {
          id: 'overlay-1' as ContributionId,
          kind: 'timelineOverlay',
          render: 'overlay-1',
          order: 2,
        },
      ],
    },
    activate() {
      return { dispose() {} };
    },
  });
}

function makeSurface(extension = makeUiExtension()) {
  const runtime = normalizeExtensionRuntime([extension]);
  const rendererRegistry = createRendererRegistry();
  const diagnosticsService = makeDiagnosticsService();
  const ui = createExtensionUiService({
    extension,
    diagnosticsService: diagnosticsService as never,
    rendererRegistry,
  });
  return { extension, runtime, rendererRegistry, diagnosticsService, ui };
}

const slotRenderer = () =>
  createElement('div', { 'data-testid': 'slot-renderer' }, 'slot content');
const overlayRenderer = () =>
  createElement('div', { 'data-testid': 'overlay-renderer' }, 'overlay content');

// ---------------------------------------------------------------------------
// createExtensionUiService — undeclared registrations
// ---------------------------------------------------------------------------

describe('createExtensionUiService — undeclared render ids', () => {
  it('emits render/unbound-render-id and returns a no-op handle for an undeclared render id', () => {
    const { ui, diagnosticsService, rendererRegistry } = makeSurface();

    const handle = ui.registerRenderer('undeclared-render-id', () => null);

    expect(diagnosticsService.report).toHaveBeenCalledTimes(1);
    const diag = diagnosticsService.report.mock.calls[0][0];
    expect(diag).toMatchObject({
      code: 'render/unbound-render-id',
      contributionId: 'undeclared-render-id',
      detail: { extensionId: TEST_EXTENSION_ID, renderId: 'undeclared-render-id' },
    });
    expect(rendererRegistry.getSnapshot().entries).toHaveLength(0);
    expect(() => handle.dispose()).not.toThrow();
  });

  it('accepts render ids declared by slot, dialog, panel, inspectorSection, and timelineOverlay contributions', () => {
    const extension = defineExtension({
      manifest: {
        id: 'com.example.render-kinds' as ExtensionId,
        version: '1.0.0',
        label: 'Render Kinds',
        apiVersion: 1,
        contributions: [
          { id: 'c-slot' as ContributionId, kind: 'slot', slot: 'statusBar', render: 'r-slot' },
          { id: 'c-dialog' as ContributionId, kind: 'dialog', layer: 'modal', render: 'r-dialog' },
          { id: 'c-panel' as ContributionId, kind: 'panel', placement: 'asset-panel', render: 'r-panel' },
          { id: 'c-inspector' as ContributionId, kind: 'inspectorSection', placement: 'after-default', render: 'r-inspector' },
          { id: 'c-overlay' as ContributionId, kind: 'timelineOverlay', render: 'r-overlay' },
        ],
      },
      activate() {
        return { dispose() {} };
      },
    });
    const { ui, rendererRegistry } = makeSurface(extension);

    const handles = [
      ui.registerRenderer('r-slot', () => null),
      ui.registerRenderer('r-dialog', () => null),
      ui.registerRenderer('r-panel', () => null),
      ui.registerRenderer('r-inspector', () => null),
      ui.registerRenderer('r-overlay', () => null),
    ];

    expect(rendererRegistry.getSnapshot().entries).toHaveLength(5);
    handles.forEach((handle) => handle.dispose());
    expect(rendererRegistry.getSnapshot().entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// resolveRegisteredRenderers — slots unchanged + overlays resolved
// ---------------------------------------------------------------------------

describe('resolveRegisteredRenderers', () => {
  it('projects a registered slot renderer into config.slots and removes it on dispose', () => {
    const extension = getExtensionSmokeExtension(
      new URLSearchParams({
        [EXTENSION_SMOKE_QUERY_PARAM]: EXTENSION_SMOKE_ACTIVE_VALUE,
      }),
    )!;
    const { runtime, rendererRegistry, ui } = makeSurface(extension);

    const handle = ui.registerRenderer(EXTENSION_SMOKE_CONTRIBUTION_ID, () =>
      createElement(
        'div',
        { 'data-testid': EXTENSION_SMOKE_CONTRIBUTION_ID },
        'Extension smoke active',
      ),
    );

    const withRenderer = resolveRegisteredRenderers(
      runtime,
      rendererRegistry.getSnapshot(),
    );
    expect(withRenderer).not.toBe(runtime.config);
    expect(typeof withRenderer.slots.statusBar).toBe('function');

    render(createElement('div', null, withRenderer.slots.statusBar!({} as never)));
    expect(screen.getByTestId(EXTENSION_SMOKE_CONTRIBUTION_ID)).toHaveTextContent(
      'Extension smoke active',
    );

    handle.dispose();

    const afterDispose = resolveRegisteredRenderers(
      runtime,
      rendererRegistry.getSnapshot(),
    );
    expect(afterDispose.slots.statusBar).toBeFalsy();
  });

  it('resolves registered overlays with owner identity and omits unregistered overlays', () => {
    const { runtime, rendererRegistry, ui } = makeSurface();

    // The projected runtime config carries the unresolved overlay descriptor.
    expect(runtime.config.overlays).toHaveLength(1);
    expect(runtime.config.overlays[0]).toMatchObject({
      extensionId: TEST_EXTENSION_ID,
      id: 'overlay-1',
      renderId: 'overlay-1',
      order: 2,
    });

    // Register ONLY the slot renderer: the overlay stays unregistered.
    ui.registerRenderer('smoke-slot', slotRenderer);
    let resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(typeof resolved.slots.statusBar).toBe('function');
    expect(resolved.overlays).toHaveLength(0);

    // Now register the overlay renderer: it resolves with owner identity.
    ui.registerRenderer('overlay-1', overlayRenderer);
    resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(resolved.overlays).toHaveLength(1);

    const [overlay] = resolved.overlays as readonly ResolvedTimelineOverlayDescriptor[];
    expect(overlay.extensionId).toBe(TEST_EXTENSION_ID);
    expect(overlay.id).toBe('overlay-1');
    expect(overlay.renderId).toBe('overlay-1');
    expect(overlay.order).toBe(2);
    expect(typeof overlay.render).toBe('function');

    render(createElement('div', null, overlay.render({} as never)));
    expect(screen.getByTestId('overlay-renderer')).toHaveTextContent('overlay content');

    // Disposing the overlay handle unregisters it: omitted again on resolve,
    // while the slot renderer stays.
    const overlayEntry = rendererRegistry
      .getSnapshot()
      .entries.find(
        (e) => e.extensionId === TEST_EXTENSION_ID && e.renderId === 'overlay-1',
      );
    expect(overlayEntry).toBeDefined();
    const overlayHandle = ui.registerRenderer('overlay-1', overlayRenderer);
    overlayHandle.dispose();

    const afterDispose = resolveRegisteredRenderers(
      runtime,
      rendererRegistry.getSnapshot(),
    );
    expect(afterDispose.overlays).toHaveLength(0);
    expect(typeof afterDispose.slots.statusBar).toBe('function');
  });

  it('omits overlays whose renderer was disposed and keeps the slot renderer', () => {
    const { runtime, rendererRegistry, ui } = makeSurface();

    const slotHandle = ui.registerRenderer('smoke-slot', slotRenderer);
    const overlayHandle = ui.registerRenderer('overlay-1', overlayRenderer);

    const resolvedBefore = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(resolvedBefore.overlays).toHaveLength(1);

    overlayHandle.dispose();
    slotHandle.dispose();

    const afterDispose = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(afterDispose.slots.statusBar).toBeFalsy();
    expect(afterDispose.overlays).toHaveLength(0);
  });

  it('preserves the original config identity when nothing is registered and no overlays exist', () => {
    const extension = getExtensionSmokeExtension(
      new URLSearchParams({
        [EXTENSION_SMOKE_QUERY_PARAM]: EXTENSION_SMOKE_ACTIVE_VALUE,
      }),
    )!;
    const { runtime, rendererRegistry } = makeSurface(extension);

    const resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(resolved).toBe(runtime.config);
  });

  it('replacement: disposing a stale handle leaves the replacement renderer in place', () => {
    const { runtime, rendererRegistry, ui } = makeSurface();

    const first = ui.registerRenderer('overlay-1', () => 'first');
    const second = ui.registerRenderer('overlay-1', () => 'second');

    // Old handle disposal must not remove the replacement.
    first.dispose();

    const resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    const [overlay] = resolved.overlays as readonly ResolvedTimelineOverlayDescriptor[];
    expect(overlay.render({} as never)).toBe('second');

    second.dispose();
  });

  it('disable (unregisterAll) omits everything and re-enable (re-register) resolves again', () => {
    const { runtime, rendererRegistry, ui } = makeSurface();

    ui.registerRenderer('smoke-slot', slotRenderer);
    ui.registerRenderer('overlay-1', overlayRenderer);

    // Disable: host safety net removes every renderer for the extension.
    rendererRegistry.unregisterAll(TEST_EXTENSION_ID);
    let resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(resolved.slots.statusBar).toBeFalsy();
    expect(resolved.overlays).toHaveLength(0);

    // Re-enable: the extension re-registers and resolution returns.
    ui.registerRenderer('smoke-slot', slotRenderer);
    ui.registerRenderer('overlay-1', overlayRenderer);
    resolved = resolveRegisteredRenderers(runtime, rendererRegistry.getSnapshot());
    expect(typeof resolved.slots.statusBar).toBe('function');
    expect(resolved.overlays).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Compatibility alias + accessor
// ---------------------------------------------------------------------------

describe('createInternalExtensionRenderSurface — compatibility', () => {
  it('is a compatibility alias for createExtensionUiService', () => {
    const extension = makeUiExtension();
    const rendererRegistry = createRendererRegistry();
    const diagnosticsService = makeDiagnosticsService();

    const alias = createInternalExtensionRenderSurface({
      extension,
      diagnosticsService: diagnosticsService as never,
      rendererRegistry,
    });

    const handle = alias.registerRenderer('smoke-slot', () => null);
    expect(rendererRegistry.getSnapshot().entries).toHaveLength(1);

    handle.dispose();
    expect(rendererRegistry.getSnapshot().entries).toHaveLength(0);
  });

  it('rejects undeclared render ids through the compatibility alias too', () => {
    const { diagnosticsService, rendererRegistry } = makeSurface();
    const extension = makeUiExtension();

    const alias = createInternalExtensionRenderSurface({
      extension,
      diagnosticsService: diagnosticsService as never,
      rendererRegistry,
    });

    alias.registerRenderer('not-declared', () => null);
    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'render/unbound-render-id' }),
    );
  });
});

describe('getInternalExtensionRenderSurface — ctx.ui delegation', () => {
  it('delegates to the same service exposed as ctx.ui', () => {
    const { ui } = makeSurface();
    const surface = getInternalExtensionRenderSurface({ ui } as never);
    expect(surface).toBe(ui);
    expect(typeof surface!.registerRenderer).toBe('function');
  });

  it('returns null when the context exposes no ui service', () => {
    expect(getInternalExtensionRenderSurface({} as never)).toBeNull();
  });
});
