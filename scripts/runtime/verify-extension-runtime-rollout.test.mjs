import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { writeExtensionReleaseRuntimeConfig } from './write-extension-release-config.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const distRoot = resolve(repoRoot, 'dist');
const runtimeConfigPath = resolve(distRoot, 'runtime-config/v1/extensions.json');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat().sort();
}

async function builtArtifactHashes() {
  const files = (await listFiles(distRoot)).filter((path) => path !== runtimeConfigPath);
  return Object.fromEntries(await Promise.all(files.map(async (path) => [
    path.slice(distRoot.length + 1),
    createHash('sha256').update(await readFile(path)).digest('hex'),
  ])));
}

describe('production built artifact/runtime rollout matrix', () => {
  it('changes rollout state without changing the Vite build', async () => {
    const assets = (await listFiles(resolve(distRoot, 'assets')))
      .filter((path) => path.endsWith('.js'));
    const javascript = (await Promise.all(assets.map((path) => readFile(path, 'utf8')))).join('\n');
    for (const retiredName of [
      'VITE_EXTENSION_HOST_ENABLED',
      'VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED',
      'VITE_RUNAWAY_TYPED_TIMELINE_ENABLED',
      'VITE_EXTENSION_RELEASE_CONFIG_REVISION',
    ]) {
      assert.doesNotMatch(javascript, new RegExp(retiredName));
    }
    assert.doesNotMatch(javascript, /com\.reigh\.smoke\.extension-smoke/);
    assert.doesNotMatch(javascript, /extension-smoke-status/);

    const before = await builtArtifactHashes();
    const matrix = [
      {
        env: {},
        expected: [false, false, false, 'default-closed'],
      },
      {
        env: {
          EXTENSION_HOST_ENABLED: 'true',
          TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
          RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
        },
        expected: [false, false, false, 'default-closed'],
      },
      {
        env: {
          EXTENSION_HOST_ENABLED: 'true',
          TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
          RUNAWAY_TYPED_TIMELINE_ENABLED: 'false',
          EXTENSION_RELEASE_CONFIG_REVISION: 'rollout-17',
        },
        expected: [true, true, false, 'rollout-17'],
      },
      {
        env: {
          EXTENSION_HOST_ENABLED: 'false',
          TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
          RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
          EXTENSION_RELEASE_CONFIG_REVISION: 'rollback-18',
        },
        expected: [false, false, false, 'rollback-18'],
      },
    ];

    for (const row of matrix) {
      const config = await writeExtensionReleaseRuntimeConfig({
        env: row.env,
        outputPath: runtimeConfigPath,
      });
      assert.deepEqual([
        config.extensions.hostEnabled,
        config.extensions.transcriptCaptionFoundryEnabled,
        config.extensions.runawayTypedTimelineEnabled,
        config.revision,
      ], row.expected);
      assert.deepEqual(await builtArtifactHashes(), before);
    }
  });
});
