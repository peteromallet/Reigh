import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as osConstants, tmpdir } from 'node:os';

const FAILURE_TYPES = new Set([
  'success',
  'exit',
  'signal',
  'spawn-error',
  'output-cap',
  'timeout',
  'cleanup-error',
  'unknown',
]);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const WRAPPER_PATH = resolve(moduleDir, 'bounded-command-wrapper.mjs');
const WRAPPER_PROTOCOL_BYTES = 16 * 1024;
const WRAPPER_CLEANUP_ALLOWANCE_MS = 10_000;
export const PROCESS_SCOPE_ENV_KEY = 'REIGH_BOUNDED_PROCESS_SCOPE';
const BROKER_SESSION_ENV_KEY = 'REIGH_BOUNDED_BROKER_SESSION';
if (!/^[0-9a-f]{32}$/.test(process.env[BROKER_SESSION_ENV_KEY] ?? '')) {
  process.env[BROKER_SESSION_ENV_KEY] = randomBytes(16).toString('hex');
}
const BROKER_TEMP_ROOT = process.platform === 'darwin' ? '/tmp' : tmpdir();
const BROKER_DIR = join(BROKER_TEMP_ROOT, `rb-${process.pid}-${process.env[BROKER_SESSION_ENV_KEY].slice(0, 12)}`);
const BROKER_SOCKET = join(BROKER_DIR, 'broker.sock');
const BROKER_READY = `${BROKER_SOCKET}.ready`;
const BROKER_ELECTION = `${BROKER_SOCKET}.election`;
const BROKER_LOCK_TOOL = process.platform === 'darwin' ? '/usr/bin/lockf' : '/usr/bin/flock';
const BROKER_OWNER_START_SECONDS = Math.floor((Date.now() - process.uptime() * 1_000) / 1_000);
if (Buffer.byteLength(BROKER_SOCKET) > 100) {
  throw new Error(`bounded-command broker socket path is too long: ${BROKER_SOCKET}`);
}
const INTERNAL_ENV = Object.freeze({
  PATH: dirname(process.execPath),
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith(`${PROCESS_SCOPE_ENV_KEY}_`)),
  ),
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function assertCommand(command) {
  if (typeof command !== 'string' || command.length === 0 || command.includes('\0')) {
    throw new TypeError('command must be a non-empty string without NUL bytes');
  }
  return command;
}

function cloneArgs(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('args must be an array of strings without NUL bytes');
  }
  return Object.freeze([...args]);
}

function cloneEnvironment(env) {
  if (env === undefined) return undefined;
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('env must be an object when provided');
  }
  const copy = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.includes('\0') || (value !== undefined && typeof value !== 'string' && typeof value !== 'number')) {
      throw new TypeError('env keys and values must be NUL-free strings or numbers');
    }
    copy[key] = value;
  }
  return Object.freeze(copy);
}

function cloneCwd(cwd) {
  if (cwd === undefined) return undefined;
  if (typeof cwd !== 'string' || cwd.length === 0 || cwd.includes('\0')) {
    throw new TypeError('cwd must be a non-empty string without NUL bytes when provided');
  }
  return cwd;
}

function normalizeKillSignal(killSignal) {
  const signalValues = Object.values(osConstants.signals ?? {});
  if (
    (typeof killSignal !== 'string' && !Number.isSafeInteger(killSignal))
    || (typeof killSignal === 'string' && killSignal.length === 0)
    || (typeof killSignal === 'number' && killSignal <= 0)
    || (typeof killSignal === 'string' && !(killSignal in (osConstants.signals ?? {})))
    || (typeof killSignal === 'number' && !signalValues.includes(killSignal))
  ) {
    throw new TypeError('killSignal must be a signal name or number supported by this platform');
  }
  return killSignal;
}

function normalizeLabel(label, command) {
  const value = label ?? command;
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError('label must be a non-empty string without NUL bytes');
  }
  return value;
}

function normalizeRedactions(redact, env) {
  const tokens = [];
  if (Array.isArray(redact)) {
    for (const token of redact) {
      if (typeof token === 'string' && token.length > 0) tokens.push(token);
    }
  }
  if (typeof redact === 'string' && redact.length > 0) tokens.push(redact);
  if (env) {
    for (const value of Object.values(env)) {
      if (typeof value === 'string' && value.length >= 4) tokens.push(value);
    }
  }
  return [...new Set(tokens)].sort((left, right) => right.length - left.length);
}

