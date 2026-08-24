import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
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

test('canonicalizes equivalent base URL aliases and rejects conflicts', () => {
  withEnv({ BASE_URL: 'http://127.0.0.1:23111/', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:23111' }, () => {
    assert.deepEqual(readCanonicalBaseUrl(), { url: 'http://127.0.0.1:23111', port: 23111 });
    assert.equal(resolveCanonicalBaseUrl(23111), 'http://127.0.0.1:23111');
  });

  withEnv({ BASE_URL: 'http://127.0.0.1:23111', PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:23112' }, () => {
    assert.throws(() => readCanonicalBaseUrl(), /disagree/);
  });
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
