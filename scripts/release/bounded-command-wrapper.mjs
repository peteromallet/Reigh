#!/usr/bin/env node

import { spawn } from 'node:child_process';

const GRACE_MS = 250;
const POLL_MS = 40;
const SCAN_TIMEOUT_MS = 300;
const SCAN_RETRIES = 3;
const SCAN_OUTPUT_CAP = 8 * 1024 * 1024;

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanScopeOnce(scopeKey, scopeToken) {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const probe = spawn('ps', ['eww', '-axo', 'pid=,command='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    const errors = [];
    let bytes = 0;
    let outputTooLarge = false;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      try { probe.kill('SIGKILL'); } catch { /* already exited */ }
      finish(new Error(`ps eww timed out after ${SCAN_TIMEOUT_MS}ms`));
    }, SCAN_TIMEOUT_MS);
    probe.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > SCAN_OUTPUT_CAP) outputTooLarge = true;
      if (bytes <= SCAN_OUTPUT_CAP) chunks.push(Buffer.from(chunk));
    });
    probe.stderr.on('data', (chunk) => {
      if (errors.reduce((total, item) => total + item.length, 0) < 4_096) errors.push(Buffer.from(chunk));
    });
    probe.once('error', (error) => finish(new Error(`ps eww failed: ${error.message}`)));
    probe.once('close', (code, signal) => {
      if (outputTooLarge) {
        finish(new Error(`ps eww output exceeded ${SCAN_OUTPUT_CAP} bytes`));
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim();
        finish(new Error(`ps eww exited with ${signal ?? `status ${code}`}${detail ? `: ${detail}` : ''}`));
        return;
      }
      const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(scopeKey)}=${escapeRegExp(scopeToken)}(?:\\s|$)`);
      const pids = [];
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        if (match && pattern.test(match[2])) pids.push(Number(match[1]));
      }
      finish(null, [...new Set(pids)]);
    });
  });
}

async function scanScope(scopeKey, scopeToken) {
  let lastError;
  for (let attempt = 1; attempt <= SCAN_RETRIES; attempt += 1) {
    try {
      return await scanScopeOnce(scopeKey, scopeToken);
    } catch (error) {
      lastError = error;
      if (attempt < SCAN_RETRIES) await delay(POLL_MS);
    }
  }
  throw new Error(`process-scope scan failed after ${SCAN_RETRIES} attempts: ${lastError?.message ?? 'unknown ps failure'}`);
}

function signalScopedPids(pids, signal, diagnostics) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') diagnostics.push(`pid ${pid}: ${error?.message ?? String(error)}`);
    }
  }
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
  const diagnostics = [];
  // Keep the detached process-group signal as a fast first step. The scoped
  // ps eww scan below is authoritative and also catches reparented children.
  if (child.pid) signalGroup(child.pid, killSignal);
  const scopeKey = child.scopeKey;
  const scopeToken = child.scopeToken;
  if (!scopeKey || !scopeToken) throw new Error('missing process-scope identity during cleanup');
  const termPids = await scanScope(scopeKey, scopeToken);
  signalScopedPids(termPids, killSignal, diagnostics);
  if (diagnostics.length > 0) throw new Error(`scoped TERM failed: ${diagnostics.join('; ')}`);
  state.signal = reason ? killSignal : null;
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((resolve) => setTimeout(resolve, GRACE_MS)),
  ]);

  // Descendants are allowed to spawn during TERM. Re-scan before every KILL,
  // and keep rescanning until the scope is empty so no late child is missed.
  for (let attempt = 1; attempt <= SCAN_RETRIES + 3; attempt += 1) {
    const remaining = await scanScope(scopeKey, scopeToken);
    if (remaining.length === 0) return reason;
    if (child.pid) signalGroup(child.pid, 'SIGKILL');
    signalScopedPids(remaining, 'SIGKILL', diagnostics);
    if (diagnostics.length > 0) throw new Error(`scoped KILL failed: ${diagnostics.join('; ')}`);
    state.signal = reason ? 'SIGKILL' : null;
    await delay(POLL_MS);
  }
  const remaining = await scanScope(scopeKey, scopeToken);
  if (remaining.length > 0) {
    throw new Error(`scoped processes survived cleanup: ${remaining.join(',')}`);
  }
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
    const targetEnv = {
      ...(invocation.env ?? process.env),
      [invocation.scopeKey]: invocation.scopeToken,
    };
    child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: targetEnv,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.scopeKey = invocation.scopeKey;
    child.scopeToken = invocation.scopeToken;
  } catch (error) {
    emit({
      status: null,
      signal: null,
      error: { name: error.name, code: error.code ?? null, message: error.message },
      stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
    });
    return;
  }

  let cleanupPromise;
  let cleanupError = null;
  const terminateFor = (why) => {
    if (reason) return;
    reason = why;
    cleanupPromise = terminate(child, why, invocation.killSignal, termination).catch((error) => {
      cleanupError = { name: error.name, code: 'ECLEANUP', message: error.message };
    });
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
  if (!cleanupPromise) {
    cleanupPromise = terminate(child, null, invocation.killSignal, termination).catch((error) => {
      cleanupError = { name: error.name, code: 'ECLEANUP', message: error.message };
    });
  }
  await cleanupPromise;
  if (reason === 'parent-abort') return;

  emit({
    status: child.spawnError ? null : child.exitCode,
    signal: child.signalCode ?? (reason ? termination.signal : null),
    error: child.spawnError
      ? { name: child.spawnError.name, code: child.spawnError.code ?? null, message: child.spawnError.message }
      : reason === 'timeout'
        ? { name: 'Error', code: 'ETIMEDOUT', message: `command timed out after ${invocation.timeoutMs}ms` }
        : null,
    cleanupError,
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
