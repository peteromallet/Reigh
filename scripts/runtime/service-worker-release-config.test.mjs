import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const repoRoot = resolve(import.meta.dirname, '..', '..');

async function loadFetchHandler() {
  const listeners = new Map();
  const source = await readFile(resolve(repoRoot, 'public/sw.js'), 'utf8');
  const context = vm.createContext({
    URL,
    Promise,
    Response,
    console,
    fetch: () => Promise.reject(new Error('network should remain browser-owned')),
    caches: {
      open: async () => ({ add: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => new Response('{"stale":true}', { status: 200 }),
    },
    self: {
      location: { origin: 'https://reigh.example' },
      clients: { claim: async () => {} },
      skipWaiting: () => {},
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
  });
  vm.runInContext(source, context, { filename: 'public/sw.js' });
  return listeners.get('fetch');
}

describe('service worker extension release boundary', () => {
  it('never intercepts or replays the runtime rollout document', async () => {
    const fetchHandler = await loadFetchHandler();
    let responsePromise;
    fetchHandler({
      request: {
        method: 'GET',
        url: 'https://reigh.example/runtime-config/v1/extensions.json?cache-bust=1',
      },
      respondWith: (response) => { responsePromise = response; },
    });
    assert.equal(responsePromise, undefined);
  });
});