function redactText(value, redact, tokens) {
  const text = String(value ?? '');
  let redacted = text;
  if (typeof redact === 'function') redacted = String(redact(redacted));
  for (const token of tokens) redacted = redacted.split(token).join('[REDACTED]');
  return redacted;
}

function captureText(value, maxBuffer, redact, tokens) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  const truncated = source.length > maxBuffer;
  const captured = source.subarray(0, maxBuffer).toString('utf8');
  return Object.freeze({
    text: redactText(captured, redact, tokens),
    truncated,
    bytes: source.length,
  });
}

function safeError(error, redact, tokens) {
  if (!error) return null;
  return Object.freeze({
    name: typeof error.name === 'string' ? error.name : 'Error',
    code: typeof error.code === 'string' ? error.code : null,
    message: redactText(error.message ?? String(error), redact, tokens),
  });
}

function classify(result, stdout, stderr) {
  const code = result.error?.code;
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ENOBUFS' || stdout.truncated || stderr.truncated) return 'output-cap';
  if (result.error) return 'spawn-error';
  if (typeof result.status === 'number' && result.status !== 0) return 'exit';
  if (result.signal) return 'signal';
  if (result.status === 0) return 'success';
  return 'unknown';
}

function wrapperOutputCap(maxBuffer) {
  // Each bounded stream is base64-encoded by the protocol. Leave room for
  // both streams plus the JSON envelope without weakening the target cap.
  return Math.ceil(maxBuffer * 8 / 3) + WRAPPER_PROTOCOL_BYTES;
}

function launchScopeBroker() {
  // All wrappers in one Node process point at one broker. Launching a small
  // candidate per invocation is race-safe: the broker's atomic lock elects a
  // single owner and the losers exit immediately. This keeps `ps` centralized
  // even when callers use worker threads.
  try {
    try {
      mkdirSync(BROKER_DIR, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const stat = lstatSync(BROKER_DIR);
      const ownedByCaller = typeof process.getuid !== 'function' || stat.uid === process.getuid();
      if (!stat.isDirectory() || stat.isSymbolicLink() || !ownedByCaller || (stat.mode & 0o777) !== 0o700) {
        throw new Error(`bounded-command broker directory is not a private caller-owned directory: ${BROKER_DIR}`);
      }
    }
    const candidateNonce = randomBytes(16).toString('hex');
    // The kernel lock is held by lockf/flock for the complete broker
    // lifetime. It replaces the crash-prone application takeover mutex.
    const lockArgs = process.platform === 'darwin'
      ? ['-k', '-t', '0', BROKER_ELECTION, process.execPath, WRAPPER_PATH, '--broker', BROKER_SOCKET, candidateNonce, String(process.pid), String(BROKER_OWNER_START_SECONDS), BROKER_ELECTION]
      : ['-n', BROKER_ELECTION, process.execPath, WRAPPER_PATH, '--broker', BROKER_SOCKET, candidateNonce, String(process.pid), String(BROKER_OWNER_START_SECONDS), BROKER_ELECTION];
    const candidate = spawn(BROKER_LOCK_TOOL, lockArgs, {
      stdio: 'ignore',
      detached: true,
      env: INTERNAL_ENV,
    });
    candidate.unref();
  } catch {
    // The wrapper reports an actionable broker connection failure.
  }
  // A synchronous caller cannot await the detached launch. The broker writes
  // a private readiness sentinel after binding; wait briefly so wrappers do
  // not race the server's listen() under a 20-worker startup burst.
  const gate = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(BROKER_READY)) return;
    Atomics.wait(gate, 0, 0, 10);
  }
}

