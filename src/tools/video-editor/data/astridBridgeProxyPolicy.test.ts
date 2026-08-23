// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preview, type PreviewServer } from 'vite';

import {
  astridBridgeUpstreamHeaders,
  createAstridBridgeAuthGuard,
  createAstridBridgeAuthPlugin,
  createAstridBridgeProxyOptions,
  resolveAstridBridgePort,
  resolveAstridBridgeProxyPolicy,
} from '../../../../config/vite/astridBridgeProxy';
import { ASTRID_BRIDGE_REQUEST_TIMEOUT_MS } from './astridBridgeWire';

function responseDouble(): ServerResponse {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

describe('Astrid bridge server-side auth boundary', () => {
  it('injects protocol and bearer headers from a server-only token', () => {
    const policy = resolveAstridBridgeProxyPolicy({
      ASTRID_BRIDGE_TOKEN: ' server-secret ',
      VITE_ASTRID_BRIDGE_TOKEN: 'browser-secret-must-be-ignored',
    });

    expect(astridBridgeUpstreamHeaders(policy)).toEqual({
      'X-Astrid-Bridge-Version': 'v1',
      Authorization: 'Bearer server-secret',
    });
  });

  it('fails closed without auth instead of proxying a real bridge request', () => {
    const guard = createAstridBridgeAuthGuard(resolveAstridBridgeProxyPolicy({}));
    const response = responseDouble();
    const next = vi.fn();

    guard({} as IncomingMessage, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(503);
    expect(response.setHeader).toHaveBeenCalledWith('X-Astrid-Bridge-Version', 'v1');
    expect(response.end).toHaveBeenCalledWith(expect.stringContaining(
      'astrid_bridge_auth_not_configured',
    ));
  });

  it('allows only an explicitly opted-in deterministic stub without auth', () => {
    const policy = resolveAstridBridgeProxyPolicy({
      ASTRID_BRIDGE_ALLOW_UNAUTHENTICATED_STUB: '1',
      VITE_ASTRID_BRIDGE_TOKEN: 'ignored',
    });
    const guard = createAstridBridgeAuthGuard(policy);
    const response = responseDouble();
    const next = vi.fn();

    guard({} as IncomingMessage, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(astridBridgeUpstreamHeaders(policy)).toEqual({
      'X-Astrid-Bridge-Version': 'v1',
    });
  });

  it.each([
    '17333@evil.example',
    '17333/path',
    '0',
    '65536',
    '-1',
    '17.333',
    ' 17333',
  ])('rejects an unsafe bridge port value %s', (value) => {
    expect(() => resolveAstridBridgePort(value)).toThrow('integer from 1 to 65535');
  });

  it('builds a loopback-only, deadline-bounded proxy target', () => {
    const policy = resolveAstridBridgeProxyPolicy({ ASTRID_BRIDGE_TOKEN: 'secret' });
    const options = createAstridBridgeProxyOptions(policy, resolveAstridBridgePort('17333'));

    expect(options).toMatchObject({
      target: 'http://127.0.0.1:17333',
      timeout: ASTRID_BRIDGE_REQUEST_TIMEOUT_MS,
      proxyTimeout: ASTRID_BRIDGE_REQUEST_TIMEOUT_MS,
    });
  });

  it.each(['configureServer', 'configurePreviewServer'] as const)(
    'registers the fail-closed guard in %s',
    (hookName) => {
      const plugin = createAstridBridgeAuthPlugin(resolveAstridBridgeProxyPolicy({}));
      const use = vi.fn();
      const hook = plugin[hookName];
      if (typeof hook !== 'function') throw new Error(`${hookName} is not callable`);

      hook({ middlewares: { use } } as never);

      expect(use).toHaveBeenCalledOnce();
      expect(use.mock.calls[0]?.[0]).toBe('/api/astrid');
      const guard = use.mock.calls[0]?.[1] as ReturnType<typeof createAstridBridgeAuthGuard>;
      const response = responseDouble();
      const next = vi.fn();
      guard({} as IncomingMessage, response, next);
      expect(next).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(503);
    },
  );

  it('fails closed in a spawned Vite preview before contacting upstream', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reigh-astrid-preview-'));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'index.html'), '<!doctype html><title>preview</title>');
    let upstreamRequests = 0;
    const upstream = createServer((_request, response) => {
      upstreamRequests += 1;
      response.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('upstream did not bind a TCP port');
    }

    const policy = resolveAstridBridgeProxyPolicy({});
    let server: PreviewServer | undefined;
    try {
      server = await preview({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [createAstridBridgeAuthPlugin(policy)],
        preview: {
          host: '127.0.0.1',
          port: 0,
          proxy: {
            '/api/astrid': createAstridBridgeProxyOptions(policy, upstreamAddress.port),
          },
        },
      });
      const address = server.httpServer.address();
      if (!address || typeof address === 'string') throw new Error('preview did not bind a TCP port');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/astrid/health`);
      expect(response.status).toBe(503);
      expect(response.headers.get('X-Astrid-Bridge-Version')).toBe('v1');
      expect(await response.json()).toMatchObject({ error: 'astrid_bridge_auth_not_configured' });
      expect(upstreamRequests).toBe(0);
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => server.httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        }));
      }
      await new Promise<void>((resolve, reject) => upstream.close((error) => {
        if (error) reject(error);
        else resolve();
      }));
      await rm(root, { recursive: true, force: true });
    }
  });
});
