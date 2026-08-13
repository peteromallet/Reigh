/**
 * overlay-example — timelineOverlay contribution example (required render).
 *
 * Demonstrates the required-render `timelineOverlay` contract end to end
 * using only the public @reigh/editor-sdk entrypoint:
 *
 *   1. The manifest contribution declares a NON-BLANK `render` id
 *      (OVERLAY_RENDER_ID) and no `when` clause — overlays are render-backed
 *      contributions, not placeholders.
 *   2. activate() binds a renderer for that exact id through the public
 *      `ctx.ui.registerRenderer()` service and composes the returned
 *      DisposeHandle into activation disposal.
 *
 * The renderer consumes the host-owned {@link TimelineOverlayRenderProps}
 * (memoized geometry, viewport/playhead stores, selection, pointer claim,
 * and the host-owned `primitives`). Examples stay framework-agnostic (no
 * React import), so the renderer returns a short host-renderable label;
 * real extensions return React elements and may embed
 * `props.primitives.markerLayer(...)` for ruler markers — see
 * `buildRulerMarkerLayerOptions()` below.
 *
 * @publicContract
 */

import {
  defineExtension,
  createTimelineOverlayGeometry,
  getVideoFamilyDefinition,
  getVideoFamilyLegacyBridgeStatus,
} from '@reigh/editor-sdk';
import type {
  ReighExtension,
  ExtensionContext,
  DisposeHandle,
  DiagnosticSeverity,
  ExtensionRenderer,
  ExtensionUiService,
  TimelineOverlayManifestContribution,
  TimelineOverlayDescriptor,
  ResolvedTimelineOverlayDescriptor,
  TimelineOverlayGeometryInput,
  TimelineOverlayGeometry,
  TimelineViewportStore,
  TimelineViewportSnapshot,
  TimelinePlayheadStore,
  TimelinePlayheadSnapshot,
  TimelineOverlaySelection,
  TimelineOverlayRenderProps,
  TimelineOverlayPrimitives,
  TimelinePointMarker,
  TimelineMarkerChange,
  TimelineMarkerLayerOptions,
} from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * The render id declared by the manifest contribution and bound via
 * `ctx.ui.registerRenderer()`. Non-blank by contract: the host resolves an
 * overlay only when this id has a registered renderer.
 */
export const OVERLAY_RENDER_ID = 'render/m2-overlay-viewport-labels';

// ---------------------------------------------------------------------------
// Pure contract demonstrations (framework-agnostic, testable)
// ---------------------------------------------------------------------------

/**
 * Bind an overlay renderer through the public `ctx.ui` service.
 *
 * The `renderId` must match the `render` field of the timelineOverlay
 * contribution declared in the manifest. The returned DisposeHandle
 * unregisters the renderer on disposal.
 */
export function registerOverlayRenderer(
  ui: ExtensionUiService,
  renderId: string,
  renderer: ExtensionRenderer<TimelineOverlayRenderProps>,
): DisposeHandle {
  return ui.registerRenderer(renderId, renderer);
}

/**
 * Derive the memoized overlay geometry from canonical host inputs.
 *
 * The host memoizes the input (via React `useMemo`) so the geometry object
 * keeps a stable identity between renders unless an input changed.
 */
export function buildOverlayGeometry(
  input: TimelineOverlayGeometryInput,
): TimelineOverlayGeometry {
  return createTimelineOverlayGeometry(input);
}

/** Read the latest viewport snapshot from the stable viewport store. */
export function summarizeViewport(
  viewport: TimelineViewportStore,
): TimelineViewportSnapshot {
  return viewport.getSnapshot();
}

/** Read the latest playhead snapshot from the stable playhead store. */
export function summarizePlayhead(
  playhead: TimelinePlayheadStore,
): TimelinePlayheadSnapshot {
  return playhead.getSnapshot();
}

/**
 * Build ruler-only marker-layer options for the example overlay.
 *
 * Real extensions pass the result to `props.primitives.markerLayer(...)`
 * from a React renderer. Keeping the construction here demonstrates the V1
 * ruler-only marker contracts (`TimelinePointMarker`,
 * `TimelineMarkerChange`, `TimelineMarkerLayerOptions`) without importing
 * React.
 */
