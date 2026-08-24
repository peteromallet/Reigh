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
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';

const MIN_PORT = 20_000;
const MAX_PORT = 55_000;

function parsePort(value, name) {
  if (value == null || value === '') return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
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

/**
 * Return a run-isolated port and publish it to child web servers/test files.
 * Explicit ports remain supported for debugging, but an occupied explicit
 * port is a hard error: never silently attach to stale state.
 */
export function allocateIsolatedPort(envName, used = new Set()) {
  const explicit = parsePort(process.env[envName], envName);
  if (explicit != null) {
    if (used.has(explicit) || !isFree(explicit)) {
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
    if (used.has(candidate) || !isFree(candidate)) continue;
    used.add(candidate);
    process.env[envName] = String(candidate);
    return candidate;
  }
  throw new Error(`Could not allocate a free isolated port for ${envName} after 80 attempts`);
}