function decodeWrapperResult(raw, maxBuffer, redact, tokens) {
  const text = String(raw?.stdout ?? '').trim();
  const line = text.split('\n').filter(Boolean).at(-1);
  if (!line) return null;
  try {
    const result = JSON.parse(line);
    if (result?.protocol !== 1) return null;
    return {
      status: result.status ?? null,
      signal: result.signal ?? null,
      error: result.error ?? null,
      cleanupError: result.cleanupError ?? null,
      reason: result.reason ?? null,
      stdout: Buffer.from(result.stdout ?? '', 'base64'),
      stderr: Buffer.from(result.stderr ?? '', 'base64'),
      stdoutBytes: Number.isSafeInteger(result.stdoutBytes) ? result.stdoutBytes : 0,
      stderrBytes: Number.isSafeInteger(result.stderrBytes) ? result.stderrBytes : 0,
    };
  } catch {
    return null;
  }
}

function freezeResult(result) {
  return Object.freeze(result);
}

export class BoundedCommandError extends Error {
  constructor(result) {
    super(formatBoundedCommandFailure(result));
    this.name = 'BoundedCommandError';
    this.result = result;
    this.diagnostics = result;
  }
}

export function formatBoundedCommandFailure(result) {
  const details = result.failureType === 'timeout'
    ? `timed out after ${result.timeoutMs}ms`
    : result.failureType === 'exit'
      ? `exited with status ${result.status}`
      : result.failureType === 'signal'
        ? `terminated by ${result.signal}`
        : result.failureType === 'output-cap'
          ? `exceeded the ${result.maxBuffer}-byte output cap`
          : result.failureType === 'cleanup-error'
            ? `failed to clean up scoped processes${result.error?.message ? ` (${result.error.message})` : ''}`
          : result.failureType === 'spawn-error'
            ? `failed to spawn${result.error?.code ? ` (${result.error.code})` : ''}`
            : 'failed without a terminal status';
  return `${result.label} ${details} after ${result.elapsedMs}ms`;
}

/**
 * Run one external command with a bounded synchronous wait and bounded output.
 * The child is always invoked with shell:false. Failed commands throw by
 * default; pass allowFailure:true when a caller needs to inspect the result.
 */
