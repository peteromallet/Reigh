/**
 * Managed-media content addressing (`GET|HEAD /projects/:slug/media/:id/content`,
 * doc-27 §4.1). The route serves verified managed bytes with Range/ETag
 * semantics, so consumers build URLs for `<video>`/`<img>`/`<audio>` elements
 * instead of fetching JSON — this module only fixes the address form.
 */

import { bridgeMediaContentUrl } from '@/tools/video-editor/data/bridgeContract.ts';
import type { AstridBridgeTransport } from './transport.ts';

export class AstridLocalMediaRoutes {
  private readonly transport: AstridBridgeTransport;
  private readonly projectSlug: string;

  constructor(transport: AstridBridgeTransport, options: { projectSlug: string }) {
    this.transport = transport;
    this.projectSlug = options.projectSlug;
  }

  /**
   * Same-origin URL for one managed media object's bytes. Absolute URLs pass
   * through untouched is the CALLER'S job (see the B3 `bridgeMediaUrl`
   * helper); here every id becomes a content-route address.
   */
  contentUrl(mediaId: string): string {
    return bridgeMediaContentUrl(this.transport.baseUrl, this.projectSlug, mediaId);
  }
}
