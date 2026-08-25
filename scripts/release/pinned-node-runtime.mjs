import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE_VERSION_PIN = readFileSync(resolve(REPO_ROOT, '.nvmrc'), 'utf8').trim();
if (!/^v?\d+\.\d+\.\d+$/.test(NODE_VERSION_PIN)) {
  throw new Error(`.nvmrc must contain an exact Node semver pin; found ${NODE_VERSION_PIN || '<empty>'}`);
}
export const PINNED_NODE_VERSION = NODE_VERSION_PIN.startsWith('v') ? NODE_VERSION_PIN : `v${NODE_VERSION_PIN}`;

function candidatePaths({ requested, currentExecutable, pathValue }) {
  if (requested) return [requested];
  const candidates = [currentExecutable];
  const executableNames = process.platform === 'win32' ? ['node.exe', 'node.cmd'] : ['node'];
  for (const entry of String(pathValue ?? '').split(delimiter)) {
    if (!entry) continue;
    for (const executableName of executableNames) candidates.push(resolve(entry, executableName));
  }
  return candidates;
}

function probeVersion(executable) {
  try {
    if (!isAbsolute(executable) || !existsSync(executable) || !statSync(executable).isFile()) return null;
    accessSync(executable, constants.X_OK);
    const canonical = realpathSync(executable);
    const result = spawnSync(canonical, ['--version'], { stdio: 'pipe' });
    if (result.error || result.status !== 0) return null;
    return { executable: canonical, version: result.stdout.toString().trim() };
  } catch {
    return null;
  }
}

/**
 * Resolve the exact Node runtime required by release-facing Astrid tooling.
 * The resolver accepts an explicit absolute override, otherwise checks the
 * current runtime and every `node` candidate on PATH; it never embeds a
 * user-specific version-manager path.
 */
export function resolvePinnedNodeExecutable({
  requested = process.env.ASTRID_NODE_EXECUTABLE,
  currentExecutable = process.execPath,
  pathValue = process.env.PATH,
} = {}) {
  const candidates = candidatePaths({ requested, currentExecutable, pathValue });
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const probe = probeVersion(candidate);
    if (probe?.version === PINNED_NODE_VERSION) return probe.executable;
    if (requested) {
      throw new Error(
        `ASTRID_NODE_EXECUTABLE must be Node ${PINNED_NODE_VERSION}; `
        + `found ${probe?.version ?? '<unreadable>'} at ${candidate}`,
      );
    }
  }
  throw new Error(
    `Pinned Node ${PINNED_NODE_VERSION} is unavailable; select the repository .nvmrc runtime `
    + `or set ASTRID_NODE_EXECUTABLE to an absolute executable path`,
  );
}
