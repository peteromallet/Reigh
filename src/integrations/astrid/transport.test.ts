// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

import {
  AstridBridgeTransport,
  BridgeRouteError,
  BridgeTransportFailure,
} from './transport';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('Astrid bridge transport boundary', () => {
  it.each([
    [429, 'rate_limited'],
    [413, 'payload_too_large'],
  ])('preserves typed upstream %s errors without fallback', async (status, code) => {
    const server = createServer((_request, response) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        ...(status === 429 ? { 'Retry-After': '1' } : {}),
      });
      response.end(JSON.stringify({ error: code, detail: 'server boundary' }));
    });
    const baseUrl = await listen(server);
    try {
      const transport = new AstridBridgeTransport({ baseUrl });
      const error = await transport.requestJson(
        '/projects/demo-project/timelines/timeline',
        {},
        z.object({ ok: z.boolean() }),
        'load timeline',
      ).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(BridgeRouteError);
      expect(error).toMatchObject({ status, code });
      // `rate_limited` is an Astrid wire code, not one of Reigh's public
      // recovery categories; preserve it without relabeling as conflict.
      if (code === 'rate_limited') expect(error).toMatchObject({ category: 'unknown' });
    } finally {
      await close(server);
    }
  });

  it('aborts a slow bridge request and releases the client request', async () => {
    let requestClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => { requestClosed = resolve; });
    const timer = { value: undefined as ReturnType<typeof setTimeout> | undefined };
    const server = createServer((request, response) => {
      request.once('close', requestClosed);
      timer.value = setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      }, 1_000);
    });
    const baseUrl = await listen(server);
    try {
      const transport = new AstridBridgeTransport({ baseUrl, timeoutMs: 25 });
      await expect(transport.requestJson(
        '/health',
        {},
        z.object({ ok: z.boolean() }),
        'health',
      )).rejects.toBeInstanceOf(BridgeTransportFailure);
      await expect(closed).resolves.toBeUndefined();
    } finally {
      if (timer.value) clearTimeout(timer.value);
      await close(server);
    }
  });
});
