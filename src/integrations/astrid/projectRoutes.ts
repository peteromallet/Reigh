/** Project discovery over the frozen `GET /projects` bridge route. */

import type { AstridBridgeTransport } from './transport.ts';
import { bridgeProjectsSchema } from '@/tools/video-editor/data/bridgeContract.ts';

export type BridgeProject = { slug: string; name: string } & Record<string, unknown>;

export class AstridLocalProjectRoutes {
  constructor(private readonly transport: AstridBridgeTransport) {}

  async list(): Promise<BridgeProject[]> {
    const payload = await this.transport.requestJson(
      '/projects',
      {},
      bridgeProjectsSchema,
      'project list',
    );
    return (payload.projects ?? []) as BridgeProject[];
  }
}
