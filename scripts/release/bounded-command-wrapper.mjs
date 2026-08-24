#!/usr/bin/env node

import { spawn } from 'node:child_process';

const GRACE_MS = 250;
const POLL_MS = 40;

function emit(value) {
  process.stdout.write(`${JSON.stringify({ protocol: 1, ...value })}\n`);
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function signalGroup(pid, signal) {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function listDescendantPids(rootPid) {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    const probe = spawn('ps', ['-axo', 'pid=,ppid='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    const timer = setTimeout(() => {
      probe.kill('SIGKILL');
      resolve([]);
    }, 100);
    probe.stdout.on('data', (chunk) => { output += chunk.toString(); });
    probe.once('close', () => {
      clearTimeout(timer);
      const parents = new Map();
      for (const line of output.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (!match) continue;
        const pid = Number(match[1]);
        const ppid = Number(match[2]);
        if (!parents.has(ppid)) parents.set(ppid, []);
        parents.get(ppid).push(pid);
      }
      const found = [];
      const queue = [...(parents.get(rootPid) ?? [])];
      while (queue.length > 0) {
        const pid = queue.shift();
        found.push(pid);
        queue.push(...(parents.get(pid) ?? []));
      }
      resolve(found);
    });
    probe.once('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}

function appendCapped(state, chunk, maxBuffer) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  state.bytes += bytes.length;
  if (state.data.length < maxBuffer) {
    state.data = Buffer.concat([state.data, bytes.subarray(0, maxBuffer - state.data.length)]);
  }
  return state.bytes > maxBuffer;
}

async function terminate(child, reason, killSignal, state) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const descendants = await listDescendantPids(child.pid);
  // The target is a detached group leader. The requested signal is sent first,
  // then KILL after the grace period, to the negative PID so grandchildren in
  // the owned group cannot outlive it.
  for (const pid of descendants.reverse()) signalGroup(pid, killSignal);
  signalGroup(child.pid, killSignal);
  state.signal = killSignal;
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((resolve) => setTimeout(resolve, GRACE_MS)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    state.signal = 'SIGKILL';
    signalGroup(child.pid, 'SIGKILL');
  }
  for (const pid of descendants.reverse()) signalGroup(pid, 'SIGKILL');
  return reason;
}

async function main() {
  const invocation = decode(process.argv[2] ?? '');
  const stdout = { data: Buffer.alloc(0), bytes: 0 };
  const stderr = { data: Buffer.alloc(0), bytes: 0 };
  let reason = null;
  let timer;
  let parentWatch;
  let child;
  const termination = { signal: null };

  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    emit({
      status: null,
      signal: null,
      error: { name: error.name, code: error.code ?? null, message: error.message },
      stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
    });
    return;
  }

  const terminateFor = (why) => {
    if (reason) return;
    reason = why;
    void terminate(child, why, invocation.killSignal, termination);
  };
  child.stdout.on('data', (chunk) => {
    if (appendCapped(stdout, chunk, invocation.maxBuffer)) terminateFor('output-cap');
  });
  child.stderr.on('data', (chunk) => {
    if (appendCapped(stderr, chunk, invocation.maxBuffer)) terminateFor('output-cap');
  });
  child.on('error', (error) => {
    child.spawnError = error;
  });
  if (invocation.input !== undefined && child.stdin) {
    child.stdin.end(Buffer.from(invocation.input, 'base64'));
  } else {
    child.stdin?.end();
  }

  timer = setTimeout(() => terminateFor('timeout'), invocation.timeoutMs);
  // A synchronous caller can be terminated while this detached wrapper is
  // still waiting. Detect reparenting and clean the owned group before exit.
  parentWatch = setInterval(() => {
    if (process.ppid !== invocation.parentPid) terminateFor('parent-abort');
  }, POLL_MS);

  await new Promise((resolve) => child.once('close', resolve));
  clearTimeout(timer);
  clearInterval(parentWatch);
  if (reason === 'parent-abort') return;

  emit({
    status: child.spawnError ? null : child.exitCode,
    signal: child.signalCode ?? (reason ? termination.signal : null),
    error: child.spawnError
      ? { name: child.spawnError.name, code: child.spawnError.code ?? null, message: child.spawnError.message }
      : reason === 'timeout'
        ? { name: 'Error', code: 'ETIMEDOUT', message: `command timed out after ${invocation.timeoutMs}ms` }
        : null,
    reason,
    stdout: stdout.data.toString('base64'),
    stderr: stderr.data.toString('base64'),
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
  });
}

main().catch((error) => {
  emit({
    status: null,
    signal: null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
    stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
  });
  process.exitCode = 1;
});
