import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const FAILURE_TYPES = new Set([
  'success',
  'exit',
  'signal',
  'spawn-error',
  'output-cap',
  'timeout',
  'unknown',
]);

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
  const startedAt = performance.now();
  let raw;
  try {
    raw = spawnSync(command, immutableArgs, {
      cwd,
      env,
      encoding: 'utf8',
      input: options.input,
      maxBuffer,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal,
    });
  } catch (error) {
    raw = { error, status: null, signal: null, stdout: '', stderr: '' };
  }
  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
  const stdout = captureText(raw.stdout, maxBuffer, redact, tokens);
  const stderr = captureText(raw.stderr, maxBuffer, redact, tokens);
  const failureType = classify(raw, stdout, stderr);
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
    status: raw.status ?? null,
    signal: raw.signal ?? null,
    error: safeError(raw.error, redact, tokens),
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  });
  if (!FAILURE_TYPES.has(failureType)) throw new Error(`unhandled bounded command failure type: ${failureType}`);
  if (!result.ok && options.allowFailure !== true) throw new BoundedCommandError(result);
  return result;
}
