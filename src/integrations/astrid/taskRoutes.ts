/**
 * Task routes of the frozen doc-27 §4.1 set: admission, polling reads, and
 * cancellation. Thin declarations over the shared transport — no retry
 * policy, no caching, no state. Consumers own cadence (plan §7: 2 s active /
 * 10 s idle) and idempotency-key discipline.
 */

import type { AstridBridgeTransport } from './transport.ts';
import { observeAstridCapabilityFailure } from './capabilityCensus.ts';
import {
  bridgeCancelRequestSchema,
  bridgeCancelResponseSchema,
  bridgeTaskAdmissionRequestSchema,
  bridgeTaskAdmissionResponseSchema,
  bridgeTaskDetailPayloadSchema,
  bridgeTaskListSchema,
  type BridgeCancelRequest,
  type BridgeCancelResponse,
  type BridgeTaskAdmissionRequest,
  type BridgeTaskAdmissionResponse,
  type BridgeTaskDetailPayload,
  type BridgeTaskList,
} from '@/tools/video-editor/data/bridgeContract.ts';

export type TaskRoutesOptions = {
  /** The project slug every task route is scoped under (`/projects/:slug/…`). */
  projectSlug: string;
};

export class AstridLocalTaskRoutes {
  private readonly transport: AstridBridgeTransport;
  private readonly projectSlug: string;

  constructor(transport: AstridBridgeTransport, options: TaskRoutesOptions) {
    this.transport = transport;
    this.projectSlug = options.projectSlug;
  }

  private path(suffix?: string): string {
    const base = `/projects/${encodeURIComponent(this.projectSlug)}/tasks`;
    return suffix ? `${base}/${suffix}` : base;
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      observeAstridCapabilityFailure('tasks', error);
      throw error;
    }
  }

  /**
   * R1 admission. `idempotencyKey` is REQUIRED by the bridge
   * (`Idempotency-Key` header); replaying the same key with the same body is
   * the server's dedup primitive, so callers derive keys deterministically.
   */
  async admit(
    request: BridgeTaskAdmissionRequest,
    idempotencyKey: string,
  ): Promise<BridgeTaskAdmissionResponse> {
    // Validate on the client too: an invalid admit must fail here, before a
    // receipted key is spent on a request the bridge would reject.
    bridgeTaskAdmissionRequestSchema.parse(request);
    return await this.request(() => this.transport.requestJson(
      this.path(),
      { method: 'POST', body: request, headers: { 'Idempotency-Key': idempotencyKey } },
      bridgeTaskAdmissionResponseSchema,
      'task admission',
    ));
  }

  /** Bounded task page for polling reads (`limit`, `offset`). */
  async list(options: { limit?: number; offset?: number } = {}): Promise<BridgeTaskList> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return await this.request(() => this.transport.requestJson(
      this.path() + query,
      {},
      bridgeTaskListSchema,
      'task list',
    ));
  }

  /** One task's full read model incl. attempts and committed outputs. */
  async get(taskId: string): Promise<BridgeTaskDetailPayload['task']> {
    const payload = await this.request(() => this.transport.requestJson(
      this.path(encodeURIComponent(taskId)),
      {},
      bridgeTaskDetailPayloadSchema,
      'task detail',
    ));
    return payload.task;
  }

  /**
   * Common queued/running cancellation. A running cancel requires the live
   * attempt fence; cancelling an already-terminal task replays its current
   * state without error.
   */
  async cancel(taskId: string, fence: BridgeCancelRequest = {}): Promise<BridgeCancelResponse> {
    bridgeCancelRequestSchema.parse(fence);
    return await this.request(() => this.transport.requestJson(
      `${this.path(encodeURIComponent(taskId))}/cancel`,
      { method: 'POST', body: fence },
      bridgeCancelResponseSchema,
      'task cancel',
    ));
  }
}
