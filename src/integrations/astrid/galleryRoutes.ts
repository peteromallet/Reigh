/**
 * Gallery routes of the frozen doc-27 §4.1 set: bounded generation pages and
 * generation detail with variants. Read-only — star/delete/set-primary ride
 * pack commands in later batches, never a second write surface here.
 */

import type { AstridBridgeTransport } from './transport.ts';
import {
  bridgeGenerationDetailPayloadSchema,
  bridgeGenerationListSchema,
  type BridgeGenerationDetailPayload,
  type BridgeGenerationList,
} from '@/tools/video-editor/data/bridgeContract.ts';

export type GalleryRoutesOptions = {
  /** The project slug every gallery route is scoped under. */
  projectSlug: string;
};

export class AstridLocalGalleryRoutes {
  private readonly transport: AstridBridgeTransport;
  private readonly projectSlug: string;

  constructor(transport: AstridBridgeTransport, options: GalleryRoutesOptions) {
    this.transport = transport;
    this.projectSlug = options.projectSlug;
  }

  private base(): string {
    return `/projects/${encodeURIComponent(this.projectSlug)}/generations`;
  }

  /**
   * One bounded gallery page (`limit`, opaque `cursor`, optional `starred`
   * filter). Ordered `created_at DESC, id ASC` by the bridge.
   */
  async list(options: { limit?: number; cursor?: string; starred?: boolean } = {}): Promise<BridgeGenerationList> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor !== undefined) params.set('cursor', options.cursor);
    if (options.starred !== undefined) params.set('starred', String(options.starred));
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return await this.transport.requestJson(this.base() + query, {}, bridgeGenerationListSchema, 'generation list');
  }

  /** Generation detail including its full variant rows. */
  async get(generationId: string): Promise<BridgeGenerationDetailPayload['generation']> {
    const payload = await this.transport.requestJson(
      `${this.base()}/${encodeURIComponent(generationId)}`,
      {},
      bridgeGenerationDetailPayloadSchema,
      'generation detail',
    );
    return payload.generation;
  }
}
