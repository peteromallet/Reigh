import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { PINNED_PYTHON_VERSION, resolvePinnedPythonExecutable } from './pinned-python-runtime.mjs';

function fakePython(root, version, identityExecutable = null) {
  const executable = resolve(root, 'python3.11');
  const identity = JSON.stringify({
    executable: identityExecutable ?? executable,
    implementation: 'CPython',
    version,
  });
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${identity}'\n`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  return executable;
}

describe('pinned Python runtime resolver', () => {
  it('selects the exact pinned candidate from PATH without a user-specific path', () => {
    const wrongRoot = mkdtempSync(resolve(tmpdir(), 'pinned-python-runtime-'));
    const rightRoot = mkdtempSync(resolve(tmpdir(), 'pinned-python-runtime-'));
    try {
      fakePython(wrongRoot, '3.14.3');
      const right = fakePython(rightRoot, PINNED_PYTHON_VERSION);
      assert.equal(
        resolvePinnedPythonExecutable({ pathValue: `${wrongRoot}:${rightRoot}` }),
        realpathSync(right),
      );
    } finally {
      rmSync(wrongRoot, { recursive: true, force: true });
      rmSync(rightRoot, { recursive: true, force: true });
    }
  });

  it('honors an explicit absolute executable and rejects a wrong version', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'pinned-python-runtime-'));
    try {
      const wrong = fakePython(root, '3.14.3');
      assert.throws(
        () => resolvePinnedPythonExecutable({ requested: wrong }),
        new RegExp(`must be Python ${PINNED_PYTHON_VERSION}`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a relative explicit override and reports when PATH has no match', () => {
    assert.throws(
      () => resolvePinnedPythonExecutable({ requested: 'python3.11' }),
      /ASTRID_PYTHON must be an absolute executable path/,
    );
    assert.throws(
      () => resolvePinnedPythonExecutable({ pathValue: '/path/with/no/python' }),
      /Pinned Astrid Python .* unavailable.*searched python3\.11, python3, and python on PATH/,
    );
  });

  it('rejects a candidate whose identity executable is not usable', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'pinned-python-runtime-'));
    try {
      const wrongIdentity = fakePython(root, PINNED_PYTHON_VERSION, '/tmp/other-python');
      assert.throws(
        () => resolvePinnedPythonExecutable({ requested: wrongIdentity }),
        new RegExp(`must be Python ${PINNED_PYTHON_VERSION}`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