export function runBoundedCommand(command, args, options = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error(`runBoundedCommand requires Darwin or Linux process containment; ${process.platform} is unsupported`);
  }
  assertCommand(command);
  const immutableArgs = cloneArgs(args);
  const cwd = cloneCwd(options.cwd);
  const env = cloneEnvironment(options.env);
  const label = normalizeLabel(options.label, command);
  if (!hasOwn(options, 'timeoutMs')) throw new TypeError('timeoutMs is required');
  if (!hasOwn(options, 'maxBuffer')) throw new TypeError('maxBuffer is required');
  if (!hasOwn(options, 'killSignal')) throw new TypeError('killSignal is required');
  const timeoutMs = assertPositiveInteger(options.timeoutMs, 'timeoutMs');
  const maxBuffer = assertPositiveInteger(options.maxBuffer, 'maxBuffer');
  const killSignal = normalizeKillSignal(options.killSignal);
  if (hasOwn(options, 'shell') && options.shell !== false) {
    throw new TypeError('shell is forbidden; bounded commands always use shell:false');
  }
  if (options.input !== undefined && typeof options.input !== 'string' && !Buffer.isBuffer(options.input)) {
    throw new TypeError('input must be a string or Buffer when provided');
  }
  const redact = options.redact;
  if (redact !== undefined && !Array.isArray(redact) && typeof redact !== 'string' && typeof redact !== 'function') {
    throw new TypeError('redact must be a function, string, or string array');
  }
  const tokens = normalizeRedactions(redact, env);
  const binaryOutput = options.encoding === null;
  if (binaryOutput && redact !== undefined) {
    throw new TypeError('redact cannot be used with binary output');
  }
  const startedAt = performance.now();
  // The scope token is deliberately generated outside the wrapper so the
  // wrapper itself never inherits it. Only the target receives it, and every
  // descendant (including detached/reparented descendants) inherits it.
  const scopeToken = randomBytes(32).toString('hex');
  const scopeKey = `${PROCESS_SCOPE_ENV_KEY}_${randomBytes(12).toString('hex')}`;
  let raw;
  try {
    if (!existsSync(WRAPPER_PATH)) throw new Error(`bounded command wrapper is missing: ${WRAPPER_PATH}`);
    launchScopeBroker();
    // Keep the command, environment, and scope token out of the wrapper's
    // argv.  `ps eww` exposes argv to every local user; stdin is inherited by
    // the wrapper only long enough to decode this private invocation.
    const wrapperInput = JSON.stringify({
      command,
      args: immutableArgs,
      cwd,
      env: (() => {
        const targetEnv = { ...(env ?? process.env) };
        delete targetEnv[BROKER_SESSION_ENV_KEY];
        return targetEnv;
      })(),
      timeoutMs,
      maxBuffer,
      killSignal,
      scopeKey,
      scopeToken,
      parentPid: process.pid,
      brokerSocket: BROKER_SOCKET,
      input: options.input === undefined
        ? undefined
        : Buffer.from(options.input).toString('base64'),
    });
    // The wrapper owns the target's detached process group. Its watchdog is
    // responsible for TERM->KILL cleanup; leave a small outer allowance for
    // reaping and protocol serialization before the synchronous boundary.
    raw = spawnSync(process.execPath, [WRAPPER_PATH], {
      cwd,
      env: INTERNAL_ENV,
      encoding: 'utf8',
      maxBuffer: wrapperOutputCap(maxBuffer),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: wrapperInput,
      detached: process.platform !== 'win32',
      timeout: timeoutMs + WRAPPER_CLEANUP_ALLOWANCE_MS,
      killSignal: 'SIGKILL',
    });
  } catch (error) {
    raw = { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const wrapped = decodeWrapperResult(raw, maxBuffer, redact, tokens);
  const effectiveRaw = wrapped
    ? {
        status: wrapped.status,
        signal: wrapped.signal,
        error: wrapped.error ?? (wrapped.cleanupError
          ? { name: 'CleanupError', code: 'ECLEANUP', message: wrapped.cleanupError.message ?? String(wrapped.cleanupError) }
          : null),
        stdout: wrapped.stdout,
        stderr: wrapped.stderr,
      }
    : raw;
  const stdout = wrapped
    ? Object.freeze({
        text: redactText(wrapped.stdout.subarray(0, maxBuffer).toString('utf8'), redact, tokens),
        truncated: wrapped.stdoutBytes > maxBuffer,
        bytes: wrapped.stdoutBytes,
      })
    : captureText(raw.stdout, maxBuffer, redact, tokens);
  const stderr = wrapped
    ? Object.freeze({
        text: redactText(wrapped.stderr.subarray(0, maxBuffer).toString('utf8'), redact, tokens),
        truncated: wrapped.stderrBytes > maxBuffer,
        bytes: wrapped.stderrBytes,
      })
    : captureText(raw.stderr, maxBuffer, redact, tokens);
  const failureType = wrapped?.cleanupError
    ? 'cleanup-error'
    : wrapped?.reason === 'timeout'
    ? 'timeout'
    : wrapped?.reason === 'output-cap'
      ? 'output-cap'
      : classify(effectiveRaw, stdout, stderr);
  const result = freezeResult({
    ok: failureType === 'success',
    failureType,
    label,
    command: redactText(command, redact, tokens),
    args: Object.freeze(immutableArgs.map((arg) => redactText(arg, redact, tokens))),
    cwd: cwd ?? null,
    timeoutMs,
    maxBuffer,
    killSignal,
    elapsedMs,
    status: effectiveRaw.status ?? null,
    signal: effectiveRaw.signal ?? null,
    error: safeError(effectiveRaw.error, redact, tokens),
    stdout: binaryOutput
      ? (wrapped ? wrapped.stdout.subarray(0, maxBuffer) : Buffer.from(raw.stdout ?? '').subarray(0, maxBuffer))
      : stdout.text,
    stderr: binaryOutput
      ? (wrapped ? wrapped.stderr.subarray(0, maxBuffer) : Buffer.from(raw.stderr ?? '').subarray(0, maxBuffer))
      : stderr.text,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    cleanupError: wrapped?.cleanupError
      ? safeError(wrapped.cleanupError, redact, tokens)
      : null,
  });
  if (!FAILURE_TYPES.has(failureType)) throw new Error(`unhandled bounded command failure type: ${failureType}`);
  if (!result.ok && options.allowFailure !== true) throw new BoundedCommandError(result);
  return result;
}
