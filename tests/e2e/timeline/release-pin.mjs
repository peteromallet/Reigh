import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const RELEASE_MANIFEST_PATH = resolve(
  REPO_ROOT,
  'config/releases/extension-ship-quality.json',
);

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/;

export function readPinnedAstridSha(manifestPath = RELEASE_MANIFEST_PATH) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read the extension release manifest at ${manifestPath}`, {
      cause: error,
    });
  }

  const sha = manifest?.astrid?.commit;
  if (typeof sha !== 'string' || !FULL_COMMIT_SHA.test(sha)) {
    throw new Error(
      `Extension release manifest astrid.commit must be an exact lowercase 40-character commit SHA; got ${String(sha)}`,
    );
  }
  return sha;
}

export function resolveAstridCheckoutPath(value = process.env.ASTRID_CHECKOUT) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('ASTRID_CHECKOUT is required for the real-bridge browser harness');
  }
  if (!isAbsolute(value)) {
    throw new Error(`ASTRID_CHECKOUT must be an absolute path; got ${value}`);
  }
  return resolve(value);
}
