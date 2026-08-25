import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { PINNED_NODE_VERSION, resolvePinnedNodeExecutable } from './pinned-node-runtime.mjs';

function fakeNode(root, version) {
  const executable = resolve(root, 'node');
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  return executable;
}

describe('pinned Node runtime resolver', () => {
  it('selects an exact pinned candidate from PATH without a user-specific path', () => {
    const wrongRoot = mkdtempSync(resolve(tmpdir(), 'pinned-node-runtime-'));
    const rightRoot = mkdtempSync(resolve(tmpdir(), 'pinned-node-runtime-'));
    try {
      const wrong = fakeNode(wrongRoot, 'v24.4.1');
      const right = fakeNode(rightRoot, PINNED_NODE_VERSION);
      assert.equal(
        resolvePinnedNodeExecutable({ currentExecutable: wrong, pathValue: rightRoot }),
        realpathSync(right),
      );
    } finally {
      rmSync(wrongRoot, { recursive: true, force: true });
      rmSync(rightRoot, { recursive: true, force: true });
    }
  });

  it('rejects an explicit executable that does not report the pin', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'pinned-node-runtime-'));
    try {
      const wrong = fakeNode(root, 'v24.4.1');
      assert.throws(
        () => resolvePinnedNodeExecutable({ requested: wrong }),
        new RegExp(`must be Node ${PINNED_NODE_VERSION}`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
