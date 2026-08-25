import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Worker } from 'node:worker_threads';
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

  it('forwards SIGTERM as the first timeout signal and reports SIGKILL only after escalation', () => {
    const termResult = run(
      "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready'); setInterval(() => {}, 1_000)",
      { timeoutMs: 50, killSignal: 'SIGTERM', allowFailure: true },
    );
    assert.equal(termResult.failureType, 'timeout');
    assert.equal(termResult.killSignal, 'SIGTERM');
    assert.equal(termResult.signal, 'SIGTERM');

    const killResult = run(
      "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1_000)",
      { timeoutMs: 50, killSignal: 'SIGTERM', allowFailure: true },
    );
    assert.equal(killResult.failureType, 'timeout');
    assert.equal(killResult.killSignal, 'SIGTERM');
    assert.equal(killResult.signal, 'SIGKILL');
  });

  it('cleans a detached unref descendant after the scoped leader exits first', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bounded-command-exited-leader-'));
    const marker = resolve(root, 'exited-leader-marker');
    try {
      const source = [
        "const { spawn } = require('node:child_process');",
        `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(
          `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 700);`,
        )}], { detached: true, stdio: 'ignore' });`,
        'grandchild.unref();',
        'process.exit(0);',
      ].join('');
      const result = run(source, { timeoutMs: 1_000, allowFailure: true });
      assert.equal(result.failureType, 'success');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 850));
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rescans the scope when a descendant spawns during TERM', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bounded-command-term-spawn-'));
    const marker = resolve(root, 'term-spawn-marker');
    try {
      const source = [
        "const { spawn } = require('node:child_process');",
        `process.on('SIGTERM', () => { const child = spawn(process.execPath, ['-e', ${JSON.stringify(
          `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 700);`,
        )}], { detached: true, stdio: 'ignore' }); child.unref(); process.exit(0); });`,
        "process.stdout.write('ready'); setInterval(() => {}, 1_000);",
      ].join('');
      const result = run(source, { timeoutMs: 80, killSignal: 'SIGTERM', allowFailure: true });
      assert.equal(result.failureType, 'timeout');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 850));
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps twenty concurrent scoped cleanups isolated from an unrelated process', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bounded-command-parallel-scope-'));
    const unrelated = spawn(NODE, ['-e', 'setInterval(() => {}, 1_000)'], { detached: true, stdio: 'ignore' });
    unrelated.unref();
    const moduleUrl = new URL('./bounded-command.mjs', import.meta.url).href;
    const workerSource = `
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.moduleUrl).then(({ runBoundedCommand }) => {
        const result = runBoundedCommand(process.execPath, ['-e', workerData.source], workerData.options);
        parentPort.postMessage(result.failureType);
      }).catch((error) => parentPort.postMessage({ error: error.message }));
    `;
    try {
      const workers = Array.from({ length: 20 }, (_, index) => {
        const marker = resolve(root, `parallel-${index}.marker`);
        const source = [
          "const { spawn } = require('node:child_process');",
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(
            `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 600);`,
          )}], { detached: true, stdio: 'ignore' });`,
          'child.unref(); process.exit(0);',
        ].join('');
        return new Promise((resolvePromise, reject) => {
          const worker = new Worker(workerSource, {
            eval: true,
            workerData: { moduleUrl, source, options: { ...BASE, timeoutMs: 1_000, allowFailure: true } },
          });
          worker.once('message', (message) => { worker.terminate(); resolvePromise(message); });
          worker.once('error', reject);
        });
      });
      const results = await Promise.all(workers);
      assert.deepEqual(results, Array(20).fill('success'));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
      for (let index = 0; index < 20; index += 1) assert.equal(existsSync(resolve(root, `parallel-${index}.marker`)), false);
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    } finally {
      try { process.kill(unrelated.pid, 'SIGKILL'); } catch { /* already exited */ }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('kills a detached and unref grandchild before it can leave an orphan marker', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'bounded-command-grandchild-'));
    const marker = resolve(root, 'detached-grandchild-marker');
    try {
      const source = [
        "const { spawn } = require('node:child_process');",
        "const fs = require('node:fs');",
        `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(
          `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 900);`,
        )}], { detached: true, stdio: 'ignore' });`,
        'grandchild.unref();',
        'setInterval(() => {}, 1_000);',
      ].join('');
      const result = run(source, { timeoutMs: 75, allowFailure: true });
      assert.equal(result.failureType, 'timeout');
      await new Promise((resolve) => setTimeout(resolve, 1_050));
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
