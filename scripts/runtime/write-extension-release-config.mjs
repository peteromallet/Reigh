#!/usr/bin/env node

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXTENSION_RELEASE_ENV_NAMES = Object.freeze({
  host: 'EXTENSION_HOST_ENABLED',
  transcript: 'TRANSCRIPT_CAPTION_FOUNDRY_ENABLED',
  runaway: 'RUNAWAY_TYPED_TIMELINE_ENABLED',
  revision: 'EXTENSION_RELEASE_CONFIG_REVISION',
});

export const DEFAULT_RUNTIME_CONFIG_PATH = resolve(
  process.cwd(),
  'dist/runtime-config/v1/extensions.json',
);

const VALID_REVISION = /^[A-Za-z0-9._-]{1,64}$/;
const enabled = (value) => value === '1' || value === 'true';

/**
 * Build the public rollout document from runtime-only environment variables.
 * Missing/malformed revisions force every switch off. VITE_* variables are
 * deliberately absent from this contract and therefore ignored.
 */
export function createExtensionReleaseRuntimeConfig(env) {
  const requestedHost = enabled(env[EXTENSION_RELEASE_ENV_NAMES.host]);
  const rawRevision = env[EXTENSION_RELEASE_ENV_NAMES.revision];
  const revision = typeof rawRevision === 'string' && VALID_REVISION.test(rawRevision.trim())
    ? rawRevision.trim()
    : 'default-closed';
  const hostEnabled = requestedHost && revision !== 'default-closed';

  return {
    schemaVersion: 1,
    revision,
    extensions: {
      hostEnabled,
      transcriptCaptionFoundryEnabled: hostEnabled
        && enabled(env[EXTENSION_RELEASE_ENV_NAMES.transcript]),
      runawayTypedTimelineEnabled: hostEnabled
        && enabled(env[EXTENSION_RELEASE_ENV_NAMES.runaway]),
    },
  };
}

/** Write beside the destination and rename, so preview never serves a partial file. */
export async function writeExtensionReleaseRuntimeConfig({
  env = process.env,
  outputPath = DEFAULT_RUNTIME_CONFIG_PATH,
} = {}) {
  const config = createExtensionReleaseRuntimeConfig(env);
  const outputDirectory = dirname(outputPath);
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  });
  await rename(temporaryPath, outputPath);
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeExtensionReleaseRuntimeConfig();
}
