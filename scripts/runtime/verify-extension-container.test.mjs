import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  assertNonRootConfigUser,
  assertRuntimeConfig,
  buildDockerArgv,
  parsePublishedPort,
  REPO_ROOT,
  ROLLOUT_SCENARIOS,
  validateDigestPinnedDockerfile,
} from './verify-extension-container.mjs';

const scriptPath = resolve(REPO_ROOT, 'scripts/runtime/verify-extension-container.mjs');

describe('production extension container gate', () => {
  it('uses a digest-pinned, non-root production Dockerfile', async () => {
    const dockerfile = await readFile(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json'), 'utf8'));
    const pin = validateDigestPinnedDockerfile(dockerfile, manifest.verification.nodeImageDigest);
    assert.match(pin.digest.replace(/^@/, ''), /^sha256:[0-9a-f]{64}$/);
    assert.match(dockerfile, /^HEALTHCHECK .*\\$/m);
    assert.match(dockerfile, /USER node/);
  });

  it('fails closed when the configured digest or built-image attestation drifts', async () => {
    const dockerfile = await readFile(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json'), 'utf8'));
    assert.throws(
      () => validateDigestPinnedDockerfile(dockerfile, `sha256:${'0'.repeat(64)}`),
      /does not match configured/,
    );
    assert.throws(
      () => validateDigestPinnedDockerfile(dockerfile.replace(/org\.opencontainers\.image\.base\.digest="[^"]+"/, 'org.opencontainers.image.base.digest="sha256:' + '0'.repeat(64) + '"'), manifest.verification.nodeImageDigest),
      /metadata label does not attest/,
    );
  });

  it('builds with fixed safe argv and no rollout build controls', () => {
    const args = buildDockerArgv('reigh-extension-container-gate:test');
    assert.deepEqual(args.slice(0, 7), [
      'build', '--file', 'Dockerfile', '--tag',
      'reigh-extension-container-gate:test', '--pull=false', '--progress=plain',
    ]);
    assert.equal(args.at(-1), '.');
    assert.ok(args.includes('VITE_APP_ENV=production'));
    assert.ok(!args.some((arg) => arg.startsWith('EXTENSION_')));
    assert.ok(!args.some((arg) => arg.startsWith('TRANSCRIPT_')));
    assert.ok(!args.some((arg) => arg.startsWith('RUNAWAY_')));
  });

  it('runs smoke and rollback with the reviewed runtime matrix', () => {
    assert.deepEqual(ROLLOUT_SCENARIOS.map(({ id }) => id), ['smoke', 'rollback']);
    assert.deepEqual(ROLLOUT_SCENARIOS[0].env, {
      EXTENSION_HOST_ENABLED: 'true',
      TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
      RUNAWAY_TYPED_TIMELINE_ENABLED: 'false',
      EXTENSION_RELEASE_CONFIG_REVISION: 'smoke',
    });
    assert.deepEqual(ROLLOUT_SCENARIOS[1].expected.extensions, {
      hostEnabled: false,
      transcriptCaptionFoundryEnabled: false,
      runawayTypedTimelineEnabled: false,
    });
    assert.equal(ROLLOUT_SCENARIOS[1].expected.revision, 'rollback');
  });

  it('rejects root image users and malformed port bindings', () => {
    assert.equal(assertNonRootConfigUser('node'), 'node');
    assert.throws(() => assertNonRootConfigUser('root'), /non-root/);
    assert.throws(() => assertNonRootConfigUser('0'), /non-root/);
    assert.throws(() => assertNonRootConfigUser(''), /non-root/);
    assert.equal(parsePublishedPort({
      NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '49123' }] } },
    }), 49123);
    assert.throws(() => parsePublishedPort({ NetworkSettings: { Ports: {} } }), /ephemeral localhost/);
  });

  it('matches the served rollout document exactly and keeps Docker shell-free', async () => {
    assertRuntimeConfig({
      schemaVersion: 1,
      revision: 'smoke',
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: false,
      },
    }, ROLLOUT_SCENARIOS[0].expected);
    assert.throws(() => assertRuntimeConfig({ revision: 'wrong' }, ROLLOUT_SCENARIOS[0].expected), /runtime config mismatch/);

    const source = await readFile(scriptPath, 'utf8');
    assert.match(source, /spawnSync\(DOCKER_COMMAND, args/);
    assert.doesNotMatch(source, /shell\s*:\s*true/);
    assert.doesNotMatch(source, /execSync|execFileSync/);
    assert.match(source, /'container', 'rm', '--force', containerName/);
  });
});
