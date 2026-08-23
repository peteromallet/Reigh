/**
 * `AstridLocalClient` — the browser-side client for `astrid serve`'s frozen
 * doc-27 §4.1 task/gallery/media routes.
 *
 * It shares ONLY the wire contract (`bridgeContract.ts`) and the transport
 * pipeline (`transport.ts`) with `AstridBridgeDataProvider`: no base class,
 * no abstraction layer. The provider keeps owning timeline load/save CAS;
 * this client owns everything that does not exist on the three-route
 * provider surface. The composition point stays
 * `useVideoEditorProviderSelection` (VideoEditorPage).
 */

import { AstridBridgeTransport } from './transport.ts';
import { AstridLocalTaskRoutes } from './taskRoutes.ts';
import { AstridLocalGalleryRoutes } from './galleryRoutes.ts';
import { AstridLocalMediaRoutes } from './mediaRoutes.ts';

export type AstridLocalClientOptions = {
  projectSlug: string;
  /** Same-origin base; must travel the per-boot-token-injecting proxy. */
  baseUrl?: string;
};

export class AstridLocalClient {
  readonly tasks: AstridLocalTaskRoutes;
  readonly gallery: AstridLocalGalleryRoutes;
  readonly media: AstridLocalMediaRoutes;

  private readonly transport: AstridBridgeTransport;

  constructor(options: AstridLocalClientOptions) {
    this.transport = new AstridBridgeTransport({ baseUrl: options.baseUrl });
    const scope = { projectSlug: options.projectSlug };
    this.tasks = new AstridLocalTaskRoutes(this.transport, scope);
    this.gallery = new AstridLocalGalleryRoutes(this.transport, scope);
    this.media = new AstridLocalMediaRoutes(this.transport, scope);
  }
}
