/**
 * Compatibility-only internal render-registration surface.
 *
 * @deprecated Extensions should register renderers through the public
 * `ctx.ui` service (`ExtensionUiService.registerRenderer`). This module is
 * retained so that host code and older bundled extensions can keep resolving
 * the render surface through the legacy symbol path.
 *
 * The context factory attaches the SAME service instance under both
 * `ctx.ui` and {@link INTERNAL_EXTENSION_RENDER_SURFACE}; the accessor below
 * therefore delegates to `ctx.ui` first and only falls back to the legacy
 * symbol for contexts constructed without a public UI service.
 */

import type { DisposeHandle } from './dispose';
import type { ExtensionContext } from './context';

export type InternalExtensionRenderer = (...args: unknown[]) => unknown;

export interface InternalExtensionRenderSurface {
  registerRenderer(
    renderId: string,
    renderer: InternalExtensionRenderer,
  ): DisposeHandle;
}

export const INTERNAL_EXTENSION_RENDER_SURFACE = Symbol(
  'reigh.internal.extension-render-surface',
);

export function attachInternalExtensionRenderSurface(
  target: object,
  surface: InternalExtensionRenderSurface,
): void {
  Object.defineProperty(target, INTERNAL_EXTENSION_RENDER_SURFACE, {
    value: surface,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/**
 * Resolve the internal render surface from an extension context.
 *
 * Compatibility accessor: delegates to the public `ctx.ui` service (which the
 * context factory populates with the same instance as the legacy symbol), and
 * falls back to the legacy symbol for contexts without `ctx.ui`.
 */
export function getInternalExtensionRenderSurface(
  ctx: ExtensionContext,
): InternalExtensionRenderSurface | null {
  // Primary path: the public ctx.ui service (same instance as the symbol).
  const ui = (ctx as unknown as { ui?: unknown }).ui;
  if (ui && typeof (ui as { registerRenderer?: unknown }).registerRenderer === 'function') {
    return ui as InternalExtensionRenderSurface;
  }

  // Legacy fallback for contexts constructed without ctx.ui.
  const value = (ctx as unknown as Record<PropertyKey, unknown>)[
    INTERNAL_EXTENSION_RENDER_SURFACE
  ];
  if (!value || typeof value !== 'object') {
    return null;
  }

  const registerRenderer = (value as { registerRenderer?: unknown }).registerRenderer;
  if (typeof registerRenderer !== 'function') {
    return null;
  }

  return value as InternalExtensionRenderSurface;
}
