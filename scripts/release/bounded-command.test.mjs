import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  BoundedCommandError,
  runBoundedCommand,
} from './bounded-command.mjs';

const NODE = process.execPath;
const BASE = Object.freeze({ timeoutMs: 2_000, maxBuffer: 64 * 1024, killSignal: 'SIGKILL' });

function run(source, options = {}) {
  return runBoundedCommand(NODE, ['-e', source], { ...BASE, ...options });
}

describe('runBoundedCommand', () => {
  it('returns spawnSync-shaped success output and immutable invocation details', () => {
    const args = ['-e', "process.stdout.write('hello'); process.stderr.write('warn')"];
    const result = runBoundedCommand(NODE, args, { ...BASE, label: 'greeting' });
    args[1] = 'mutated after invocation';
    assert.equal(result.ok, true);
    assert.equal(result.failureType, 'success');
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'hello');
    assert.equal(result.stderr, 'warn');
    assert.equal(result.label, 'greeting');
    assert.deepEqual(result.args, ['-e', "process.stdout.write('hello'); process.stderr.write('warn')"]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.args));
  });

  it('throws structured diagnostics for a nonzero exit', () => {
    assert.throws(
      () => run("process.stdout.write('token=secret'); process.stderr.write('bad'); process.exit(7)", {
        label: 'nonzero-check',
        redact: ['secret'],
      }),
      (error) => {
        assert.ok(error instanceof BoundedCommandError);
        assert.equal(error.result.failureType, 'exit');
        assert.equal(error.result.status, 7);
        assert.match(error.result.stdout, /token=\[REDACTED\]/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  });

  it('distinguishes a child signal from a timeout, including SIGTERM/SIGKILL-like signals', () => {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const result = run(`process.kill(process.pid, '${signal}')`, { allowFailure: true });
      assert.equal(result.ok, false);
      assert.equal(result.failureType, 'signal');
      assert.equal(result.signal, signal);
      assert.equal(result.error, null);
    }
  });

  it('reports spawn errors separately from child failures', () => {
    const result = runBoundedCommand('/definitely/not/a/real/command', [], { ...BASE, allowFailure: true });
    assert.equal(result.ok, false);
    assert.equal(result.failureType, 'spawn-error');
    assert.equal(result.status, null);
    assert.match(result.error?.code ?? '', /ENOENT|EACCES/);
  });

  it('caps captured output and fails closed without retaining the full stream', () => {
    const result = run("process.stdout.write('x'.repeat(100_000))", {
      maxBuffer: 256,
      allowFailure: true,
    });
    assert.equal(result.failureType, 'output-cap');
    assert.equal(result.ok, false);
    assert.ok(Buffer.byteLength(result.stdout) <= 256);
    assert.equal(result.stdoutTruncated, true);
  });

  it('times out and kills the child without leaving a marker behind', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bounded-command-'));
    const marker = resolve(root, 'orphan-marker');
    try {
      const result = run(
        `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 1_000)`,
        { timeoutMs: 50, allowFailure: true },
      );
      assert.equal(result.ok, false);
      assert.equal(result.failureType, 'timeout');
      assert.equal(result.signal, 'SIGKILL');
      assert.equal(result.error?.code, 'ETIMEDOUT');
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires positive bounds and never permits a shell', () => {
    for (const [key, value] of [['timeoutMs', 0], ['maxBuffer', 0]]) {
      assert.throws(() => run('process.exit(0)', { [key]: value }), /positive/);
    }
    assert.throws(() => run('process.exit(0)', { shell: true }), /shell is forbidden/);
    assert.throws(() => run('process.exit(0)', { killSignal: '' }), /killSignal/);
  });
});
