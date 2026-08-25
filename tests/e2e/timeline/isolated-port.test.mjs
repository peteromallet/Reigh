import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allocateIsolatedPort,
  readCanonicalBaseUrl,
  resolveCanonicalBaseUrl,
} from './isolated-port.mjs';

function withEnv(values, callback) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const RESERVATION_DIR = join(tmpdir(), 'reigh-playwright-port-reservations');

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('canonicalizes equivalent base URL aliases and rejects conflicts', () => {
  withEnv({ BASE_URL: 'http://127.0.0.1:23111/', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:23111' }, () => {
    assert.deepEqual(readCanonicalBaseUrl(), { url: 'http://127.0.0.1:23111', port: 23111 });
    assert.equal(resolveCanonicalBaseUrl(23111), 'http://127.0.0.1:23111');
  });

  withEnv({ BASE_URL: 'http://127.0.0.1:23111', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:23112' }, () => {
    assert.throws(() => readCanonicalBaseUrl(), /disagree/);
  });
});

test('rejects non-loopback, stale-path, and alias base URLs', () => {
  const invalidUrls = [
    'https://example.invalid:23111/stale',
    'http://example.invalid:23111/',
    'http://localhost:23111/',
    'http://127.0.0.1:23111/stale',
    'http://127.0.0.1:23111/?stale=1',
    'http://user:pass@127.0.0.1:23111/',
  ];
  for (const invalidUrl of invalidUrls) {
    for (const alias of ['BASE_URL', 'PLAYWRIGHT_BASE_URL']) {
      withEnv({ BASE_URL: null, PLAYWRIGHT_BASE_URL: null, [alias]: invalidUrl }, () => {
        assert.throws(() => readCanonicalBaseUrl(), /exact http:\/\/127\.0\.0\.1:<port>/);
        assert.throws(() => resolveCanonicalBaseUrl(23111), /exact http:\/\/127\.0\.0\.1:<port>/);
      });
    }
  }
});

test('allocator refuses an occupied explicit port', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  try {
    withEnv({ HARNESS_OCCUPIED_PORT: String(address.port) }, () => {
      assert.throws(
        () => allocateIsolatedPort('HARNESS_OCCUPIED_PORT'),
        /refusing to reuse a stale editor\/bridge process/,
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('reclaims a stale lock and retries the same candidate after its child exits', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const childExit = once(child, 'exit');
  await childExit;
  assert.notEqual(child.pid, undefined);

  const port = await freePort();
  mkdirSync(RESERVATION_DIR, { recursive: true });
  const lockPath = join(RESERVATION_DIR, `${port}.lock`);
  const fd = openSync(lockPath, 'wx');
  try {
    writeFileSync(fd, JSON.stringify({ pid: child.pid, host: '127.0.0.1', port, createdAt: Date.now() }));
  } finally {
    closeSync(fd);
  }

  withEnv({ HARNESS_STALE_PORT: String(port) }, () => {
    assert.equal(allocateIsolatedPort('HARNESS_STALE_PORT'), port);
  });
});

test('allocates distinct editor, bridge, and real-bridge readiness ports', () => {
  withEnv({ ISOLATED_EDITOR_PORT: null, ISOLATED_BRIDGE_PORT: null, ISOLATED_READY_PORT: null }, () => {
    const used = new Set();
    const editor = allocateIsolatedPort('ISOLATED_EDITOR_PORT', used);
    const bridge = allocateIsolatedPort('ISOLATED_BRIDGE_PORT', used);
    const ready = allocateIsolatedPort('ISOLATED_READY_PORT', used);
    assert.equal(new Set([editor, bridge, ready]).size, 3);
  });
});
