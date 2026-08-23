/**
 * Bridge session probe tests — the one auth seam.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_PROBE_BASE_URL,
  LOCAL_USER_ID,
  probeBridgeSession,
} from '../bridgeSession';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('probeBridgeSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hits /api/astrid/health with the transport deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await probeBridgeSession();

    expect(result).toEqual({ ok: true, userId: LOCAL_USER_ID });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BRIDGE_PROBE_BASE_URL}/health`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('resolves the fixed local user on a healthy payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, projects_root: '/somewhere' }),
    ));

    await expect(probeBridgeSession()).resolves.toEqual({
      ok: true,
      userId: LOCAL_USER_ID,
    });
  });

  it('fails honestly on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: 'boom' }, 500),
    ));

    const result = await probeBridgeSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('500');
    }
  });

  it('fails honestly on a malformed body (not a healthy status)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ status: 'degraded' }),
    ));

    const result = await probeBridgeSession();
    expect(result.ok).toBe(false);
  });

  it('fails honestly on network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

    const result = await probeBridgeSession();
    expect(result).toEqual({ ok: false, reason: 'network down' });
  });

  it('never throws when the body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<html>gateway</html>', { status: 200 }),
    ));

    const result = await probeBridgeSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not valid JSON');
    }
  });
});
