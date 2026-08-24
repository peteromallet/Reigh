import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILURE_TYPES = new Set([
  'success',
  'exit',
  'signal',
  'spawn-error',
  'output-cap',
  'timeout',
  'unknown',
]);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const WRAPPER_PATH = resolve(moduleDir, 'bounded-command-wrapper.mjs');
const WRAPPER_PROTOCOL_BYTES = 16 * 1024;
const TERMINATION_GRACE_MS = 250;

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
  if (
    (typeof killSignal !== 'string' && !Number.isSafeInteger(killSignal))
    || (typeof killSignal === 'string' && killSignal.length === 0)
    || (typeof killSignal === 'number' && killSignal <= 0)
  ) {
    throw new TypeError('killSignal must be a non-empty signal name or positive signal number');
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

function encodeInvocation(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function wrapperOutputCap(maxBuffer) {
  // Each bounded stream is base64-encoded by the protocol. Leave room for
  // both streams plus the JSON envelope without weakening the target cap.
  return Math.ceil(maxBuffer * 8 / 3) + WRAPPER_PROTOCOL_BYTES;
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
  let raw;
  try {
    if (!existsSync(WRAPPER_PATH)) throw new Error(`bounded command wrapper is missing: ${WRAPPER_PATH}`);
    const wrapperInput = encodeInvocation({
      command,
      args: immutableArgs,
      cwd,
      env,
      timeoutMs,
      maxBuffer,
      parentPid: process.pid,
      input: options.input === undefined
        ? undefined
        : Buffer.from(options.input).toString('base64'),
    });
    // The wrapper owns the target's detached process group. Its watchdog is
    // responsible for TERM->KILL cleanup; leave a small outer allowance for
    // reaping and protocol serialization before the synchronous boundary.
    raw = spawnSync(process.execPath, [WRAPPER_PATH, wrapperInput], {
      cwd,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: wrapperOutputCap(maxBuffer),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      timeout: timeoutMs + TERMINATION_GRACE_MS + 1_000,
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
        error: wrapped.error,
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
  const failureType = wrapped?.reason === 'timeout'
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
  });
  if (!FAILURE_TYPES.has(failureType)) throw new Error(`unhandled bounded command failure type: ${failureType}`);
  if (!result.ok && options.allowFailure !== true) throw new BoundedCommandError(result);
  return result;
}
