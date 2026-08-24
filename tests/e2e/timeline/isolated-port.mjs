/**
 * Allocate ports for a Playwright timeline run without adopting a process
 * from another run (or another checkout).
 *
 * The old harness used 2222/17334 and `reuseExistingServer` in local runs.
 * That is convenient for a hand-started dev server, but it turns an old
 * bridge's in-memory timeline into hidden test state.  A run now gets two
 * free ports unless the caller deliberately supplies one; supplied ports are
 * still probed and an occupied port fails loudly instead of being reused.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

const MIN_PORT = 20_000;
const MAX_PORT = 55_000;
const RESERVATION_DIR = join(tmpdir(), 'reigh-playwright-port-reservations');
const reservations = new Map();

function parsePort(value, name) {
  if (value == null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return port;
}

function canonicalizeBaseUrl(value, name = 'BASE_URL') {
  if (value == null || value.trim() === '') return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || !parsed.port
    || parsed.pathname !== '/'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${name} must be an exact http://127.0.0.1:<port> root URL without credentials, query, or hash: ${value}`);
  }
  // Configured extension gates always start a fresh loopback server. Keep the
  // canonical form independent of URL serialization (notably a trailing '/').
  const port = Number(parsed.port);
  return {
    url: `http://127.0.0.1:${port}`,
    port,
  };
}

/** Resolve the two supported aliases and reject a stale/mismatched target. */
export function readCanonicalBaseUrl() {
  const base = canonicalizeBaseUrl(process.env.BASE_URL, 'BASE_URL');
  const playwright = canonicalizeBaseUrl(process.env.PLAYWRIGHT_BASE_URL, 'PLAYWRIGHT_BASE_URL');
  if (base && playwright && base.url !== playwright.url) {
    throw new Error(`BASE_URL and PLAYWRIGHT_BASE_URL disagree (${base.url} vs ${playwright.url}); refusing an ambiguous test target`);
  }
  return playwright ?? base;
}

export function resolveCanonicalBaseUrl(port) {
  const configured = readCanonicalBaseUrl();
  if (configured && configured.port !== port) {
    throw new Error(`Configured base URL port ${configured.port} does not match PLAYWRIGHT_PORT=${port}`);
  }
  return configured?.url ?? `http://127.0.0.1:${port}`;
}

export function readPublishedPort(envName) {
  const port = parsePort(process.env[envName], envName);
  if (port == null) throw new Error(`${envName} was marked run-allocated but is missing`);
  return port;
}

/** Probe bindability in a short-lived child so config loading stays sync. */
function isFree(port) {
  const probe = spawnSync(process.execPath, ['-e', [
    "const net=require('node:net');",
    `const server=net.createServer(); server.once('error',()=>process.exit(2)); server.listen(${port},'127.0.0.1',()=>server.close(()=>process.exit(0)));`,
  ].join(' ')], { stdio: 'ignore' });
  return probe.status === 0;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function reservationPath(port) {
  return join(RESERVATION_DIR, `${port}.lock`);
}

/**
 * Reserve a candidate with an atomic O_EXCL lock before probing it. This
 * coordinates independent Playwright config processes; the lock remains held
 * until the config process exits, covering the probe → webServer startup gap.
 */
function reserve(port) {
  mkdirSync(RESERVATION_DIR, { recursive: true });
  const path = reservationPath(port);
  // A stale lock may be left by a process that exited between the bind probe
  // and webServer startup. Reclaim it and retry the same candidate; callers
  // should not need to win a second random draw after safe cleanup.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), port, createdAt: Date.now() }));
      closeSync(fd);
      reservations.set(port, path);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = false;
      try {
        const owner = JSON.parse(readFileSync(path, 'utf8'));
        const pid = Number(owner.pid);
        stale = Number.isSafeInteger(pid) && pid > 0 && !processIsAlive(pid);
      } catch {
        // A partially written/unreadable lock is safe to reclaim only when
        // ownership cannot be disproved. Leave it for a later run to inspect.
      }
      if (!stale) return false;
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        // Another allocator may have reclaimed/replaced it. Retry the atomic
        // open so we never delete a lock that belongs to that allocator.
        if (unlinkError?.code !== 'ENOENT') return false;
      }
    }
  }
  return false;
}

function release(port) {
  const path = reservations.get(port);
  if (!path) return;
  reservations.delete(port);
  try { unlinkSync(path); } catch { /* already cleaned up */ }
}

process.once('exit', () => {
  for (const port of reservations.keys()) release(port);
});

/**
 * Return a run-isolated port and publish it to child web servers/test files.
 * Explicit ports remain supported for debugging, but an occupied explicit
 * port is a hard error: never silently attach to stale state.
 */
export function allocateIsolatedPort(envName, used = new Set()) {
  const explicit = parsePort(process.env[envName], envName);
  if (explicit != null) {
    if (used.has(explicit) || !reserve(explicit) || !isFree(explicit)) {
      if (!used.has(explicit)) release(explicit);
      throw new Error(
        `${envName}=${explicit} is already in use; refusing to reuse a stale editor/bridge process. ` +
        'Stop it or omit the variable so the harness can allocate an isolated port.',
      );
    }
    used.add(explicit);
    process.env[envName] = String(explicit);
    return explicit;
  }

  // Randomized candidates avoid collisions between parallel checkouts/runs;
  // the bind probe makes a collision a retry rather than a flaky webServer.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = randomInt(MIN_PORT, MAX_PORT + 1);
    if (used.has(candidate) || !reserve(candidate)) continue;
    if (!isFree(candidate)) {
      release(candidate);
      continue;
    }
    used.add(candidate);
    process.env[envName] = String(candidate);
    return candidate;
  }
  throw new Error(`Could not allocate a free isolated port for ${envName} after 80 attempts`);
}
