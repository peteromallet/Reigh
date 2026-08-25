import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE_MANIFEST_PATH = resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json');
const RELEASE_MANIFEST = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
const PINNED_VERSION = RELEASE_MANIFEST?.verification?.astridPython;

if (!/^\d+\.\d+\.\d+$/.test(PINNED_VERSION ?? '')) {
  throw new Error(
    `release manifest must contain an exact verification.astridPython pin; found ${PINNED_VERSION || '<empty>'}`,
  );
}

export const PINNED_PYTHON_VERSION = PINNED_VERSION;
const PYTHON_PROBE = [
  'import json, os, platform, sys; ',
  'print(json.dumps({',
  '"executable": os.path.realpath(sys.executable), ',
  '"implementation": platform.python_implementation(), ',
  '"version": ".".join(map(str, sys.version_info[:3]))',
  '}))',
].join('');

function candidatePaths({ requested, pathValue }) {
  if (requested) return [requested];
  const names = process.platform === 'win32'
    ? ['python3.11.exe', 'python3.exe', 'python.exe', 'python3.11.cmd', 'python3.cmd', 'python.cmd']
    : ['python3.11', 'python3', 'python'];
  const candidates = [];
  for (const entry of String(pathValue ?? '').split(delimiter)) {
    if (!entry) continue;
    for (const name of names) candidates.push(resolve(entry, name));
  }
  return candidates;
}

function probePython(executable) {
  try {
    if (!isAbsolute(executable) || !existsSync(executable) || !statSync(executable).isFile()) return null;
    accessSync(executable, constants.X_OK);
    const canonical = realpathSync(executable);
    const result = spawnSync(canonical, ['-c', PYTHON_PROBE], { stdio: 'pipe', encoding: 'utf8' });
    if (result.error || result.status !== 0) return null;
    const identity = JSON.parse(result.stdout.trim());
    if (
      typeof identity?.executable !== 'string'
      || !isAbsolute(identity.executable)
      || typeof identity?.implementation !== 'string'
      || typeof identity?.version !== 'string'
    ) return { executable: canonical, identity, invalidIdentity: true };
    const resolvedIdentity = realpathSync(identity.executable);
    if (!existsSync(resolvedIdentity) || !statSync(resolvedIdentity).isFile()) {
      return { executable: canonical, identity, invalidIdentity: true };
    }
    accessSync(resolvedIdentity, constants.X_OK);
    return { executable: resolvedIdentity, identity: { ...identity, executable: resolvedIdentity } };
  } catch {
    return null;
  }
}

/**
 * Resolve the exact Python runtime required by the release Astrid bridge.
 * Explicit overrides must be absolute; otherwise only python3.11/python3/python
 * candidates found on PATH are considered. No environment is mutated.
 */
export function resolvePinnedPythonExecutable({
  requested = process.env.ASTRID_PYTHON,
  pathValue = process.env.PATH,
} = {}) {
  if (requested && !isAbsolute(requested)) {
    throw new Error(`ASTRID_PYTHON must be an absolute executable path; got ${requested}`);
  }

  const candidates = candidatePaths({ requested, pathValue });
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const probe = probePython(candidate);
    if (probe?.identity?.version === PINNED_PYTHON_VERSION && probe.identity.executable === probe.executable) {
      return probe.executable;
    }
    if (requested) {
      throw new Error(
        `ASTRID_PYTHON must be Python ${PINNED_PYTHON_VERSION}; `
        + `found ${probe?.identity?.version ?? '<unreadable>'} at ${candidate}`,
      );
    }
  }

  throw new Error(
    `Pinned Astrid Python ${PINNED_PYTHON_VERSION} is unavailable; `
    + 'searched python3.11, python3, and python on PATH',
  );
}
