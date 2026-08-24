import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = resolve(HERE, 'astrid-bridge-stub.mjs');

async function freePort() {
  const server = http.createServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

async function waitForHealth(origin) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The child may still be binding its listener.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`stub did not become healthy at ${origin}`);
}

test('deterministic Astrid stub serves the typed Runaway contract', async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [STUB], {
    env: { ...process.env, ASTRID_BRIDGE_PORT: String(port), BASE_URL: origin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForHealth(origin);
    const response = await fetch(`${origin}/v1/projects/cross-browser-release-gate/runaway-transitions?limit=1000`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Astrid-Bridge-Version'), 'v1');
    const body = await response.json();
    assert.equal(body.api_version, 'v1');
    assert.equal(body.project, 'cross-browser-release-gate');
    assert.equal(body.count, 566);
    assert.equal(body.total_count, 566);
    assert.equal(body.page.limit, 1000);
    assert.equal(body.page.next_cursor, null);
    assert.equal(body.transitions.length, 566);
    assert.equal(body.transitions[0].metadata.manifest_id, 'T0001');
    assert.equal(body.transitions.at(-1).metadata.manifest_id, 'T0566');

    const firstPage = await fetch(`${origin}/v1/projects/cross-browser-release-gate/runaway-transitions?limit=3`);
    assert.equal(firstPage.status, 200);
    const firstPageBody = await firstPage.json();
    assert.equal(firstPageBody.count, 3);
    assert.equal(firstPageBody.total_count, 566);
    assert.equal(firstPageBody.page.limit, 1000);
    assert.equal(firstPageBody.page.next_cursor, '3');
    assert.deepEqual(firstPageBody.transitions.map((transition) => transition.ordinal), [0, 1, 2]);

    const secondPage = await fetch(`${origin}/v1/projects/cross-browser-release-gate/runaway-transitions?limit=3&cursor=3`);
    assert.equal(secondPage.status, 200);
    const secondPageBody = await secondPage.json();
    assert.equal(secondPageBody.count, 3);
    assert.equal(secondPageBody.page.next_cursor, '6');
    assert.deepEqual(secondPageBody.transitions.map((transition) => transition.ordinal), [3, 4, 5]);

    const tasks = await fetch(`${origin}/projects/demo-project/tasks?limit=1`);
    assert.equal(tasks.status, 200);
    assert.deepEqual(await tasks.json(), { tasks: [], next_offset: null });
    const generations = await fetch(`${origin}/projects/demo-project/generations?limit=1`);
    assert.equal(generations.status, 200);
    assert.deepEqual(await generations.json(), { generations: [], next_cursor: null });
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
});
