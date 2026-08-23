/**
 * Shared bridge transport — the one fetch pipeline for every JSON exchange
 * with `astrid serve`.
 *
 * Consumed by BOTH `AstridBridgeDataProvider` (timeline load/save) and
 * `AstridLocalClient` (tasks/generations/media). It owns exactly three
 * concerns and nothing more:
 *
 * 1. **Timeout** — every request is bounded by `BRIDGE_REQUEST_TIMEOUT_MS`
 *    so a hung (not dead) bridge becomes an ordinary transport failure.
 * 2. **Envelope parsing** — non-2xx responses parse against the shared
 *    `bridgeErrorEnvelopeSchema` and surface as a {@link BridgeRouteError}
 *    carrying the raw wire code plus its doc-27 §4.6 category; success
 *    payloads validate through the caller's zod schema (never coerced).
 * 3. **Per-boot token posture (host ruling D1-OQ4)** — the per-boot request
 *    token (`X-Astrid-Request-Token`) is injected by the dev-server proxy /
 *    static middleware on the SERVER side. This module deliberately has no
 *    token code path: browser code never reads, stores, or sends the token,
 *    and requests stay same-origin relative paths so the proxy sees them.
 */

import {
  BRIDGE_REQUEST_TIMEOUT_MS,
  bridgeErrorEnvelopeSchema,
} from '@/tools/video-editor/data/bridgeContract.ts';
import {
  BridgeContractError,
  parseBridgePayload,
  type BridgeErrorCategory,
} from '@/tools/video-editor/data/bridgeContract.ts';
import type { z } from 'zod';

/**
 * A failed bridge route: HTTP status, the raw wire error code, and its
 * doc-27 §4.6 public category. Frozen timeline codes
 * (`timeline_version_conflict`, …) keep their exact code so existing
 * reload-and-retry ladders keep working; only the category is derived.
 */
export class BridgeRouteError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly category: BridgeErrorCategory | 'unknown';
  readonly detail: string | undefined;
  readonly envelope: z.infer<typeof bridgeErrorEnvelopeSchema> | null;

  constructor(
    action: string,
    status: number,
    envelope: z.infer<typeof bridgeErrorEnvelopeSchema> | null,
  ) {
    const description = envelope?.detail ?? `${status} ${reasonPhrase(status)}`;
    super(`Astrid bridge ${action} failed: ${description}`);
    this.name = 'BridgeRouteError';
    this.status = status;
    this.code = envelope?.error;
    this.detail = envelope?.detail;
    this.envelope = envelope;
    this.category = classifyRouteError(status, this.code);
  }
}

/** Network failure, timeout, or an unparseable body — never a route answer. */
export class BridgeTransportFailure extends Error {
  constructor(readonly cause: unknown) {
    super(
      cause instanceof Error && cause.name === 'TimeoutError'
        ? 'Astrid bridge request timed out'
        : `Astrid bridge is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'BridgeTransportFailure';
  }
}

function reasonPhrase(status: number): string {
  // Deliberately tiny: only statuses the frozen routes actually answer with.
  switch (status) {
    case 400: return 'Bad Request';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 409: return 'Conflict';
    case 413: return 'Payload Too Large';
    case 422: return 'Unprocessable Entity';
    default: return 'Error';
  }
}

/**
 * Map (status, wire code) → doc-27 §4.6 category. Exact codes win; otherwise
 * the HTTP status classifies. Anything unmapped stays `unknown` rather than
 * being silently relabeled into a wrong recovery path.
 */
export function classifyRouteError(status: number, code: string | undefined): BridgeErrorCategory | 'unknown' {
  if (
    code === 'invalid_body'
    || code === 'not_found'
    || code === 'conflict'
    || code === 'capability_unavailable'
    || code === 'payload_too_large'
  ) {
    return code;
  }
  if (status === 400 || status === 413) return 'invalid_body';
  if (status === 404) return 'not_found';
  if (status === 403 || status === 409) return 'conflict';
  if (status === 422) return 'capability_unavailable';
  return 'unknown';
}

export type AstridBridgeTransportOptions = {
  /** Same-origin base (default `/api/astrid`); must travel the injecting proxy. */
  baseUrl?: string;
  timeoutMs?: number;
};

export type BridgeRequestInit = {
  method?: 'GET' | 'POST' | 'HEAD';
  /** JSON body — serialized here so every caller gets identical encoding. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Extra abort signal combined with the transport deadline. */
  signal?: AbortSignal;
};

export class AstridBridgeTransport {
  readonly baseUrl: string;

  private readonly timeoutMs: number;

  constructor(options: AstridBridgeTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '/api/astrid').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;
  }

  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Fetch one JSON route, validate the response body against `schema`, and
   * hand back the caller's own value (validate-don't-rewrite — see
   * `parseBridgePayload`). Non-2xx → {@link BridgeRouteError}; network or
   * deadline failures → {@link BridgeTransportFailure}; malformed 2xx bodies
   * → {@link BridgeContractError}.
   */
  async requestJson<Schema extends z.ZodType>(
    path: string,
    request: BridgeRequestInit,
    schema: Schema,
    what: string,
  ): Promise<z.infer<Schema>> {
    const response = await this.requestRaw(path, request);
    if (!response.ok) {
      throw new BridgeRouteError(what, response.status, await parseErrorEnvelope(response));
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new BridgeContractError(
        what,
        `response body is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    return parseBridgePayload(schema, payload, what);
  }

  /**
   * Fetch one route without parsing a JSON body (byte routes such as media
   * content, or callers that only need the status).
   */
  async requestRaw(path: string, request: BridgeRequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = { ...request.headers };
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    try {
      return await fetch(this.url(path), {
        method: request.method ?? 'GET',
        headers,
        body,
        signal: composeSignals(this.timeoutMs, request.signal),
      });
    } catch (cause) {
      throw new BridgeTransportFailure(cause);
    }
  }
}

function composeSignals(timeoutMs: number, extra: AbortSignal | undefined): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return extra ? AbortSignal.any([deadline, extra]) : deadline;
}

async function parseErrorEnvelope(response: Response): Promise<z.infer<typeof bridgeErrorEnvelopeSchema> | null> {
  try {
    const parsed = bridgeErrorEnvelopeSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
