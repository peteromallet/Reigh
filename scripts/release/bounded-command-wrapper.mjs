#!/usr/bin/env node

import { spawn } from 'node:child_process';
import net from 'node:net';
import { closeSync, existsSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROCESS_SCOPE_MAX_DRAIN_ATTEMPTS,
  PROCESS_SCOPE_POLL_MS,
  PROCESS_SCOPE_SCAN_RETRIES,
  PROCESS_SCOPE_SCAN_TIMEOUT_MS,
  retryProcessScan,
} from './bounded-command-scan-policy.mjs';

const GRACE_MS = 250;
const POLL_MS = PROCESS_SCOPE_POLL_MS;
const SCAN_TIMEOUT_MS = PROCESS_SCOPE_SCAN_TIMEOUT_MS;
const SCAN_RETRIES = PROCESS_SCOPE_SCAN_RETRIES;
const SCAN_OUTPUT_CAP = 8 * 1024 * 1024;
const QUIESCENCE_SCANS = 3;
const BROKER_CONNECT_RETRIES = 240;
const BROKER_CONNECT_DELAY_MS = 25;
const TERM_SCAN_ATTEMPTS = 3;
const moduleDir = dirname(fileURLToPath(import.meta.url));
const TARGET_GATE_PATH = resolve(moduleDir, 'bounded-command-target-gate.mjs');
const PS_PATH = process.platform === 'darwin' ? '/bin/ps' : '/usr/bin/ps';

function emit(value) {
  process.stdout.write(`${JSON.stringify({ protocol: 1, ...value })}\n`);
}

async function readInvocation() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

function unrefDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sameIdentity(left, right) {
  return Boolean(left && right)
    && left.pgid === right.pgid
    && left.start === right.start;
}

function scanAllOnce() {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const probe = spawn(PS_PATH, ['eww', '-axo', 'pid=,pgid=,lstart=,command='], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (outputTooLarge) return finish(new Error(`ps eww output exceeded ${SCAN_OUTPUT_CAP} bytes`));
      if (code !== 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim();
        return finish(new Error(`ps eww exited with ${signal ?? `status ${code}`}${detail ? `: ${detail}` : ''}`));
      }
      const rows = [];
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/);
        if (match) rows.push({
          pid: Number(match[1]),
          pgid: Number(match[2]),
          start: match[3],
          command: match[4],
        });
      }
      finish(null, rows);
    });
  });
}

function scanAll() {
  return retryProcessScan(scanAllOnce, {
    attempts: SCAN_RETRIES,
    delayMs: POLL_MS,
    wait: delay,
  });
}

/**
 * Observe one scope for the complete lifetime of its wrapper. A single scan
 * at cleanup time has a race with a detached child that is still starting (or
 * with twenty wrappers all starting `ps` at once). Retaining every PID seen by
 * this broker gives cleanup a stable candidate set, while the live snapshot
 * and quiescence passes catch children that appear after the leader exits.
 */
