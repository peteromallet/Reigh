/**
 * Timeline routes of the frozen doc-27 §4.1 set: list, load, CAS save.
 *
 * B4 (C1-5): placement is document-native (doc 24 Q1 RATIFIED) — every
 * placement write rides exactly this save route with `expected_version`.
 * A stale version answers `409 timeline_version_conflict` and surfaces as
 * the canonical {@link TimelineVersionConflictError} so the existing
 * reload-and-retry ladders engage unchanged. This module adds no route the
 * bridge does not expose; it is the same wire path `AstridBridgeDataProvider`
 * drives, opened to non-editor surfaces (gallery/App drop, shots panel).
 */

import type { AstridBridgeTransport } from './transport.ts';
import { BridgeRouteError } from './transport.ts';
import {
  BRIDGE_VERSION_CONFLICT_CODE,
  bridgeTimelinePayloadSchema,
  bridgeTimelinesSchema,
  type BridgeTimelinePayload,
  type BridgeTimelinesPayload,
} from '@/tools/video-editor/data/bridgeContract.ts';
import { TimelineVersionConflictError } from '@/sdk/video/timeline/errors.ts';

export type TimelineRoutesOptions = {
  /** The project slug every timeline route is scoped under. */
  projectSlug: string;
};

export type TimelineSaveInput = {
  config: unknown;
  registry: unknown;
  expectedVersion: number;
};

export class AstridLocalTimelineRoutes {
  private readonly transport: AstridBridgeTransport;
  private readonly projectSlug: string;

  constructor(transport: AstridBridgeTransport, options: TimelineRoutesOptions) {
    this.transport = transport;
    this.projectSlug = options.projectSlug;
  }

  private base(): string {
    return `/projects/${encodeURIComponent(this.projectSlug)}/timelines`;
  }

  private toError(error: unknown, action: string, expectedVersion?: number): unknown {
    if (error instanceof BridgeRouteError
      && error.status === 409
      && error.code === BRIDGE_VERSION_CONFLICT_CODE) {
      return new TimelineVersionConflictError(
        error.detail ?? `Timeline version conflict (${action})`,
        expectedVersion,
        typeof error.envelope?.config_version === 'number' ? error.envelope.config_version : undefined,
      );
    }
    return error;
  }

  /** All timelines of the project (identity, slugs, default flag). */
  async list(): Promise<BridgeTimelinesPayload> {
    try {
      return await this.transport.requestJson(this.base(), {}, bridgeTimelinesSchema, 'timeline list');
    } catch (error) {
      throw this.toError(error, 'timeline list');
    }
  }

  /** One timeline document: config + registry + head version. */
  async get(ref: string): Promise<BridgeTimelinePayload> {
    try {
      return await this.transport.requestJson(
        `${this.base()}/${encodeURIComponent(ref)}`,
        {},
        bridgeTimelinePayloadSchema,
        'load timeline',
      );
    } catch (error) {
      throw this.toError(error, 'load timeline');
    }
  }

  /**
   * Compare-and-swap save. `expectedVersion` is the head this caller read;
   * a stale head yields {@link TimelineVersionConflictError}.
   */
  async save(ref: string, input: TimelineSaveInput): Promise<BridgeTimelinePayload> {
    try {
      return await this.transport.requestJson(
        `${this.base()}/${encodeURIComponent(ref)}/save`,
        {
          method: 'POST',
          body: {
            config: input.config,
            registry: input.registry,
            expected_version: input.expectedVersion,
          },
        },
        bridgeTimelinePayloadSchema,
        'save timeline',
      );
    } catch (error) {
      throw this.toError(error, 'save timeline', input.expectedVersion);
    }
  }
}
