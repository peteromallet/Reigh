/**
 * UI renderer contracts for the Reigh Editor SDK.
 *
 * Hosts the generic {@link ExtensionRenderer} type and the {@link ExtensionUiService}
 * exposed as `ctx.ui` during extension activation. Render-backed contributions
 * (e.g. `timelineOverlay`) declare a required `render` id in the manifest and
 * bind the matching renderer imperatively via `ui.registerRenderer()`.
 *
 * This module contains only data-only types and read-only surfaces; no
 * registry, provider, resolver, DOM, or React behaviour lives here.
 *
 * @publicContract
 */

import type { DisposeHandle } from './dispose';

/**
 * A renderer function registered by an extension and invoked by the host
 * with host-owned props.
 *
 * `Props` is the render-time props contract owned by the consuming family
 * (e.g. {@link TimelineOverlayRenderProps} for `timelineOverlay`). Renderers
 * are trusted local code; the return value is rendered by the host surface
 * (a React node for host React surfaces).
 */
export type ExtensionRenderer<Props> = (props: Props) => unknown;

/**
 * UI service available as `ctx.ui` during activate().
 *
 * Exposes only renderer registration. Extensions declare render-backed
 * contributions in their manifest (a required `render` id) and bind the
 * matching renderer imperatively via `registerRenderer()`. The returned
 * {@link DisposeHandle} unregisters the renderer on dispose.
 *
 * No other UI surface is exposed: chrome chrome/slot placement, dialogs,
 * and panels are governed by their own manifest contributions and services.
 */
export interface ExtensionUiService {
  /**
   * Register a renderer for a render-backed contribution.
   *
   * The `renderId` must match the `render` field of a contribution declared
   * by this extension in its manifest (e.g. a `timelineOverlay` contribution).
   *
   * Returns a DisposeHandle that unregisters the renderer when dispose() is
   * called (safe to call multiple times; idempotent).
   */
  registerRenderer<Props>(
    renderId: string,
    renderer: ExtensionRenderer<Props>,
  ): DisposeHandle;
}