class ScopeBroker {
  constructor(scopeKey, scopeToken, socketPath) {
    this.scopeKey = scopeKey;
    this.scopeToken = scopeToken;
    this.socketPath = socketPath;
    this.seen = new Map();
    this.current = new Map();
    this.failure = null;
    this.waiters = [];
    this.buffer = '';
    this.socket = null;
    this.ready = null;
    this.startReject = null;
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      this.startReject = reject;
      let attempts = 0;
      const connect = () => {
        if (this.failure) return;
        attempts += 1;
        const socket = net.createConnection(this.socketPath);
        this.socket = socket;
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => this.receive(chunk, resolve));
        socket.once('error', (error) => {
          if (this.socket !== socket) return;
          this.socket = null;
          socket.destroy();
          if (this.failure) return;
          if (attempts < BROKER_CONNECT_RETRIES) setTimeout(connect, BROKER_CONNECT_DELAY_MS);
          else this.fail(new Error(`scope broker connection failed: ${error.message}`), reject);
        });
        socket.once('close', () => {
          if (this.socket === socket) this.fail(new Error('scope broker disconnected'), reject);
        });
        socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'register', scopeKey: this.scopeKey, scopeToken: this.scopeToken })}\n`));
      };
      connect();
    });
    await this.ready;
  }

  receive(chunk, readyResolve) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'registered') {
        readyResolve();
      } else if (message.type === 'error') {
        this.fail(new Error(message.message));
      } else if (message.type === 'snapshot') {
        const entries = Array.isArray(message.entries) ? message.entries : [];
        this.current = new Map(entries.map((entry) => [entry.pid, entry.identity]));
        for (const [pid, identity] of this.current) this.seen.set(pid, identity);
        const waiter = this.waiters.shift();
        if (waiter) waiter.resolve([...this.current.keys()]);
      }
    }
  }

  fail(error, reject) {
    if (!this.failure) this.failure = error;
    if (reject) reject(error);
    while (this.waiters.length > 0) this.waiters.shift().reject(error);
  }

  abort(error) {
    this.fail(error, this.startReject);
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  async observe() {
    await this.start();
    if (this.failure) throw this.failure;
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      if (this.failure) {
        this.waiters.pop();
        reject(this.failure);
      }
    });
  }

  async waitForPid(pid, maxScans = SCAN_RETRIES + 5) {
    for (let attempt = 0; attempt < maxScans; attempt += 1) {
      await this.observe();
      if (this.current.has(pid)) return this.current.get(pid);
    }
    throw new Error(`scope broker did not observe launch gate pid ${pid}`);
  }

  async drain(initialSignal, diagnostics, excludePid) {
    let quiet = 0;
    let signaledLive = false;
    let escalated = false;
    const maxAttempts = PROCESS_SCOPE_MAX_DRAIN_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const live = await this.observe();
      // Retention prevents a short-lived scope member from being forgotten,
      // but only a same-snapshot identity match is eligible for a signal.
      // This closes the scan->kill PID-reuse window for stale retained PIDs.
      const candidates = [...this.seen]
        .filter(([pid, identity]) => sameIdentity(this.current.get(pid), identity))
        .filter(([pid]) => pid !== excludePid)
        .map(([pid]) => pid);
      const scopedLive = live.filter((pid) => pid !== excludePid);
      const signal = initialSignal === 'SIGKILL' || attempt > TERM_SCAN_ATTEMPTS ? 'SIGKILL' : initialSignal;
      if (candidates.length > 0) {
        signaledLive = true;
        if (signal === 'SIGKILL') escalated = true;
        signalScopedPids(candidates, signal, diagnostics);
      }
      if (scopedLive.length === 0) quiet += 1;
      else quiet = 0;
      if (quiet >= QUIESCENCE_SCANS) return { signaledLive, escalated };
      await delay(POLL_MS);
    }
    const remaining = await this.observe();
    const scopedRemaining = remaining.filter((pid) => pid !== excludePid);
    if (scopedRemaining.length > 0) {
      throw new Error(`scoped processes survived cleanup: ${scopedRemaining.join(',')}`);
    }
    return { signaledLive, escalated };
  }

  close() {
    if (this.socket) {
      try { this.socket.write('{"type":"unregister"}\n'); } catch { /* already closed */ }
      this.socket.end();
      this.socket = null;
    }
  }
}

async function runBroker(socketPath, candidateNonce, ownerPid, ownerStartSeconds, electionPath) {
  if (!/^[0-9a-f]{32}$/.test(candidateNonce ?? '')) return;
  if (electionPath !== `${socketPath}.election`) return;
  const lockPath = `${socketPath}.lock`;
  const readyPath = `${socketPath}.ready`;
  const legacyTakeoverPath = `${lockPath}.takeover`;
  const ownerRecord = JSON.stringify({ pid: process.pid, nonce: candidateNonce });
  const ownsLock = () => {
    try {
      const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
      return owner?.pid === process.pid && owner?.nonce === candidateNonce;
    } catch {
      return false;
    }
  };
  let lockOwned = false;
  {
    try {
      const lockFd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(lockFd, `${ownerRecord}\n`);
      closeSync(lockFd);
      lockOwned = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return;
      let owner;
      try {
        owner = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !/^[0-9a-f]{32}$/.test(owner.nonce ?? '')) {
          owner = null;
        } else {
          // A failed process scan is uncertainty, not proof that the lock is
          // stale. Never delete a lock/socket because ps was unavailable.
          const rows = await scanAll();
          const liveOwner = rows.find((row) => row.pid === owner.pid);
          const expectedArgv = `${process.argv[1]} --broker ${socketPath} ${owner.nonce}`;
          if (liveOwner?.command.includes(expectedArgv)) return;
        }
      } catch (scanError) {
        if (scanError?.message?.startsWith('Unexpected token') || scanError?.message === 'Unexpected end of JSON input') {
          owner = null;
        } else {
          return;
        }
      }
      try { unlinkSync(lockPath); } catch { return; }
      try { unlinkSync(readyPath); } catch { /* no stale readiness */ }
      try { unlinkSync(socketPath); } catch { /* no stale socket */ }
      const replacementFd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(replacementFd, `${ownerRecord}\n`);
      closeSync(replacementFd);
      lockOwned = true;
    }
  }
  if (!lockOwned) return;
  if (!ownsLock()) return;
  const cleanupOwnedArtifacts = () => {
    if (!ownsLock()) return;
    try { unlinkSync(socketPath); } catch { /* already gone */ }
    try { unlinkSync(lockPath); } catch { /* already gone */ }
    try { unlinkSync(readyPath); } catch { /* already gone */ }
    try { unlinkSync(legacyTakeoverPath); } catch { /* no legacy mutex */ }
    // The guardian still holds the unlinked inode until this broker exits.
    // The server is closed before normal cleanup, so a successor can safely
    // acquire a fresh election inode while lockf/flock reaps this process.
    try { unlinkSync(electionPath); } catch { /* guardian may remove it */ }
    try { rmdirSync(dirname(socketPath)); } catch { /* not empty or already gone */ }
  };
  const hasOwner = Number.isSafeInteger(ownerPid) && ownerPid > 0
    && Number.isSafeInteger(ownerStartSeconds) && ownerStartSeconds > 0;
  let ownerStart = null;
  if (hasOwner) {
    const rows = await scanAll().catch(() => null);
    const ownerRow = rows?.find((row) => row.pid === ownerPid
      && Math.abs(Math.floor(Date.parse(row.start) / 1_000) - ownerStartSeconds) <= 2);
    if (!ownerRow) {
      cleanupOwnedArtifacts();
      return;
    }
    ownerStart = ownerRow.start;
  }
  try { unlinkSync(socketPath); } catch { /* no stale socket */ }
  const clients = new Set();
  let idleTimer;
  const orphanClient = (client) => {
    if (client.released || client.orphaned) return;
    const socket = client.socket;
    if (!client.scopeKey || !client.scopeToken) {
      clients.delete(client);
      socket?.destroy();
      return;
    }
    client.orphaned = true;
    client.socket = null;
    client.quietScans = 0;
    socket?.destroy();
  };
  const server = net.createServer((socket) => {
    clearTimeout(idleTimer);
    idleTimer = null;
    const client = {
      socket, buffer: '', scopeKey: null, scopeToken: null,
      released: false, orphaned: false, quietScans: 0,
    };
    clients.add(client);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      client.buffer += chunk;
      let index;
      while ((index = client.buffer.indexOf('\n')) >= 0) {
        const line = client.buffer.slice(0, index);
        client.buffer = client.buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'register') {
          client.scopeKey = String(message.scopeKey ?? '');
          client.scopeToken = String(message.scopeToken ?? '');
          socket.write('{"type":"registered"}\n');
        } else if (message.type === 'unregister') {
          client.released = true;
          clients.delete(client);
          socket.end();
        }
      }
    });
    socket.on('close', () => orphanClient(client));
    socket.on('error', () => orphanClient(client));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); });
  }).catch(() => {
    cleanupOwnedArtifacts();
    return null;
  });
  if (!server.listening) return;
  writeFileSync(readyPath, `${JSON.stringify({ pid: process.pid, nonce: candidateNonce })}\n`, { mode: 0o600 });
  let scanning = false;
  let shuttingDown = false;
  let lastOwnerCheckAt = 0;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    clearTimeout(idleTimer);
    for (const client of clients) client.socket?.destroy();
    server.close(cleanupOwnedArtifacts);
  };
  const timer = setInterval(() => {
    const now = Date.now();
    const shouldCheckOwner = hasOwner
      && (clients.size > 0 || now - lastOwnerCheckAt >= 1_000);
    if (hasOwner && clients.size === 0 && !shouldCheckOwner) {
      return;
    }
    if (shouldCheckOwner) lastOwnerCheckAt = now;
    if (!hasOwner && clients.size === 0) {
      if (!idleTimer) idleTimer = setTimeout(shutdown, 10_000);
      return;
    }
    clearTimeout(idleTimer);
    idleTimer = null;
    if (scanning) return;
    scanning = true;
    scanAll().then((rows) => {
      const ownerAlive = !hasOwner || rows.some((row) => row.pid === ownerPid
        && row.start === ownerStart);
      if (!ownerAlive) {
        for (const client of clients) orphanClient(client);
      }
      for (const client of clients) {
        if (!client.scopeKey || !client.scopeToken) continue;
        const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(client.scopeKey)}=${escapeRegExp(client.scopeToken)}(?:\\s|$)`);
        // The command line is used only inside the broker to match the token;
        // clients receive the non-secret process identity needed to revalidate
        // a PID immediately before signaling.
        const entries = rows.filter((row) => pattern.test(row.command)).map((row) => ({
          pid: row.pid,
          identity: { pgid: row.pgid, start: row.start },
        }));
        if (client.orphaned) {
          const orphanPids = entries.map((entry) => entry.pid);
          signalScopedPids(orphanPids, 'SIGKILL', []);
          if (orphanPids.length === 0) client.quietScans += 1;
          else client.quietScans = 0;
          if (client.quietScans >= QUIESCENCE_SCANS) clients.delete(client);
        } else {
          try { client.socket?.write(`${JSON.stringify({ type: 'snapshot', entries })}\n`); } catch { /* closed client */ }
        }
      }
      if (!ownerAlive && clients.size === 0) shutdown();
    }).catch((error) => {
      for (const client of clients) {
        if (!client.orphaned) {
          try { client.socket?.write(`${JSON.stringify({ type: 'error', message: error.message })}\n`); } catch { /* closed client */ }
        }
      }
    }).finally(() => { scanning = false; });
  }, POLL_MS);
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

