/**
 * `AstridLocalClient` — the browser-side client for `astrid serve`'s frozen
 * doc-27 §4.1 task/gallery/media routes.
 *
 * It shares ONLY the wire contract (`bridgeContract.ts`) and the transport
 * pipeline (`transport.ts`) with `AstridBridgeDataProvider`: no base class,
 * no abstraction layer. Since B4 (C1-5) it also exposes the frozen timeline
 * CAS routes so document-native placement (doc 24 Q1) works on surfaces
 * outside the editor page; the provider keeps owning editor-session CAS
 * (cached-payload merges, local materialization). The composition point
 * stays `useVideoEditorProviderSelection` (VideoEditorPage).
 */

import { AstridBridgeTransport } from './transport.ts';
import { AstridLocalTaskRoutes } from './taskRoutes.ts';
import { AstridLocalGalleryRoutes } from './galleryRoutes.ts';
import { AstridLocalMediaRoutes } from './mediaRoutes.ts';
import { AstridLocalTimelineRoutes } from './timelineRoutes.ts';
import { AstridLocalProjectRoutes } from './projectRoutes.ts';

export type AstridLocalClientOptions = {
  projectSlug: string;
  /** Same-origin base; must travel the per-boot-token-injecting proxy. */
  baseUrl?: string;
};

export class AstridLocalClient {
  readonly projects: AstridLocalProjectRoutes;
  readonly tasks: AstridLocalTaskRoutes;
  readonly gallery: AstridLocalGalleryRoutes;
  readonly media: AstridLocalMediaRoutes;
  readonly timelines: AstridLocalTimelineRoutes;

  private readonly transport: AstridBridgeTransport;

  constructor(options: AstridLocalClientOptions) {
    this.transport = new AstridBridgeTransport({ baseUrl: options.baseUrl });
    this.projects = new AstridLocalProjectRoutes(this.transport);
    const scope = { projectSlug: options.projectSlug };
    this.tasks = new AstridLocalTaskRoutes(this.transport, scope);
    this.gallery = new AstridLocalGalleryRoutes(this.transport, scope);
    this.media = new AstridLocalMediaRoutes(this.transport, scope);
    this.timelines = new AstridLocalTimelineRoutes(this.transport, scope);
  }
}
