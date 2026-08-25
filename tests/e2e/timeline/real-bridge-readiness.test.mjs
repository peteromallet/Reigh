import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import {
  BRIDGE_PROTOCOL_HEADER,
  BRIDGE_PROTOCOL_VERSION,
  createBridgeReadinessAdapter,
} from './real-bridge-readiness.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('readiness adapter forwards the release auth contract and hides the token', async () => {
  const token = 'readiness-secret-that-must-not-escape';
  let observed;
  const bridge = http.createServer((request, response) => {
    observed = {
      authorization: request.headers.authorization,
      protocol: request.headers[BRIDGE_PROTOCOL_HEADER.toLowerCase()],
      url: request.url,
    };
    response.writeHead(
      observed.authorization === `Bearer ${token}`
        && observed.protocol === BRIDGE_PROTOCOL_VERSION
        && observed.url === '/health'
        ? 200
        : 401,
    );
    response.end();
  });
  const bridgePort = await listen(bridge);
  const readyProbe = http.createServer();
  const readyPort = await listen(readyProbe);
  await close(readyProbe);
  const adapter = createBridgeReadinessAdapter({
    bridgePort,
    readyPort,
    token,
  });
  try {
    await adapter.listen();
    const response = await fetch(`http://127.0.0.1:${readyPort}/ready`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.deepEqual(observed, {
      authorization: `Bearer ${token}`,
      protocol: BRIDGE_PROTOCOL_VERSION,
      url: '/health',
    });
    assert.equal(body, '{"ready":true}');
    assert.doesNotMatch(body, new RegExp(token));
    assert.equal(response.headers.get('authorization'), null);
  } finally {
    await adapter.close();
    await close(bridge);
  }
  await assert.rejects(fetch(`http://127.0.0.1:${readyPort}/ready`));
});

test('readiness adapter stays unavailable when authenticated bridge health fails', async () => {
  const bridge = http.createServer((_request, response) => {
    response.writeHead(503);
    response.end();
  });
  const bridgePort = await listen(bridge);
  const readyProbe = http.createServer();
  const readyPort = await listen(readyProbe);
  await close(readyProbe);
  const adapter = createBridgeReadinessAdapter({ bridgePort, readyPort, token: 'secret' });
  try {
    await adapter.listen();
    const response = await fetch(`http://127.0.0.1:${readyPort}/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ready: false });
  } finally {
    await adapter.close();
    await close(bridge);
  }
});