async function fallbackDrainScope(scopeKey, scopeToken, initialSignal, excludePid, diagnostics) {
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(scopeKey)}=${escapeRegExp(scopeToken)}(?:\\s|$)`);
  let quiet = 0;
  let escalated = false;
  const maxAttempts = PROCESS_SCOPE_MAX_DRAIN_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rows = await scanAll();
    const pids = rows
      .filter((row) => row.pid !== excludePid && pattern.test(row.command))
      .map((row) => row.pid);
    const signal = initialSignal === 'SIGKILL' || attempt > TERM_SCAN_ATTEMPTS ? 'SIGKILL' : initialSignal;
    if (pids.length > 0) {
      if (signal === 'SIGKILL') escalated = true;
      signalScopedPids(pids, signal, diagnostics);
      quiet = 0;
    } else {
      quiet += 1;
    }
    if (quiet >= QUIESCENCE_SCANS) return { escalated };
    await delay(POLL_MS);
  }
  throw new Error('local process-scope fallback did not reach quiescence');
}

function appendCapped(state, chunk, maxBuffer) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  state.bytes += bytes.length;
  if (state.data.length < maxBuffer) {
    state.data = Buffer.concat([state.data, bytes.subarray(0, maxBuffer - state.data.length)]);
  }
  return state.bytes > maxBuffer;
}

async function terminate(gate, reason, killSignal, state) {
  const diagnostics = [];
  if (!gate.broker) throw new Error('missing process-scope broker during cleanup');
  // Only signal a process group while the inert gate is observed and alive;
  // the gate pins that PGID until the broker has drained detached descendants.
  if (reason && gate.pid && gate.exitCode === null && gate.signalCode === null) {
    if (!gate.scopeAttached) throw new Error('launch gate was not attached to the process-scope broker');
    signalGroup(gate.pid, killSignal);
    state.signal = killSignal;
  }
  let drained;
  let brokerFailure = null;
  try {
    drained = await gate.broker.drain(killSignal, diagnostics, gate.pid);
  } catch (error) {
    brokerFailure = error;
    drained = await fallbackDrainScope(
      gate.broker.scopeKey,
      gate.broker.scopeToken,
      killSignal,
      gate.pid,
      diagnostics,
    );
  }
  if (diagnostics.length > 0) throw new Error(`scoped cleanup failed: ${diagnostics.join('; ')}`);
  if (reason && drained.escalated) state.signal = 'SIGKILL';
  if (brokerFailure) {
    throw new Error(`scope broker failed; local fallback cleanup completed: ${brokerFailure.message}`);
  }
  return reason;
}

async function main() {
  if (process.argv[2] === '--broker') {
    await runBroker(
      process.argv[3],
      process.argv[4],
      Number(process.argv[5]),
      Number(process.argv[6]),
      process.argv[7],
    );
    return;
  }
  let invocation;
  try {
    invocation = await readInvocation();
  } catch (error) {
    emit({ status: null, signal: null, error: { name: error.name, code: error.code ?? null, message: error.message }, stdout: '', stderr: '' });
    process.exitCode = 1;
    return;
  }
  const stdout = { data: Buffer.alloc(0), bytes: 0 };
  const stderr = { data: Buffer.alloc(0), bytes: 0 };
  let reason = null;
  let timer;
  let parentWatch;
  let parentAbortRequested = false;
  let terminateFor = null;
  let gate;
  let targetResult = { status: null, signal: null, error: null };
  const termination = { signal: null };
  const broker = new ScopeBroker(invocation.scopeKey, invocation.scopeToken, invocation.brokerSocket);
  // Start watching before broker startup or gate creation. A synchronous
  // caller can die while either operation is still retrying; in that case no
  // target/gate exists yet, so the wrapper must simply close its broker link
  // and exit instead of waiting for the command timeout.
  parentWatch = setInterval(() => {
    if (process.ppid !== invocation.parentPid) {
      parentAbortRequested = true;
      if (terminateFor && gate?.scopeAttached) terminateFor('parent-abort');
      else if (gate?.pid) signalGroup(gate.pid, invocation.killSignal);
      else broker.abort(new Error('synchronous parent exited during broker startup'));
    }
  }, POLL_MS);
  try {
    await broker.start();
    await broker.observe();
  } catch (error) {
    clearInterval(parentWatch);
    if (parentAbortRequested || process.ppid !== invocation.parentPid) {
      broker.close();
      return;
    }
    emit({ status: null, signal: null, error: { name: error.name, code: 'EBROKER', message: error.message }, stdout: '', stderr: '' });
    broker.close();
    return;
  }
  if (parentAbortRequested || process.ppid !== invocation.parentPid) {
    clearInterval(parentWatch);
    broker.close();
    return;
  }

  let resolveGateReady;
  let rejectGateReady;
  const gateReady = new Promise((resolvePromise, rejectPromise) => {
    resolveGateReady = resolvePromise;
    rejectGateReady = rejectPromise;
  });
  let resolveTargetTerminal;
  const targetTerminal = new Promise((resolvePromise) => { resolveTargetTerminal = resolvePromise; });

  try {
    const gateEnv = {
      PATH: dirname(process.execPath),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      [invocation.scopeKey]: invocation.scopeToken,
    };
    gate = spawn(process.execPath, [TARGET_GATE_PATH], {
      cwd: invocation.cwd,
      env: gateEnv,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    });
    gate.broker = broker;
    let controlBuffer = '';
    gate.stdio[3].setEncoding('utf8');
    gate.stdio[3].on('data', (chunk) => {
      controlBuffer += chunk;
      let newline;
      while ((newline = controlBuffer.indexOf('\n')) >= 0) {
        const line = controlBuffer.slice(0, newline);
        controlBuffer = controlBuffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.type === 'gate-ready') resolveGateReady(message);
        if (message.type === 'target-terminal') {
          targetResult = {
            status: message.status ?? null,
            signal: message.signal ?? null,
            error: message.error ?? null,
          };
          resolveTargetTerminal(targetResult);
        }
      }
    });
    gate.once('error', (error) => {
      const safe = { name: error.name, code: error.code ?? null, message: error.message };
      rejectGateReady(error);
      targetResult = { status: null, signal: null, error: safe };
      resolveTargetTerminal(targetResult);
    });
    gate.once('close', () => {
      rejectGateReady(new Error('launch gate exited before readiness'));
      if (targetResult.status === null && targetResult.signal === null && !targetResult.error) {
        targetResult = {
          status: null,
          signal: gate.signalCode,
          error: { name: 'Error', code: 'EGATE', message: 'launch gate exited before reporting target status' },
        };
        resolveTargetTerminal(targetResult);
      }
    });
  } catch (error) {
    clearInterval(parentWatch);
    emit({
      status: null,
      signal: null,
      error: { name: error.name, code: error.code ?? null, message: error.message },
      stdout: '', stderr: '', stdoutBytes: 0, stderrBytes: 0,
    });
    broker.close();
    return;
  }

  let cleanupPromise;
  let cleanupError = null;
  terminateFor = (why) => {
    if (reason) return;
    reason = why;
    if (!gate) {
      cleanupPromise = Promise.resolve();
      return;
    }
    cleanupPromise = terminate(gate, why, invocation.killSignal, termination).catch((error) => {
      cleanupError = { name: error.name, code: 'ECLEANUP', message: error.message };
    });
  };
  gate.stdout.on('data', (chunk) => {
    if (appendCapped(stdout, chunk, invocation.maxBuffer)) terminateFor('output-cap');
  });
  gate.stderr.on('data', (chunk) => {
    if (appendCapped(stderr, chunk, invocation.maxBuffer)) terminateFor('output-cap');
  });
  try {
    const ready = await Promise.race([
      gateReady,
      unrefDelay(3_000).then(() => { throw new Error('launch gate readiness timed out'); }),
    ]);
    if (ready.pid !== gate.pid) throw new Error('launch gate reported an unexpected pid');
    // Pin the group before the broker wait. If the parent disappears during
    // that wait, cleanup can still signal the stable gate without launching
    // the target command.
    gate.scopeAttached = true;
    await broker.waitForPid(gate.pid);
    if (parentAbortRequested || process.ppid !== invocation.parentPid) {
      targetResult = { status: null, signal: null, error: { name: 'Error', code: 'EPARENT', message: 'synchronous parent exited before target launch' } };
      terminateFor('parent-abort');
      resolveTargetTerminal(targetResult);
    } else {
      gate.stdin.end(JSON.stringify({
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.cwd,
        env: { ...(invocation.env ?? {}), [invocation.scopeKey]: invocation.scopeToken },
        input: invocation.input,
      }));
    }
  } catch (error) {
    if (parentAbortRequested || process.ppid !== invocation.parentPid) {
      gate.scopeAttached = true;
      targetResult = { status: null, signal: null, error: { name: 'Error', code: 'EPARENT', message: 'synchronous parent exited before target launch' } };
      terminateFor('parent-abort');
    } else {
      targetResult = {
        status: null,
        signal: null,
        error: { name: error.name, code: error.code ?? 'EGATE', message: error.message },
      };
    }
    resolveTargetTerminal(targetResult);
  }

  if (parentAbortRequested || process.ppid !== invocation.parentPid) terminateFor('parent-abort');

  timer = setTimeout(() => terminateFor('timeout'), invocation.timeoutMs);

  await targetTerminal;
  clearTimeout(timer);
  clearInterval(parentWatch);
  if (!cleanupPromise) {
    cleanupPromise = terminate(gate, null, invocation.killSignal, termination).catch((error) => {
      cleanupError = { name: error.name, code: 'ECLEANUP', message: error.message };
    });
  }
  await cleanupPromise;
  try { gate.stdio[4].end('release\n'); } catch { /* gate already terminated */ }
  await Promise.race([
    new Promise((resolvePromise) => {
      if (gate.exitCode !== null || gate.signalCode !== null) resolvePromise();
      else gate.once('close', resolvePromise);
    }),
    unrefDelay(1_000).then(() => {
      if (gate.exitCode === null && gate.signalCode === null) gate.kill('SIGKILL');
    }),
  ]);
  broker.close();
  if (reason === 'parent-abort') return;

  emit({
    status: reason || targetResult.error ? null : targetResult.status,
    signal: targetResult.signal ?? (reason ? termination.signal : null),
    error: reason === 'timeout'
      ? { name: 'Error', code: 'ETIMEDOUT', message: `command timed out after ${invocation.timeoutMs}ms` }
      : targetResult.error,
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