export function buildRulerMarkerLayerOptions(
  markers: readonly TimelinePointMarker[],
): TimelineMarkerLayerOptions {
  return {
    markers,
    placement: 'ruler',
    interactive: true,
    snap: true,
    onChange: (change: TimelineMarkerChange): void => {
      // Example only: real extensions persist on 'commit' via
      // ctx.creative.timeline.apply(project-data.write ...).
      void change;
    },
  };
}

/** Format an unresolved overlay descriptor for diagnostics. */
export function formatOverlayDescriptor(
  descriptor: TimelineOverlayDescriptor,
): string {
  return `${descriptor.extensionId}:${descriptor.id}@${descriptor.renderId}`;
}

/**
 * Format a resolved overlay descriptor (descriptor + registered renderer)
 * for diagnostics. Resolved descriptors structurally include every
 * unresolved descriptor field.
 */
export function formatResolvedOverlay(
  descriptor: ResolvedTimelineOverlayDescriptor,
): string {
  return formatOverlayDescriptor(descriptor);
}

// ---------------------------------------------------------------------------
// Extension definition
// ---------------------------------------------------------------------------

const overlayContribution = {
  id: 'm2-overlay-viewport-labels' as any,
  kind: 'timelineOverlay',
  render: OVERLAY_RENDER_ID,
  label: 'M2 Viewport Labels Overlay',
  order: 100,
} satisfies TimelineOverlayManifestContribution;

export const overlayExample: ReighExtension = defineExtension({
  manifest: {
    id: 'com.reigh.examples.overlay-m2' as any,
    version: '1.0.0',
    label: 'Timeline Overlay M2 Example',
    description:
      'Demonstrates timelineOverlay contribution with required render id, ' +
      'bound via ctx.ui.registerRenderer().',
    apiVersion: 1,
    contributions: [overlayContribution],
    messages: {
      'activated': 'M2 Timeline Overlay example activated.',
      'disposed': 'M2 Timeline Overlay example disposed.',
      'overlay-family-status':
        'timelineOverlay is {{status}} with {{executionMaturity}} execution maturity; legacy milestone {{milestone}} is compatibility metadata.',
      'overlay-family-missing':
        'timelineOverlay is absent from the family registry; compatibility metadata is unavailable.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const overlayFamily = getVideoFamilyDefinition('timelineOverlay');
    const legacyBridgeStatus = getVideoFamilyLegacyBridgeStatus('timelineOverlay');
    const milestoneMsg = overlayFamily
      ? ctx.services.i18n.t('overlay-family-status', {
          status: legacyBridgeStatus === null ? 'active' : overlayFamily.executionMaturity,
          executionMaturity: overlayFamily.executionMaturity,
          milestone: overlayFamily.legacyMilestone ?? legacyBridgeStatus ?? 'unknown',
        })
      : ctx.services.i18n.t('overlay-family-missing');
    ctx.services.diagnostics.report({
      severity: 'info' as DiagnosticSeverity,
      code: overlayFamily ? 'overlay/family-status' : 'overlay/family-missing',
      message: milestoneMsg,
    });

    // Bind the renderer for the exact render id declared in the manifest.
    // The renderer returns a short, non-null, host-renderable label derived
    // from the host-owned props — no placeholder, no null render.
    const renderHandle = registerOverlayRenderer(
      ctx.ui,
      OVERLAY_RENDER_ID,
      (props: TimelineOverlayRenderProps): string => {
        const viewport: TimelineViewportSnapshot = summarizeViewport(props.viewport);
        const playhead: TimelinePlayheadSnapshot = summarizePlayhead(props.playhead);
        const selection: TimelineOverlaySelection = props.selection;
        const primitives: TimelineOverlayPrimitives = props.primitives;
        const markerLayerAvailable =
          typeof primitives.markerLayer === 'function';
        return [
          `M2 overlay (${OVERLAY_RENDER_ID})`,
          `geometry ${props.geometry.scale}s / ${props.geometry.scaleWidth}px`,
          `scrollLeft ${Math.round(viewport.scrollLeft)}`,
          `playhead ${playhead.time.toFixed(2)}s`,
          selection.hasSelection ? 'selection' : 'no-selection',
          markerLayerAvailable ? 'markerLayer' : 'no-primitives',
        ].join(' · ');
      },
    );

    ctx.chrome.toast(ctx.services.i18n.t('activated'), 'info');

    return {
      dispose(): void {
        renderHandle.dispose();
        ctx.chrome.toast(ctx.services.i18n.t('disposed'), 'info');
      },
    };
  },
});
