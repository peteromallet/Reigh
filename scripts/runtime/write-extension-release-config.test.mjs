import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  createExtensionReleaseRuntimeConfig,
  writeExtensionReleaseRuntimeConfig,
} from './write-extension-release-config.mjs';

describe('extension release runtime config writer', () => {
  it('defaults closed and ignores the retired VITE build controls', () => {
    assert.deepEqual(createExtensionReleaseRuntimeConfig({
      VITE_EXTENSION_HOST_ENABLED: 'true',
      VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
      VITE_RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
      VITE_EXTENSION_RELEASE_CONFIG_REVISION: 'attacker-query',
    }), {
      schemaVersion: 1,
      revision: 'default-closed',
      extensions: {
        hostEnabled: false,
        transcriptCaptionFoundryEnabled: false,
        runawayTypedTimelineEnabled: false,
      },
    });
  });

  it('requires a valid revision and applies the host parent gate', () => {
    assert.equal(createExtensionReleaseRuntimeConfig({
      EXTENSION_HOST_ENABLED: 'true',
      TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
      EXTENSION_RELEASE_CONFIG_REVISION: '../invalid',
    }).extensions.hostEnabled, false);

    assert.deepEqual(createExtensionReleaseRuntimeConfig({
      EXTENSION_HOST_ENABLED: 'true',
      TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'false',
      RUNAWAY_TYPED_TIMELINE_ENABLED: '1',
      EXTENSION_RELEASE_CONFIG_REVISION: 'rc1-canary.3',
    }), {
      schemaVersion: 1,
      revision: 'rc1-canary.3',
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: false,
        runawayTypedTimelineEnabled: true,
      },
    });
  });

  it('atomically replaces the served file without leaving a temporary sibling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reigh-runtime-config-'));
    const outputPath = join(directory, 'runtime-config/v1/extensions.json');
    await writeExtensionReleaseRuntimeConfig({ outputPath, env: {} });
    await writeFile(outputPath, 'stale', 'utf8');
    const expected = await writeExtensionReleaseRuntimeConfig({
      outputPath,
      env: {
        EXTENSION_HOST_ENABLED: '1',
        TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: '1',
        RUNAWAY_TYPED_TIMELINE_ENABLED: 'false',
        EXTENSION_RELEASE_CONFIG_REVISION: 'runtime-2',
      },
    });
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), expected);
    assert.deepEqual(await readdir(join(directory, 'runtime-config/v1')), ['extensions.json']);
  });
});
