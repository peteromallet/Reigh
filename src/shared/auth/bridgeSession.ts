/**
 * The boot/auth seam — one probe, one authority.
 *
 * `AuthProvider` resolves the fixed local user by asking the Astrid local
 * bridge whether it is alive (`GET /health`, same-origin `/api/astrid` —
 * the development vite proxy). There is no login: a healthy bridge IS the
 * session. The resolved user id is a fixed local identity (doc 27 §4.7:
 * the per-boot request token is a request capability delivered out of band
 * to server-side callers; it never travels through browser code), so the
 * app-wide providers can key their data on it without any credential.
 *
 * Failure modes are honest and terminal for this boot:
 * - network failure / timeout / non-2xx / malformed body → `ok: false`
 *   with the reason. The caller renders a degraded-but-alive state;
 *   nothing retries or redirects.
 */

import { BRIDGE_REQUEST_TIMEOUT_MS } from '@/tools/video-editor/data/bridgeContract.ts';

/** Same-origin base of the development bridge proxy (see vite.config). */
export const BRIDGE_PROBE_BASE_URL = '/api/astrid';

/**
 * The fixed local identity every covered journey runs under once the
 * bridge answers. Stable across boots so stored references keep resolving.
 */
export const LOCAL_USER_ID = 'local-user';

export type BridgeSessionProbeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

/**
 * Probe `/api/astrid/health` and resolve the fixed local user from it.
 * Never throws — every failure comes back as `{ ok: false }`.
 */
export async function probeBridgeSession(
  baseUrl: string = BRIDGE_PROBE_BASE_URL,
): Promise<BridgeSessionProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }

  if (!response.ok) {
    return { ok: false, reason: `bridge health responded ${response.status}` };
  }

  try {
    const payload: unknown = await response.json();
    // Minimal shape check (`{ok: true}`) — the full contract schema lives in
    // bridgeContract.ts, but boot must not pull the editor's wire module graph.
    if (isHealthyStatus(payload)) {
      return { ok: true, userId: LOCAL_USER_ID };
    }
    return { ok: false, reason: 'bridge health payload is not a healthy status' };
  } catch (cause) {
    return {
      ok: false,
      reason: `bridge health body is not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
}

function isHealthyStatus(payload: unknown): boolean {
  return typeof payload === 'object'
    && payload !== null
    && 'ok' in payload
    && payload.ok === true;
}
