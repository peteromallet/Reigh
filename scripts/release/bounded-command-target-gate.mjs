#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createReadStream, readFileSync, writeSync } from 'node:fs';

const release = createReadStream(null, { fd: 4, autoClose: false });

function send(message) {
  writeSync(3, `${JSON.stringify(message)}\n`);
}

// The gate is the stable process-group leader. TERM-like signals are delivered
// to the complete group, but the gate remains alive until the supervising
// wrapper has drained detached descendants and explicitly releases it.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {});
}

let released = false;
let terminal = false;
let explicitRelease = false;
let supervisorLossStarted = false;
const maybeExit = () => {
  if (released && terminal) process.exit(0);
};

const abortForSupervisorLoss = () => {
  if (explicitRelease || supervisorLossStarted) return;
  supervisorLossStarted = true;
  // This process is the still-live group leader, so its PGID cannot have been
  // reused. TERM the complete non-detached tree, then KILL the same pinned
  // group. The independent broker drains any token-bearing detached escapees.
  try { process.kill(-process.pid, 'SIGTERM'); } catch { /* group already empty */ }
  setTimeout(() => {
    try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
  }, 250);
};

release.setEncoding('utf8');
release.on('data', (chunk) => {
  if (chunk.includes('release')) {
    explicitRelease = true;
    released = true;
    maybeExit();
  }
});
release.on('end', () => {
  if (explicitRelease) maybeExit();
  else abortForSupervisorLoss();
});
release.on('error', abortForSupervisorLoss);

send({ type: 'gate-ready', pid: process.pid });

try {
  const invocation = JSON.parse(readFileSync(0, 'utf8'));
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    shell: false,
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let spawnError = null;
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.once('error', (error) => {
    spawnError = { name: error.name, code: error.code ?? null, message: error.message };
  });
  if (invocation.input !== undefined) child.stdin.end(Buffer.from(invocation.input, 'base64'));
  else child.stdin.end();
  child.once('close', () => {
    terminal = true;
    send({
      type: 'target-terminal',
      status: spawnError ? null : child.exitCode,
      signal: child.signalCode,
      error: spawnError,
    });
    maybeExit();
  });
} catch (error) {
  terminal = true;
  send({
    type: 'target-terminal',
    status: null,
    signal: null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  });
  maybeExit();
}
