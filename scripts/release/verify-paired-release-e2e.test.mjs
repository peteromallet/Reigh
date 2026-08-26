import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  EXPECTED_EXTENSION_COUNT,
  EXPECTED_PERSISTED_CAPTIONS,
  EXPECTED_RUNAWAY_COUNT,
  COMMAND_BUDGETS_MS,
  COMMAND_MAX_BUFFER_BYTES,
  PAIRED_RELEASE_AUDIO_EXPECTED,
  PAIRED_RELEASE_AUDIO_FIXTURE,
  PAIRED_RELEASE_MEDIA_FIXTURE,
  PAIRED_RELEASE_MEDIA_METADATA,
  PAIRED_RELEASE_PHASES,
  PAIRED_RELEASE_TIMELINE_CONFIG,
  RELEASE_BRIDGE_CAPABILITY,
  REPO_ROOT,
  RUNAWAY_RELEASE_FIXTURE_HASHES,
  TIMELINE_SCHEMA_DISTRIBUTION_VERSION,
  buildPairedReleaseRegistry,
  buildBrowserEnvironment,
  buildPinnedNpmArgs,
  buildReadinessIdentity,
  buildServerEnvironment,
  buildViteArgs,
  assessCaptionProbe,
  assessNoCaptionControl,
  captionProbePlan,
  childProcessFailure,
  commandTimeout,
  isExactViteReadiness,
  isRetryablePlaywrightContextSetupFailure,
  normalizeCaptionText,
  pcmS16leStats,
  parseCliArgs,
  requireFullCommitPin,
  requestRawHttp,
  runPlaywright,
  resolvePinnedNpmCli,
  resolvePinnedBrowserExecutable,
  validateTimelineSchemaInstallation,
  validateAstridReleaseBridgeSources,
  validateAstridRenderWorkerSources,
  validateAudioFixture,
  validateImportedAudio,
  validateCaptionExpectations,
  validateMediaFixture,
  validateRenderedStreamContract,
  validateRenderedMediaFrame,
  verifyBridgeMediaContent,
  waitForUrl,
  waitForReighReadiness,
  waitForViteReadiness,
  waitForRenderWorkerReadiness,
  assertRenderWorkerCompleted,
  assertPairedReleaseDiskCapacity,
  validateRenderWorkerBinding,
  validateAstridServeOwnedRenderEvidence,
  runLogged,
  startLoggedProcessUntilReady,
  stopLoggedProcess,
} from './verify-paired-release-e2e.mjs';
import { runBoundedCommand } from './bounded-command.mjs';
import {
  assertPinnedPlatform,
  attestNativeTools,
  sha256File,
} from './native-tool-attestation.mjs';

const TEST_COMMAND_OPTIONS = Object.freeze({
  timeoutMs: 180_000,
  maxBuffer: COMMAND_MAX_BUFFER_BYTES,
  killSignal: 'SIGKILL',
  allowFailure: true,
});

function runTestCommand(command, args, options = {}) {
  return runBoundedCommand(command, args, { ...TEST_COMMAND_OPTIONS, ...options });
}

describe('paired repository release E2E gate', () => {
  it('retries only the exact pre-body Playwright context deadlock', () => {
    const exactFailure = {
      name: 'ReleaseCommandError',
      result: {
        failureType: 'exit',
        stdout: 'Test timeout of 300000ms exceeded while setting up "context".\nError: browser.newContext: Test ended.',
        stderr: '',
      },
    };
    assert.equal(isRetryablePlaywrightContextSetupFailure(exactFailure), true);
    assert.equal(isRetryablePlaywrightContextSetupFailure({
      ...exactFailure,
      result: { ...exactFailure.result, stdout: 'expect(locator).toBeVisible failed' },
    }), false);
    assert.equal(isRetryablePlaywrightContextSetupFailure({
      ...exactFailure,
      result: { ...exactFailure.result, failureType: 'timeout' },
    }), false);
    assert.equal(isRetryablePlaywrightContextSetupFailure(new Error('browser.newContext: Test ended.')), false);
  });

  it('preserves the failed browser setup and retries once in an isolated output directory', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-context-retry-'));
    const reighSnapshot = resolve(root, 'reigh');
    const evidenceRoot = resolve(root, 'evidence');
    const cli = resolve(reighSnapshot, 'node_modules/@playwright/test/cli.js');
    mkdirSync(resolve(cli, '..'), { recursive: true });
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(cli, `
const output = process.env.PLAYWRIGHT_OUTPUT_DIR ?? '';
if (output.endsWith('playwright-first')) {
  console.log('Test timeout of 300000ms exceeded while setting up "context".');
  console.log('Error: browser.newContext: Test ended.');
  process.exit(1);
}
if (!output.endsWith('playwright-first-context-retry-1')) process.exit(2);
`);
    try {
      const result = runPlaywright({
        reighSnapshot,
        evidenceRoot,
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
        audioMediaId: 'audio-id',
      }, 'first', 21000);
      assert.equal(result.contextSetupRetries, 1);
      assert.equal(result.contextSetupRetryEvidence, 'playwright-first-context-retry.json');
      assert.equal(existsSync(resolve(evidenceRoot, 'playwright-first.log')), true);
      assert.equal(existsSync(resolve(evidenceRoot, 'playwright-first.log.timeout.json')), true);
      assert.equal(existsSync(resolve(evidenceRoot, 'playwright-first-context-retry-1.log')), true);
      const retry = JSON.parse(readFileSync(
        resolve(evidenceRoot, 'playwright-first-context-retry.json'),
        'utf8',
      ));
      assert.equal(retry.kind, 'playwright-pre-body-context-retry');
      assert.equal(retry.maxRetries, 1);
      assert.match(retry.initialFailure.logSha256, /^[0-9a-f]{64}$/);
      assert.match(retry.initialFailure.diagnosticsSha256, /^[0-9a-f]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not retry a context failure after any phase-owned state exists', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-context-no-retry-'));
    const reighSnapshot = resolve(root, 'reigh');
    const evidenceRoot = resolve(root, 'evidence');
    const cli = resolve(reighSnapshot, 'node_modules/@playwright/test/cli.js');
    mkdirSync(resolve(cli, '..'), { recursive: true });
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(cli, `
console.log('Test timeout of 300000ms exceeded while setting up "context".');
console.log('Error: browser.newContext: Test ended.');
process.exit(1);
`);
    writeFileSync(resolve(evidenceRoot, 'browser-first-state.json'), '{}\n');
    try {
      assert.throws(() => runPlaywright({
        reighSnapshot,
        evidenceRoot,
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
      }, 'first', 21000), /failed with exit 1/);
      assert.equal(existsSync(resolve(evidenceRoot, 'playwright-first-context-retry.json')), false);
      assert.equal(existsSync(resolve(evidenceRoot, 'playwright-first-context-retry-1.log')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('authors render dimensions and FPS through canonical theme overrides', () => {
    assert.deepEqual(PAIRED_RELEASE_TIMELINE_CONFIG.theme_overrides, {
      visual: {
        canvas: { width: 1280, height: 720, fps: 24 },
      },
    });
    assert.equal('output' in PAIRED_RELEASE_TIMELINE_CONFIG, false);
  });

  it('pins a real sound-bearing audio fixture and fails closed on byte drift', () => {
    const fixturePath = resolve(REPO_ROOT, PAIRED_RELEASE_AUDIO_FIXTURE);
    const fixture = validateAudioFixture({
      fixturePath,
      expectedRoot: REPO_ROOT,
      gitCheckout: REPO_ROOT,
      gitRef: 'HEAD',
      ffprobeExecutable: 'ffprobe',
    });
    assert.equal(fixture.sha256, PAIRED_RELEASE_AUDIO_EXPECTED.sha256);
    assert.equal(fixture.sizeBytes, PAIRED_RELEASE_AUDIO_EXPECTED.sizeBytes);
    assert.deepEqual(fixture.mediaProperties, {
      formatName: 'aac',
      codecName: 'aac',
      profile: 'LC',
      sampleRate: 44_100,
      channels: 2,
      channelLayout: 'stereo',
      durationSeconds: 39.156558,
      sizeBytes: 457_980,
      audioStreamCount: 1,
      streamCount: 1,
    });
    assert.deepEqual(
      PAIRED_RELEASE_TIMELINE_CONFIG.clips.find((clip) => clip.id === 'paired-release-audio'),
      {
        id: 'paired-release-audio',
        track: 'A1',
        at: 0,
        clipType: 'media',
        hold: 8,
        asset: 'motion-output-audio.aac',
      },
    );
    const registry = buildPairedReleaseRegistry({ mediaId: 'image-id', audioMediaId: 'audio-id' });
    assert.deepEqual(registry.assets['motion-output-audio.aac'], {
      file: 'motion-output-audio.aac',
      media_id: 'audio-id',
      type: 'audio/aac',
    });

    const root = mkdtempSync(resolve(tmpdir(), 'paired-audio-fixture-negative-'));
    const alteredPath = resolve(root, 'paired-release-audio.aac');
    try {
      copyFileSync(fixturePath, alteredPath);
      const altered = readFileSync(alteredPath);
      altered[altered.length - 1] ^= 1;
      writeFileSync(alteredPath, altered);
      assert.throws(() => validateAudioFixture({ fixturePath: alteredPath }), /hash\/size mismatch/);
      assert.throws(
        () => validateAudioFixture({ fixturePath, expectedRoot: root }),
        /path mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.match(source, /'media', 'import', audioPath/);
    assert.match(source, /'motion-output-audio\.aac': Object\.freeze\(\{[\s\S]*?media_id: audioMediaId/);
    assert.match(source, /mediaId: context\.audioMediaId,[\s\S]*?fixture: context\.audioFixture/);
  });

  it('fails closed on wrong probed audio media properties and extra streams', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-audio-probe-negative-'));
    const fakeFfprobe = resolve(root, 'ffprobe');
    const fixturePath = resolve(REPO_ROOT, PAIRED_RELEASE_AUDIO_FIXTURE);
    const base = {
      streams: [{
        codec_name: 'aac',
        profile: 'LC',
        codec_type: 'audio',
        sample_rate: '44100',
        channels: 2,
        channel_layout: 'stereo',
      }],
      format: { format_name: 'aac', duration: '39.156558', size: '457980' },
    };
    const writeProbe = (payload) => {
      writeFileSync(fakeFfprobe, `#!/bin/sh\nprintf '%s' '${JSON.stringify(payload)}'\n`);
      chmodSync(fakeFfprobe, 0o700);
    };
    try {
      writeProbe(base);
      assert.doesNotThrow(() => validateAudioFixture({ fixturePath, ffprobeExecutable: fakeFfprobe }));
      const mutations = [
        { ...base, streams: [{ ...base.streams[0], codec_name: 'mp3' }] },
        { ...base, streams: [{ ...base.streams[0], profile: 'HE-AAC' }] },
        { ...base, streams: [{ ...base.streams[0], sample_rate: '48000' }] },
        { ...base, streams: [{ ...base.streams[0], channels: 1, channel_layout: 'mono' }] },
        { ...base, streams: [] },
        { ...base, streams: [...base.streams, { codec_type: 'video', codec_name: 'h264' }] },
        { ...base, format: { ...base.format, duration: '1.0' } },
      ];
      for (const payload of mutations) {
        writeProbe(payload);
        assert.throws(
          () => validateAudioFixture({ fixturePath, ffprobeExecutable: fakeFfprobe }),
          /media properties mismatch/,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates Astrid audio import metadata and registry linkage', () => {
    const payload = {
      ok: true,
      data: {
        id: 'audio-media-id',
        media_kind: 'audio',
        content_hash: PAIRED_RELEASE_AUDIO_EXPECTED.sha256,
        byte_size: PAIRED_RELEASE_AUDIO_EXPECTED.sizeBytes,
        mime_type: PAIRED_RELEASE_AUDIO_EXPECTED.bridgeMimeType,
        metadata: { rel_path: 'motion-output-audio.aac' },
        locations: [{ realm: 'managed_local', media_id: 'audio-media-id' }],
      },
    };
    assert.equal(validateImportedAudio(payload).mediaId, 'audio-media-id');
    for (const [field, value] of [
      ['media_kind', 'video'],
      ['content_hash', '0'.repeat(64)],
      ['byte_size', 1],
      ['mime_type', 'audio/aac'],
    ]) {
      assert.throws(
        () => validateImportedAudio({ ...payload, data: { ...payload.data, [field]: value } }),
        /audio import contract mismatch/,
      );
    }
    assert.throws(
      () => validateImportedAudio({ ...payload, data: { ...payload.data, id: null } }),
      /audio import contract mismatch/,
    );
    assert.throws(
      () => buildPairedReleaseRegistry({ mediaId: 'image-id', audioMediaId: '' }),
      /requires exact image and audio media IDs/,
    );
  });

  it('requires decoded render audio to contain measurable signed PCM energy', () => {
    const audible = Buffer.alloc(8);
    audible.writeInt16LE(8_000, 0);
    audible.writeInt16LE(-8_000, 2);
    audible.writeInt16LE(4_000, 4);
    audible.writeInt16LE(-4_000, 6);
    const stats = pcmS16leStats(audible);
    assert.equal(stats.sampleCount, 4);
    assert.ok(stats.rms > 0.1);
    assert.ok(stats.peak > 0.2);
    assert.equal(stats.nonZeroRatio, 1);
    assert.throws(() => pcmS16leStats(Buffer.alloc(0)), /non-empty signed 16-bit PCM/);
    assert.throws(() => pcmS16leStats(Buffer.alloc(3)), /non-empty signed 16-bit PCM/);

    const probe = {
      format: { duration: '8' },
      streams: [
        {
          codec_type: 'video', codec_name: 'h264', width: 1280, height: 720,
          avg_frame_rate: '24/1', nb_frames: '192', duration: '8',
        },
        {
          codec_type: 'audio', codec_name: 'aac', channels: 2,
          sample_rate: '44100', duration: '8',
        },
      ],
    };
    assert.doesNotThrow(() => validateRenderedStreamContract(probe, { expectedFps: 24, expectedDuration: 8 }));
    assert.throws(
      () => validateRenderedStreamContract({ ...probe, streams: [...probe.streams, probe.streams[1]] }, { expectedFps: 24, expectedDuration: 8 }),
      /render audio stream contract mismatch/,
    );
    assert.throws(
      () => validateRenderedStreamContract({ ...probe, format: { duration: '9' } }, { expectedFps: 24, expectedDuration: 8 }),
      /render stream contract mismatch/,
    );
    assert.throws(
      () => validateRenderedStreamContract({
        ...probe,
        streams: [probe.streams[0], { ...probe.streams[1], duration: '7.5' }],
      }, { expectedFps: 24, expectedDuration: 8 }),
      /render audio stream contract mismatch/,
    );

    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.match(source, /renderedAudio\.nonZeroRatio < 0\.1/);
    assert.match(source, /sampleCountRatio < 0\.99 \|\| sampleCountRatio > 1\.01/);
    assert.match(source, /rmsRatio < 0\.5 \|\| rmsRatio > 2/);
  });

  it('fails closed for altered fixture bytes and wrong committed probes', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-media-fixture-negative-'));
    const fixture = resolve(root, 'paired-release-test-card.png');
    const metadata = resolve(root, 'paired-release-test-card.json');
    copyFileSync(resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE), fixture);
    copyFileSync(resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_METADATA), metadata);
    try {
      const altered = readFileSync(fixture);
      altered[altered.length - 1] ^= 1;
      writeFileSync(fixture, altered);
      assert.throws(() => validateMediaFixture({ fixturePath: fixture, metadataPath: metadata }), /metadata\/hash mismatch/);

      copyFileSync(resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE), fixture);
      const changedMetadata = JSON.parse(readFileSync(metadata, 'utf8'));
      changedMetadata.probes[0].expectedRgba = [0, 0, 0, 255];
      writeFileSync(metadata, `${JSON.stringify(changedMetadata)}\n`);
      assert.throws(() => validateMediaFixture({ fixturePath: fixture, metadataPath: metadata }), /probe .* mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects omitted or black rendered media and accepts the exact transformed control geometry', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-media-render-negative-'));
    const black = resolve(root, 'black.png');
    try {
      const fixture = validateMediaFixture({
        fixturePath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE),
        metadataPath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_METADATA),
      });
      assert.doesNotThrow(() => validateRenderedMediaFrame(fixture.path, fixture));
      const blackResult = runTestCommand('magick', [fixture.path, '-fill', 'black', '-colorize', '100%', '-define', 'png:color-type=6', black]);
      assert.equal(blackResult.status, 0, blackResult.stderr);
      assert.throws(() => validateRenderedMediaFrame(black, fixture), /does not contain the seeded test card/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a bridge media byte/header mismatch', async () => {
    const fixture = validateMediaFixture({
      fixturePath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE),
      metadataPath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_METADATA),
    });
    const server = createServer((_request, response) => {
      const body = Buffer.from('omitted-media');
      response.writeHead(200, {
        'Content-Type': fixture.mimeType,
        'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache',
        'X-Astrid-Bridge-Version': 'v1',
        ETag: '"negative"',
        'Last-Modified': new Date(0).toUTCString(),
      });
      response.end(body);
    });
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    try {
      const address = server.address();
      assert.equal(typeof address, 'object');
      await assert.rejects(
        verifyBridgeMediaContent({
          baseUrl: `http://127.0.0.1:${address.port}`,
          projectSlug: 'paired-release-demo',
          mediaId: 'media-test',
          fixture,
          token: 'test-token',
        }),
        /content-length mismatch|bytes do not exactly match/,
      );
    } finally {
      await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
    }
  });

  it('rejects a bridge response that rewrites Astrid AAC MIME semantics', async () => {
    const fixture = validateAudioFixture({
      fixturePath: resolve(REPO_ROOT, PAIRED_RELEASE_AUDIO_FIXTURE),
    });
    const server = createServer((_request, response) => {
      const body = readFileSync(fixture.path);
      response.writeHead(200, {
        'Content-Type': 'audio/aac',
        'Content-Length': String(body.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache',
        'X-Astrid-Bridge-Version': 'v1',
        ETag: '"audio-negative"',
        'Last-Modified': new Date(0).toUTCString(),
      });
      response.end(body);
    });
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    try {
      const address = server.address();
      assert.equal(typeof address, 'object');
      await assert.rejects(
        verifyBridgeMediaContent({
          baseUrl: `http://127.0.0.1:${address.port}`,
          projectSlug: 'paired-release-demo',
          mediaId: 'audio-media-test',
          fixture,
          token: 'test-token',
        }),
        /content-type mismatch/,
      );
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  });

  it('uses frame-vs-control difference metrics so dark captions are not rejected by absolute brightness', () => {
    const result = assessCaptionProbe({
      expectedText: 'Fixture segment one',
      recognizedText: 'Fixture segment one',
      frameWidth: 1280,
      frameHeight: 720,
      expectedRegion: { x: 128, y: 418, width: 1024, height: 101 },
      recognizedBounds: { left: 160, top: 440, width: 240, height: 36 },
      occupancy: 0.02,
      controlOccupancy: 0,
      contrast: 0.05,
      frameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    });
    assert.equal(result.pass, true);
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.match(source, /imageDifferenceMetric\(framePath, controlPath/);
    assert.doesNotMatch(source, /imageMetric\(/);
  });

  it('requires exact caption text and visible region semantics, not whole-frame difference', () => {
    const base = {
      expectedText: 'Fixture segment one',
      recognizedText: 'wrong caption',
      frameWidth: 1280,
      frameHeight: 720,
      expectedRegion: { x: 128, y: 418, width: 1024, height: 101 },
      recognizedBounds: { left: 160, top: 440, width: 240, height: 36 },
      occupancy: 0.08,
      controlOccupancy: 0,
      contrast: 0.25,
      frameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    };
    const result = assessCaptionProbe(base);
    assert.equal(result.pass, false);
    assert.match(result.reasons.join('; '), /OCR text does not exactly match/);
    assert.equal(normalizeCaptionText('Fixture segment one'), 'fixturesegmentone');
  });

  it('rejects blank, clipped, and wrong-region caption frames', () => {
    const shared = {
      expectedText: 'Fixture segment one',
      recognizedText: 'Fixture segment one',
      frameWidth: 1280,
      frameHeight: 720,
      expectedRegion: { x: 128, y: 418, width: 1024, height: 101 },
      frameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    };
    const blank = assessCaptionProbe({
      ...shared,
      recognizedBounds: null,
      occupancy: 0,
      controlOccupancy: 0,
      contrast: 0,
    });
    assert.equal(blank.pass, false);
    assert.match(blank.reasons.join('; '), /missing|foreground|legible/);

    const clipped = assessCaptionProbe({
      ...shared,
      recognizedBounds: { left: 1270, top: 440, width: 80, height: 36 },
      occupancy: 0.08,
      controlOccupancy: 0,
      contrast: 0.25,
    });
    assert.equal(clipped.pass, false);
    assert.match(clipped.reasons.join('; '), /clipped/);

    const wrongRegion = assessCaptionProbe({
      ...shared,
      recognizedBounds: { left: 200, top: 100, width: 240, height: 36 },
      occupancy: 0.08,
      controlOccupancy: 0,
      contrast: 0.25,
    });
    assert.equal(wrongRegion.pass, false);
    assert.match(wrongRegion.reasons.join('; '), /outside/);
  });

  it('proves the no-caption control against the independent clean card and rejects stray OCR or foreground', () => {
    const region = { x: 128, y: 418, width: 1024, height: 101 };
    const clean = assessNoCaptionControl({
      recognizedText: '',
      recognizedBounds: null,
      recognizedWords: [],
      frameWidth: 1280,
      frameHeight: 720,
      codeOwnedRegions: [region, { ...region, y: 200 }],
      foregroundByRegion: [0.0004, 0.0004],
      contrastByRegion: [0.001, 0.001],
      expectedCleanFrameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    });
    assert.equal(clean.pass, true);

    const strayOcr = assessNoCaptionControl({
      recognizedText: 'stray',
      recognizedBounds: { left: 200, top: 440, width: 40, height: 18 },
      recognizedWords: [{ text: 'stray', left: 200, top: 440, width: 40, height: 18, confidence: 92 }],
      frameWidth: 1280,
      frameHeight: 720,
      codeOwnedRegions: [region],
      foregroundByRegion: [0.0004],
      contrastByRegion: [0.001],
      expectedCleanFrameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    });
    assert.equal(strayOcr.pass, false);
    assert.match(strayOcr.reasons.join('; '), /OCR recognized text/);

    const sparseForeground = assessNoCaptionControl({
      recognizedText: '',
      recognizedBounds: null,
      frameWidth: 1280,
      frameHeight: 720,
      codeOwnedRegions: [region],
      foregroundByRegion: [0.01],
      contrastByRegion: [0.08],
      expectedCleanFrameSha256: 'a'.repeat(64),
      controlFrameSha256: 'b'.repeat(64),
    });
    assert.equal(sparseForeground.pass, false);
    assert.match(sparseForeground.reasons.join('; '), /caption-like foreground|caption-like contrast/);

    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.match(source, /imageDifferenceMetric\(\s*controlPath,\s*context\.mediaFixture\.path/);
    assert.match(source, /render-caption-control-ocr\.tsv/);
    assert.match(source, /assessNoCaptionControl/);
    assert.doesNotMatch(source, /controlOccupancy:\s*imageDifferenceMetric\(controlPath,\s*controlPath/);
  });

  it('binds the exact persisted caption set and probes every ID at first, midpoint, and last frame', () => {
    const captions = validateCaptionExpectations(EXPECTED_PERSISTED_CAPTIONS.map((caption) => ({
      ...caption,
      region: { ...caption.region },
    })));
    assert.deepEqual(captions.map((caption) => caption.id), EXPECTED_PERSISTED_CAPTIONS.map((caption) => caption.id));
    const probes = captionProbePlan(captions, 24);
    assert.deepEqual(probes.map((probe) => [probe.captionId, probe.kind]), [
      [EXPECTED_PERSISTED_CAPTIONS[0].id, 'first'],
      [EXPECTED_PERSISTED_CAPTIONS[0].id, 'midpoint'],
      [EXPECTED_PERSISTED_CAPTIONS[0].id, 'last'],
      [EXPECTED_PERSISTED_CAPTIONS[1].id, 'first'],
      [EXPECTED_PERSISTED_CAPTIONS[1].id, 'midpoint'],
      [EXPECTED_PERSISTED_CAPTIONS[1].id, 'last'],
    ]);
    assert.equal(probes[0].frame, 48);
    assert.equal(probes[2].frame, 95);
    assert.equal(probes[3].frame, 120);
    assert.equal(probes[5].frame, 191);
  });

  it('fails duplicate, overlapping, wrong-ID, wrong-text, and wrong-interval persistence', () => {
    const copy = () => EXPECTED_PERSISTED_CAPTIONS.map((caption) => ({ ...caption, region: { ...caption.region } }));
    const duplicate = copy();
    duplicate[1].id = duplicate[0].id;
    assert.throws(() => validateCaptionExpectations(duplicate), /duplicate/);

    const overlap = copy();
    overlap[1].at = 3;
    const overlapExpected = copy();
    overlapExpected[1].at = 3;
    assert.throws(() => validateCaptionExpectations(overlap, overlapExpected), /intervals overlap/);
    assert.throws(() => validateCaptionExpectations(copy().map((caption, index) => (
      index === 1 ? { ...caption, id: 'transcript-caption-unexpected' } : caption
    ))), /unexpected persisted caption ID/);
    assert.throws(() => validateCaptionExpectations(copy().map((caption, index) => (
      index === 1 ? { ...caption, text: 'Wrong text' } : caption
    ))), /text mismatch/);
    assert.throws(() => validateCaptionExpectations(copy().map((caption, index) => (
      index === 1 ? { ...caption, duration: 2 } : caption
    ))), /interval mismatch/);
  });

  it('fails readiness immediately for exit, signal, and spawn-error children', async () => {
    const cases = [
      [waitForUrl('http://127.0.0.1:1/health', { process: { exitCode: null, signalCode: 'SIGTERM' }, timeoutMs: 60_000 }), /SIGTERM/],
      [waitForViteReadiness('http://127.0.0.1:1', { expectedIdentity: 'paired-test', process: { exitCode: null, signalCode: 'SIGKILL' }, timeoutMs: 120_000 }), /SIGKILL/],
      [waitForUrl('http://127.0.0.1:1/health', { process: { exitCode: null, signalCode: 'SIGABRT' }, timeoutMs: 60_000 }), /SIGABRT/],
      [waitForUrl('http://127.0.0.1:1/health', { process: { exitCode: null, signalCode: null, pairedSpawnError: new Error('ENOENT') }, timeoutMs: 60_000 }), /failed to spawn.*ENOENT/],
    ];
    const started = Date.now();
    for (const [promise, expected] of cases) await assert.rejects(promise, expected);
    assert.ok(Date.now() - started < 1_000, 'terminal child states must not wait for readiness timeout');
    assert.match(childProcessFailure({ exitCode: 7, signalCode: null }), /exit 7/);
  });

  it('uses exact runtime identity for preview and root HTML for development readiness', async () => {
    const expectedIdentity = 'paired-test-readiness';
    const requests = [];
    const server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url?.startsWith('/runtime-config/v1/extensions.json')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          schemaVersion: 1,
          revision: expectedIdentity,
          extensions: {
            hostEnabled: true,
            transcriptCaptionFoundryEnabled: true,
            runawayTypedTimelineEnabled: true,
          },
        }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Vite development</title>');
    });
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolvePromise);
    });
    try {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const child = { exitCode: null, signalCode: null };
      await waitForReighReadiness(baseUrl, {
        mode: 'preview',
        expectedIdentity,
        process: child,
        timeoutMs: 1_000,
      });
      await waitForReighReadiness(baseUrl, {
        mode: 'development',
        expectedIdentity: 'must-not-be-probed-in-development',
        process: child,
        timeoutMs: 1_000,
      });
      assert.equal(requests.length, 2);
      assert.match(requests[0], /^\/runtime-config\/v1\/extensions\.json\?readiness=/);
      assert.equal(requests[1], '/');
      await assert.rejects(
        waitForReighReadiness(baseUrl, { mode: 'unsupported', process: child, timeoutMs: 1_000 }),
        /unsupported Reigh readiness mode/,
      );
    } finally {
      await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
    }
  });

  it('pins the dedicated render worker contract to the Astrid archive', () => {
    assert.deepEqual(validateAstridRenderWorkerSources({
      adapterSource: 'class RenderExportTaskAdapter: ... execute_render_export_task',
      capabilitySource: 'FAMILY_RENDER_EXPORT = "rendering.render"',
      taskBridgeSource: 'timeline_snapshot = {}',
      remotionRuntimeSource: 'remotion_runtime_status REMOTION_CLI_RELATIVE_PATH ASTRID_REMOTION_PROJECT_DIR ASTRID_NODE_EXECUTABLE ASTRID_TIMELINE_SCHEMA_PYTHONPATH',
      envSource: 'ASTRID_REMOTION_PROJECT_DIR ASTRID_NODE_EXECUTABLE ASTRID_TIMELINE_SCHEMA_PYTHONPATH',
      remotionPackageSource: '"name": "tools-remotion"',
      remotionLockSource: '"lockfileVersion": 3',
    }), { capability: 'rendering.render' });
    assert.throws(() => validateAstridRenderWorkerSources({
      adapterSource: '',
      capabilitySource: '',
      taskBridgeSource: '',
    }), /paired render worker contract/);
  });

  it('resolves npm to its local CLI and invokes it through the attested Node binary', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-npm-cli-'));
    const bin = resolve(root, 'bin');
    const lib = resolve(root, 'lib');
    mkdirSync(bin, { recursive: true });
    mkdirSync(lib, { recursive: true });
    const shim = resolve(bin, 'npm');
    const cli = resolve(lib, 'cli.js');
    const marker = resolve(root, 'npm-side-effect.txt');
    writeFileSync(shim, "#!/usr/bin/env node\nrequire('../lib/cli.js')(process)\n", { mode: 0o700 });
    writeFileSync(cli, `module.exports = (runtime) => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, runtime.argv.slice(2).join(' ')); if (runtime.argv[2] === '--version') runtime.stdout.write('9.9.9\\n'); };\n`);
    try {
      const resolvedCli = resolvePinnedNpmCli(shim);
      assert.equal(resolvedCli, realpathSync(shim));
      assert.deepEqual(buildPinnedNpmArgs({ nodeExecutable: process.execPath, npmCliJs: resolvedCli }, ['ci', '--no-fund']), [
        process.execPath, resolvedCli, 'ci', '--no-fund',
      ]);
      const executed = runTestCommand(process.execPath, [resolvedCli, '--version'], { cwd: root });
      assert.equal(executed.status, 0);
      assert.equal(executed.stdout, '9.9.9\n');
      assert.equal(readFileSync(marker, 'utf8'), '--version');
      const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
      const install = source.slice(source.indexOf('function installAstridRemotionRuntime'), source.indexOf('function resolvePinnedBrowser'));
      assert.match(install, /runPinnedNpm\(context, \['ci'/);
      assert.doesNotMatch(install, /\bnpx\b/);
      assert.match(install, /node:[\s\S]*executableSha256/);
      assert.match(source, /ASTRID_NODE_EXECUTABLE/);
      assert.match(source, /REMOTION_CLI_RELATIVE_PATH/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires the bounded worker handshake and proves scrubbed worker ownership', async () => {
    const stdout = new PassThrough();
    const child = new PassThrough({ readableObjectMode: false });
    child.stdout = stdout;
    child.exitCode = null;
    child.signalCode = null;
    const ready = waitForRenderWorkerReadiness(child, { timeoutMs: 1_000 });
    stdout.write('{"event":"worker-ready","capability":"rendering.render"}\n');
    await ready;
    const workerSource = readFileSync(resolve(REPO_ROOT, 'scripts/release/paired-render-worker.py'), 'utf8');
    assert.match(workerSource, /X-Astrid-Bridge-Version/);
    assert.match(workerSource, /Idempotency-Key/);
    assert.match(workerSource, /heartbeat/);
    assert.match(workerSource, /os\.killpg/);
    assert.match(workerSource, /_stream_mp4_digest/);
    assert.match(workerSource, /MappingProxyType/);
    assert.match(workerSource, /heartbeat\.join\(timeout=HEARTBEAT_JOIN_TIMEOUT_SECONDS\)/);
    assert.match(workerSource, /if heartbeat\.is_alive\(\)/);
    assert.match(workerSource, /SETTLEMENT_RESERVE_SECONDS/);
    assert.match(workerSource, /for replay in range\(2\)/);
    assert.match(workerSource, /content_hash"\) != output_sha256/);
    assert.match(workerSource, /parsed\.scheme != "http"/);
    assert.match(workerSource, /parsed\.hostname != "127\.0\.0\.1"/);
    assert.doesNotMatch(workerSource, /output_path\.read_bytes\(\)/);
    assert.doesNotMatch(workerSource, /ASTRID_BRIDGE_TOKEN.*argv/);
  });

  it('validates completed worker evidence and rejects incomplete settlement', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-render-worker-evidence-'));
    const evidencePath = resolve(root, 'worker.json');
    const child = new PassThrough();
    child.exitCode = 0;
    child.signalCode = null;
    writeFileSync(evidencePath, `${JSON.stringify({
      status: 'completed',
      schemaVersion: 1,
      capability: 'rendering.render',
      executor_id: 'worker-1',
      task_id: 'task-1',
      attempt_id: 'attempt-1',
      attempt_no: 1,
      project_slug: 'demo',
      bytes: 123,
      sha256: 'a'.repeat(64),
      media: { media_id: 'media-1', mime_type: 'video/mp4', content_hash: 'a'.repeat(64) },
    })}\n`);
    try {
      const evidence = await assertRenderWorkerCompleted({ child, renderWorkerEvidencePath: evidencePath });
      assert.equal(evidence.media.media_id, 'media-1');
      writeFileSync(evidencePath, `${JSON.stringify({
        schemaVersion: 1,
        status: 'completed',
        capability: 'rendering.render',
        executor_id: 'worker-1',
        task_id: 'task-1',
        attempt_id: 'attempt-1',
        attempt_no: 1,
        project_slug: 'demo',
        bytes: 123,
        sha256: 'a'.repeat(64),
        media: { media_id: 'media-1', mime_type: 'video/mp4', content_hash: `sha256:${'a'.repeat(64)}` },
      })}\n`);
      await assert.rejects(
        assertRenderWorkerCompleted({ child, renderWorkerEvidencePath: evidencePath }),
        /did not prove completion/,
      );
      writeFileSync(evidencePath, '{"status":"failed"}\n');
      await assert.rejects(
        assertRenderWorkerCompleted({ child, renderWorkerEvidencePath: evidencePath }),
        /did not prove completion/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('binds worker evidence to the browser MP4 by bytes and bare Astrid content hash', () => {
    const workerEvidence = {
      status: 'completed',
      bytes: 123,
      sha256: 'b'.repeat(64),
      task_id: 'task-2',
      attempt_id: 'attempt-2',
      media: { media_id: 'media-2' },
    };
    assert.deepEqual(
      validateRenderWorkerBinding({
        browserReceipt: { bytes: 123, sha256: 'b'.repeat(64), mediaId: 'media-2' },
        workerEvidence,
      }),
      {
        taskId: 'task-2',
        attemptId: 'attempt-2',
        workerMediaId: 'media-2',
        browserMediaId: 'media-2',
        bytes: 123,
        sha256: 'b'.repeat(64),
        binding: 'sha256+bytes+media_id',
        mediaIdSource: 'browser-download-url',
      },
    );
    assert.throws(
      () => validateRenderWorkerBinding({
        browserReceipt: { bytes: 124, sha256: 'b'.repeat(64), mediaId: 'media-2' },
        workerEvidence,
      }),
      /bytes do not match/,
    );
    assert.throws(
      () => validateRenderWorkerBinding({
        browserReceipt: { bytes: 123, sha256: 'b'.repeat(64), mediaId: 'other-media' },
        workerEvidence,
      }),
      /media id does not match/,
    );
  });

  it('makes Astrid serve the sole authoritative render owner and binds product evidence strictly', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    const gate = source.slice(source.indexOf('async function executeGate'), source.indexOf('async function executeGate') + 35_000);
    assert.doesNotMatch(gate, /startRenderWorker\(/, 'the authoritative paired run must not launch a verifier worker');
    assert.doesNotMatch(gate, /assertRenderWorkerCompleted\(/, 'the authoritative paired run must not count verifier evidence');
    assert.match(gate, /captureAstridServeOwnedRenderEvidence/);
    const digest = 'c'.repeat(64);
    const taskDetail = {
      task: {
        task_id: 'task-serve-1', capability: 'rendering.render', status: 'succeeded',
        winning_attempt_id: 'attempt-serve-1', spec: { family: 'render_export', project_slug: 'paired-release-demo' },
        attempts: [{ attempt_id: 'attempt-serve-1', attempt_no: 2, status: 'succeeded' }],
        outputs: [{ ordinal: 0, role: 'result', media_id: 'media-serve-1', is_primary: 1, params_json: JSON.stringify({ content_hash: digest, byte_size: 123 }) }],
      },
    };
    const evidence = validateAstridServeOwnedRenderEvidence({
      browserReceipt: { authority: 'astrid-serve-owned', taskId: 'task-serve-1', mediaId: 'media-serve-1', bytes: 123, sha256: digest },
      taskDetail,
      mediaContent: { status: 200, mimeType: 'video/mp4', bytes: 123, sha256: digest },
    });
    assert.equal(evidence.authority, 'astrid-serve-owned');
    assert.equal(evidence.attemptId, 'attempt-serve-1');
    assert.equal(evidence.primaryMedia.mediaId, 'media-serve-1');
    assert.throws(() => validateAstridServeOwnedRenderEvidence({
      browserReceipt: { taskId: 'task-serve-1', mediaId: 'media-serve-1', bytes: 123, sha256: `sha256:${digest}` },
      taskDetail: { ...taskDetail, task: { ...taskDetail.task, outputs: [{ ...taskDetail.task.outputs[0], params_json: JSON.stringify({ content_hash: `sha256:${digest}`, byte_size: 123 }) }] } },
      mediaContent: { status: 200, mimeType: 'video/mp4', bytes: 123, sha256: digest },
    }), /bare sha256/);
  });

  it('reaps a real detached process group when readiness rejects before handle return', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-readiness-reap-'));
    const marker = resolve(root, 'orphan-marker');
    const childScript = resolve(root, 'detached-parent.mjs');
    writeFileSync(childScript, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "const marker = process.argv[2];",
      "const grandchild = spawn(process.execPath, ['-e', `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'orphan'), 900)`], { detached: true, stdio: 'ignore' });",
      'grandchild.unref();',
      'setTimeout(() => {}, 1_500);',
    ].join('\n'), { mode: 0o700 });
    const logPath = resolve(root, 'server.log');
    try {
      await assert.rejects(
        startLoggedProcessUntilReady(
          process.execPath,
          [childScript, marker],
          { cwd: root, env: process.env, logPath },
          async () => { throw new Error('readiness probe rejected'); },
        ),
        /readiness probe rejected/,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_100));
      assert.equal(existsSync(marker), false, 'detached descendant survived readiness cleanup');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reaps a scoped detached descendant when the server leader exits immediately', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-readiness-exited-leader-'));
    const marker = resolve(root, 'orphan-marker');
    const childScript = resolve(root, 'detached-parent.mjs');
    writeFileSync(childScript, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'orphan'), 700)`,
      )}], { detached: true, stdio: 'ignore' });`,
      'grandchild.unref(); process.exit(0);',
    ].join('\n'), { mode: 0o700 });
    const logPath = resolve(root, 'server.log');
    try {
      await assert.rejects(
        startLoggedProcessUntilReady(
          process.execPath,
          [childScript],
          { cwd: root, env: process.env, logPath },
          async () => { throw new Error('readiness probe rejected'); },
        ),
        /readiness probe rejected/,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 850));
      assert.equal(existsSync(marker), false, 'scoped descendant survived after leader exit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rescans paired server scope when a descendant spawns during TERM', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-readiness-term-spawn-'));
    const marker = resolve(root, 'term-spawn-marker');
    const childScript = resolve(root, 'term-parent.mjs');
    writeFileSync(childScript, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      `process.on('SIGTERM', () => { const child = spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'orphan'), 700)`,
      )}], { detached: true, stdio: 'ignore' }); child.unref(); process.exit(0); });`,
      "process.stdout.write('ready'); setInterval(() => {}, 1_000);",
    ].join('\n'), { mode: 0o700 });
    const logPath = resolve(root, 'server.log');
    try {
      await assert.rejects(
        startLoggedProcessUntilReady(
          process.execPath,
          [childScript],
          { cwd: root, env: process.env, logPath },
          async (child) => {
            await new Promise((resolvePromise) => child.stdout.once('data', resolvePromise));
            throw new Error('readiness probe rejected after handshake');
          },
        ),
        /readiness probe rejected after handshake/,
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 850));
      assert.equal(existsSync(marker), false, 'TERM-spawned scoped descendant survived cleanup');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses unique scope keys, avoids negative PGID signaling, and never leaks scope tokens in cleanup text', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.match(source, /SERVER_SCOPE_PREFIX[^\n]*randomBytes/);
    assert.doesNotMatch(source, /process\.kill\(-/);
    assert.doesNotMatch(source, /server process scope \$\{handle\.scopeToken\}/);
    assert.match(source, /sameProcessIdentity/);
    assert.match(source, /SERVER_SCOPE_QUIESCENCE_SCANS/);
  });

  it('keeps server supervisors fail-closed without continuous process-table polling', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    const supervisor = source.slice(
      source.indexOf('async function runServerSupervisor'),
      source.indexOf('async function startLoggedProcess'),
    );
    assert.match(supervisor, /await scanScopedPids\(config\.scopeKey, config\.scopeToken\)/);
    assert.match(supervisor, /supervisor-error/);
    assert.match(supervisor, /setInterval\(\(\) => \{\s*if \(process\.ppid !== config\.parentPid\)/);
    assert.doesNotMatch(
      supervisor,
      /setInterval\([\s\S]{0,300}scanScopedPids/,
      'a live supervisor must not create a full process-table scan storm',
    );
  });

  it('maintains independent simultaneous scopes and keeps tokens out of supervisor argv/env', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-simultaneous-scopes-'));
    const target = resolve(root, 'target.mjs');
    const handles = [];
    writeFileSync(target, 'setInterval(() => {}, 10_000);\n', { mode: 0o700 });
    try {
      handles.push(...await Promise.all([
        startLoggedProcessUntilReady(process.execPath, [target], { cwd: root, env: process.env, logPath: resolve(root, 'one.log') }, async () => {}),
        startLoggedProcessUntilReady(process.execPath, [target], { cwd: root, env: process.env, logPath: resolve(root, 'two.log') }, async () => {}),
      ]));
      assert.notEqual(handles[0].scopeKey, handles[1].scopeKey);
      assert.notEqual(handles[0].scopeToken, handles[1].scopeToken);
      for (const handle of handles) {
        const psPath = platform() === 'darwin' ? '/bin/ps' : '/usr/bin/ps';
        const listing = runTestCommand(psPath, ['eww', '-p', String(handle.supervisor.pid), '-o', 'command=']);
        assert.equal(listing.status, 0, listing.stderr);
        assert.doesNotMatch(listing.stdout, new RegExp(handle.scopeToken));
      }
    } finally {
      await Promise.allSettled(handles.map(stopLoggedProcess));
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleans a server scope when the supervising verifier is killed', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-supervisor-loss-'));
    const marker = resolve(root, 'supervisor-loss-marker');
    const target = resolve(root, 'target.mjs');
    const driver = resolve(root, 'driver.mjs');
    const logPath = resolve(root, 'server.log');
    writeFileSync(target, [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(
        `setTimeout(() => writeFileSync(${JSON.stringify(marker)}, 'orphan'), 1_200)`,
      )}], { detached: true, stdio: 'ignore' });`,
      'grandchild.unref(); process.exit(0);',
    ].join('\n'), { mode: 0o700 });
    writeFileSync(driver, [
      `import { startLoggedProcessUntilReady } from ${JSON.stringify(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'))};`,
      `const handle = await startLoggedProcessUntilReady(process.execPath, [${JSON.stringify(target)}], { cwd: ${JSON.stringify(root)}, env: process.env, logPath: ${JSON.stringify(logPath)} }, async () => {});`,
      `process.stdout.write(JSON.stringify({ pid: handle.child.pid }) + '\\n');`,
      'setInterval(() => {}, 10_000);',
    ].join('\n'), { mode: 0o700 });
    const child = spawn(process.execPath, [driver], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await new Promise((resolvePromise, reject) => {
        child.stdout.once('data', resolvePromise);
        child.once('error', reject);
      });
      child.kill('SIGKILL');
      await new Promise((resolvePromise) => child.once('close', resolvePromise));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_700));
      assert.equal(existsSync(marker), false, 'detached server survived supervisor loss');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('attests every native tool, exact build identity, traineddata bytes, and platform', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-native-attestation-'));
    const bin = resolve(root, 'bin');
    const tessdata = resolve(root, 'tessdata');
    mkdirSync(bin, { recursive: true });
    mkdirSync(tessdata, { recursive: true });
    const build = {
      ffmpeg: 'ffmpeg version 7.1.1\nbuilt fake\nconfiguration: fake',
      ffprobe: 'ffprobe version 7.1.1\nbuilt fake\nconfiguration: fake',
      tesseract: 'tesseract 5.5.1\n leptonica-1.85.0\n  fake libs',
      imageMagick: 'Version: ImageMagick 7.1.2-18\nCopyright: fake\nFeatures: fake',
    };
    const executableNames = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', tesseract: 'tesseract', imageMagick: 'magick' };
    const paths = {};
    for (const [name, executableName] of Object.entries(executableNames)) {
      const path = resolve(bin, executableName);
      writeFileSync(path, `#!/bin/sh\nexit 0\n`, { mode: 0o700 });
      chmodSync(path, 0o700);
      paths[name] = path;
    }
    const engDataPath = resolve(tessdata, 'eng.traineddata');
    writeFileSync(engDataPath, 'deterministic-traineddata');
    const manifest = {
      verification: {
        platform: { os: platform(), arch: arch(), release: release() },
        nativeTools: Object.fromEntries(Object.entries(executableNames).map(([name, executable]) => [name, {
            executable,
            version: name === 'imageMagick' ? '7.1.2-18' : name === 'tesseract' ? '5.5.1' : '7.1.1',
            executableSha256: `sha256:${sha256File(paths[name])}`,
            buildIdentity: build[name],
            ...(name === 'tesseract' ? { engDataSha256: `sha256:${sha256File(engDataPath)}` } : {}),
          }])),
      },
    };
    const run = (_command, args, label) => {
      if (label.startsWith('tesseract language')) {
        return { status: 0, stdout: `List of available languages in "${tessdata}" (1):\neng\n`, stderr: '' };
      }
      const name = label.split(' ')[0];
      return { status: 0, stdout: build[name], stderr: '' };
    };
    try {
      const attestation = attestNativeTools({ manifest, pathValue: bin, run });
      assert.deepEqual(attestation.platform, { os: platform(), arch: arch(), release: release() });
      assert.equal(attestation.tools.tesseract.engDataSha256, `sha256:${sha256File(engDataPath)}`);
      assertPinnedPlatform(manifest, attestation.platform);

      const driftCases = [
        ['ffmpeg executable hash', (copy) => { copy.nativeTools.ffmpeg.executableSha256 = `sha256:${'0'.repeat(64)}`; }, /ffmpeg executable hash mismatch/],
        ['ffmpeg version', (copy) => { copy.nativeTools.ffmpeg.version = '7.1.0'; }, /ffmpeg version mismatch/],
        ['ffmpeg build', (copy) => { copy.nativeTools.ffmpeg.buildIdentity = 'drift'; }, /ffmpeg build identity mismatch/],
        ['ffprobe executable hash', (copy) => { copy.nativeTools.ffprobe.executableSha256 = `sha256:${'0'.repeat(64)}`; }, /ffprobe executable hash mismatch/],
        ['ffprobe version', (copy) => { copy.nativeTools.ffprobe.version = '7.1.0'; }, /ffprobe version mismatch/],
        ['ffprobe build', (copy) => { copy.nativeTools.ffprobe.buildIdentity = 'drift'; }, /ffprobe build identity mismatch/],
        ['tesseract executable hash', (copy) => { copy.nativeTools.tesseract.executableSha256 = `sha256:${'0'.repeat(64)}`; }, /tesseract executable hash mismatch/],
        ['tesseract version', (copy) => { copy.nativeTools.tesseract.version = '5.5.0'; }, /tesseract version mismatch/],
        ['tesseract build', (copy) => { copy.nativeTools.tesseract.buildIdentity = 'drift'; }, /tesseract build identity mismatch/],
        ['traineddata hash', (copy) => { copy.nativeTools.tesseract.engDataSha256 = `sha256:${'1'.repeat(64)}`; }, /language data hash mismatch/],
        ['ImageMagick executable hash', (copy) => { copy.nativeTools.imageMagick.executableSha256 = `sha256:${'0'.repeat(64)}`; }, /imageMagick executable hash mismatch/],
        ['ImageMagick version', (copy) => { copy.nativeTools.imageMagick.version = '7.1.2-17'; }, /imageMagick version mismatch/],
        ['ImageMagick build', (copy) => { copy.nativeTools.imageMagick.buildIdentity = 'drift'; }, /imageMagick build identity mismatch/],
      ];
      for (const [, mutate, expected] of driftCases) {
        const copy = structuredClone(manifest.verification);
        mutate(copy);
        assert.throws(() => attestNativeTools({ manifest: { verification: copy }, pathValue: bin, run }), expected);
      }
      assert.throws(
        () => assertPinnedPlatform(manifest, { os: 'linux', arch: 'amd64', release: 'drift' }),
        /platform mismatch/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds the vendored timeline schema from a clean archive without stale build output', {
    timeout: 180_000,
  }, () => {
    const trackedBuildOutput = runTestCommand(
      'git',
      ['ls-files', 'vendor/timeline-schema/python/build'],
      { cwd: REPO_ROOT },
    );
    assert.equal(trackedBuildOutput.status, 0, trackedBuildOutput.stderr);
    assert.equal(trackedBuildOutput.stdout.trim(), '');

    const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'paired-schema-package-test-'));
    try {
      const tree = runTestCommand('git', ['write-tree'], {
        cwd: REPO_ROOT,
      });
      assert.equal(tree.status, 0, tree.stderr);

      const archivePath = resolve(runtimeRoot, 'reigh.tar');
      const archive = runTestCommand('git', [
        'archive', '--format=tar', `--output=${archivePath}`, tree.stdout.trim(),
        'scripts/release/paired-python-build-tools.lock',
        'vendor/timeline-schema/python',
      ], {
        cwd: REPO_ROOT,
      });
      assert.equal(archive.status, 0, archive.stderr);
      const extract = runTestCommand('tar', ['-xf', archivePath, '-C', runtimeRoot]);
      assert.equal(extract.status, 0, extract.stderr);

      const bootstrapPython = process.env.ASTRID_PYTHON || 'python3.11';
      const venv = resolve(runtimeRoot, 'venv');
      const createVenv = runTestCommand(bootstrapPython, ['-m', 'venv', '--system-site-packages', venv]);
      assert.equal(
        createVenv.status,
        0,
        createVenv.error?.message || createVenv.stderr || `${bootstrapPython} could not create a venv`,
      );
      const python = resolve(venv, 'bin', 'python');
      const installBuildTools = runTestCommand(python, [
        '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
        '--no-deps', '--only-binary=:all:', '--require-hashes',
        '-r', resolve(runtimeRoot, 'scripts/release/paired-python-build-tools.lock'),
      ]);
      assert.equal(installBuildTools.status, 0, installBuildTools.stderr);

      const wheelDir = resolve(runtimeRoot, 'wheels');
      const buildWheel = runTestCommand(python, [
        '-m', 'pip', '--isolated', 'wheel', '--disable-pip-version-check',
        '--no-cache-dir', '--no-deps', '--no-build-isolation',
        '--wheel-dir', wheelDir,
        resolve(runtimeRoot, 'vendor/timeline-schema/python'),
      ]);
      assert.equal(buildWheel.status, 0, buildWheel.stderr);

      const wheels = readdirSync(wheelDir).filter((name) => name.endsWith('.whl'));
      assert.equal(wheels.length, 1, `expected one timeline-schema wheel, found ${wheels.join(', ')}`);
      const sourceSchema = resolve(
        runtimeRoot,
        'vendor/timeline-schema/python/banodoco_timeline_schema/timeline.schema.json',
      );
      const compare = runTestCommand(python, ['-c', [
        'import hashlib, pathlib, sys, zipfile',
        'source = pathlib.Path(sys.argv[1]).read_bytes()',
        'with zipfile.ZipFile(sys.argv[2]) as wheel:',
        "    packaged = wheel.read('banodoco_timeline_schema/timeline.schema.json')",
        'assert hashlib.sha256(packaged).digest() == hashlib.sha256(source).digest()',
      ].join('\n'), sourceSchema, resolve(wheelDir, wheels[0])]);
      assert.equal(compare.status, 0, compare.stderr);

      const wheel = resolve(wheelDir, wheels[0]);
      const installWheel = runTestCommand(python, [
        '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
        '--no-deps', wheel,
      ]);
      assert.equal(installWheel.status, 0, installWheel.stderr);
      const typeIdentity = runTestCommand(python, ['-c', [
        'import sys, types',
        'sys.modules["jsonschema"] = types.SimpleNamespace(validate=lambda *args, **kwargs: None)',
        'from typing import get_args, get_type_hints',
        'from banodoco_timeline_schema import TimelineClip, TimelineConfig',
        'from banodoco_timeline_schema.generated import Clip',
        'assert TimelineClip is Clip',
        'assert get_args(get_type_hints(TimelineConfig)["clips"])[0] is TimelineClip',
      ].join('\n')]);
      assert.equal(typeIdentity.status, 0, typeIdentity.stderr);
      const schemaAcceptance = runTestCommand(python, ['-c', [
        'from banodoco_timeline_schema import validate_timeline',
        'validate_timeline({',
        '  "clips": [{',
        '    "id": "caption-1", "at": 1, "track": "captions",',
        '    "clipType": "text", "label": "Human-readable caption",',
        '    "app": {"__generated__": {"extensionId": "com.reigh.transcript-lane"}},',
        '    "keyframes": {"opacity": [{"time": 0, "value": 1, "interpolation": "linear"}]}',
        '  }],',
        '  "app": {"com.reigh.scene-phase-markers": {"sceneMarkers": []}}',
        '})',
      ].join('\n')]);
      assert.equal(schemaAcceptance.status, 0, schemaAcceptance.stderr);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('accepts only run/plan/help and exposes no skip surface', () => {
    assert.deepEqual(parseCliArgs([]), { help: false, mode: 'run' });
    assert.deepEqual(parseCliArgs(['--plan']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--dry-run']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--help']), { help: true, mode: 'run' });
    for (const bypass of ['--skip-browser', '--skip-migration', '--use-stub', '--no-restore']) {
      assert.throws(() => parseCliArgs([bypass]), /unknown option/);
    }
  });

  it('requires exact full commit pins', () => {
    const full = 'a'.repeat(40);
    assert.equal(requireFullCommitPin(full, 'test pin'), full);
    assert.throws(() => requireFullCommitPin('a'.repeat(12), 'test pin'), /full 40-character/);
    assert.throws(() => requireFullCommitPin('A'.repeat(40), 'test pin'), /full 40-character/);
  });

  it('requires the exact per-run candidate identity for Vite readiness', () => {
    const identity = buildReadinessIdentity({
      nonce: 'deadbeef',
      reighCommit: 'a'.repeat(40),
    });
    const expected = {
      schemaVersion: 1,
      revision: identity,
      extensions: {
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: true,
      },
    };
    assert.equal(isExactViteReadiness(expected, identity), true);
    assert.equal(isExactViteReadiness({ ...expected, revision: 'paired-preview' }, identity), false);
    assert.equal(isExactViteReadiness({ status: 200 }, identity), false);
    assert.throws(() => buildReadinessIdentity({ nonce: 'ambient', reighCommit: 'a'.repeat(40) }), /nonce/);
  });

  it('passes strictPort for both Vite dev and preview servers', () => {
    for (const mode of ['development', 'preview']) {
      const args = buildViteArgs('/snapshot/node_modules/vite/bin/vite.js', mode, 4173);
      assert.ok(args.includes('--strictPort'), `${mode} Vite server must reject port fallback`);
      assert.equal(args[args.indexOf('--port') + 1], '4173');
    }
  });

  it('binds the shared timeline schema to the installed venv and pinned Astrid source', () => {
    const expectedSchemaSha256 = 'b'.repeat(64);
    assert.equal(TIMELINE_SCHEMA_DISTRIBUTION_VERSION, '0.0.2');
    assert.deepEqual(validateTimelineSchemaInstallation({
      probe: {
        astridModulePath: '/tmp/astrid/astrid/__init__.py',
        distributionVersion: '0.0.2',
        modulePath: '/tmp/venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py',
        schemaPythonpath: '/tmp/venv/lib/python3.11/site-packages',
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), {
      astridModulePath: '/tmp/astrid/astrid/__init__.py',
      distributionVersion: '0.0.2',
      modulePath: '/tmp/venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py',
      schemaPythonpath: '/tmp/venv/lib/python3.11/site-packages',
      schemaSha256: expectedSchemaSha256,
    });
    assert.throws(() => validateTimelineSchemaInstallation({
      probe: {
        astridModulePath: '/developer/astrid/__init__.py',
        distributionVersion: '0.0.2',
        modulePath: '/developer/site-packages/banodoco_timeline_schema/__init__.py',
        schemaPythonpath: '/developer/site-packages',
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), /outside its pinned runtime root/);
  });

  it('preserves runtime-root paths in the machine-readable schema import probe', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    const probeStart = source.indexOf('const schemaProbe = runLogged');
    const probeEnd = source.indexOf('  }).payload;', probeStart);
    assert.ok(probeStart >= 0 && probeEnd > probeStart, 'schema probe call must remain discoverable');
    const probeSource = source.slice(probeStart, probeEnd);
    assert.match(probeSource, /parseJson:\s*true/);
    assert.doesNotMatch(probeSource, /redactEnvValues:\s*false/);
    assert.match(source, /structuredOutput: parseJson \? 'json' : undefined/);
  });

  it('does not corrupt canonical schema paths with a lexical TMPDIR prefix', () => {
    const lexicalRuntimeRoot = `/var/folders/paired-schema-runtime-${process.pid}`;
    const canonicalRuntimeRoot = `/private${lexicalRuntimeRoot}`;
    const expectedSchemaSha256 = 'c'.repeat(64);
    const probe = {
      astridModulePath: `${canonicalRuntimeRoot}/astrid/astrid/__init__.py`,
      distributionVersion: TIMELINE_SCHEMA_DISTRIBUTION_VERSION,
      modulePath: `${canonicalRuntimeRoot}-venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py`,
      schemaPythonpath: `${canonicalRuntimeRoot}-venv/lib/python3.11/site-packages`,
      schemaSha256: expectedSchemaSha256,
    };
    const command = ['-e', `process.stdout.write(${JSON.stringify(JSON.stringify(probe))})`];
    const env = { PATH: process.env.PATH ?? '', TMPDIR: lexicalRuntimeRoot };

    const redacted = runTestCommand(process.execPath, command, { env });
    assert.match(redacted.stdout, /\/private\[REDACTED\]-venv/);

    const structured = runTestCommand(process.execPath, command, {
      env,
      structuredOutput: 'json',
    });
    assert.deepEqual(validateTimelineSchemaInstallation({
      probe: structured.payload,
      astridSnapshot: `${canonicalRuntimeRoot}/astrid`,
      expectedSchemaSha256,
      venv: `${canonicalRuntimeRoot}-venv`,
    }), probe);
    assert.match(structured.stdout, /\/private\[REDACTED\]-venv/);
  });

  it('returns an unredacted structured payload through runLogged while keeping the log redacted', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-structured-log-'));
    const logPath = resolve(root, 'structured.log');
    try {
      const result = runLogged(process.execPath, [
        '-e',
        'process.stdout.write(JSON.stringify({ ok: true, ci: process.env.CI === "true" }))',
      ], {
        cwd: root,
        env: { PATH: process.env.PATH ?? '', CI: 'true' },
        logPath,
        parseJson: true,
      });
      assert.deepEqual(result.payload, { ok: true, ci: true });
      assert.match(readFileSync(logPath, 'utf8'), /\[REDACTED\]/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('redacts malformed structured-output diagnostics without exposing command secrets', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-structured-malformed-'));
    const logPath = resolve(root, 'malformed.log');
    const secret = `run-logged-structured-secret-${process.pid}`;
    try {
      assert.throws(() => runLogged(process.execPath, [
        '-e',
        `process.stdout.write('not-json:${secret}')`,
      ], {
        cwd: root,
        env: { PATH: process.env.PATH ?? '', STRUCTURED_SECRET: secret },
        logPath,
        parseJson: true,
      }), (error) => {
        assert.doesNotMatch(error.message, new RegExp(secret));
        return true;
      });
      assert.doesNotMatch(readFileSync(logPath, 'utf8'), new RegExp(secret));
      assert.doesNotMatch(readFileSync(`${logPath}.timeout.json`, 'utf8'), new RegExp(secret));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects the old pre-auth pin and accepts the complete release capability', () => {
    assert.throws(
      () => validateAstridReleaseBridgeSources({
        dispatchSource: "parser.add_argument('--port')",
        serverSource: 'server.serve_forever()',
      }),
      new RegExp(`lacks ${RELEASE_BRIDGE_CAPABILITY.replaceAll('.', '\\.')}`),
    );

    assert.deepEqual(validateAstridReleaseBridgeSources({
      dispatchSource: [
        "parser.add_argument('--release-mode', dest='release_mode')",
        "token = os.environ.get('ASTRID_BRIDGE_TOKEN')",
        'create_server(require_auth=release_mode)',
      ].join('\n'),
      serverSource: [
        "supplied = self.headers.get('Authorization')",
        "version = self.headers.get('X-Astrid-Bridge-Version')",
        'if self.server.require_auth: validate()',
      ].join('\n'),
    }), { capability: RELEASE_BRIDGE_CAPABILITY });
  });

  it('puts a hostile Host header on the wire instead of normalizing it like fetch', async () => {
    let observedHost;
    const server = createServer((request, response) => {
      observedHost = request.headers.host;
      response.setHeader('X-Astrid-Bridge-Version', 'v1');
      const forbidden = observedHost === 'attacker.invalid';
      response.statusCode = forbidden ? 403 : 200;
      response.end(JSON.stringify({ error: forbidden ? 'forbidden' : 'host-normalized' }));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const response = await requestRawHttp(`http://127.0.0.1:${address.port}/health`, {
        headers: {
          Authorization: 'Bearer test-token',
          'X-Astrid-Bridge-Version': 'v1',
          Host: 'attacker.invalid',
        },
      });
      assert.equal(observedHost, 'attacker.invalid');
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('x-astrid-bridge-version'), 'v1');
      assert.deepEqual(await response.json(), { error: 'forbidden' });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('keeps the token in server environments and out of browser workers', () => {
    const previous = process.env.ASTRID_BRIDGE_TOKEN;
    process.env.ASTRID_BRIDGE_TOKEN = 'ambient-secret';
    try {
      const browser = buildBrowserEnvironment({
        baseUrl: 'http://127.0.0.1:21000',
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
        evidenceDir: '/tmp/paired-evidence',
        phase: 'first',
      });
      assert.equal(browser.ASTRID_BRIDGE_TOKEN, undefined);
      assert.equal(browser.ASTRID_REMOTION_PROJECT_DIR, undefined);
      assert.equal(browser.ASTRID_NODE_EXECUTABLE, undefined);
      assert.equal(browser.ASTRID_TIMELINE_SCHEMA_PYTHONPATH, undefined);
      assert.equal(browser.OPENAI_API_KEY, undefined);
      assert.equal(browser.PLAYWRIGHT_CHROMIUM_EXECUTABLE, process.execPath);
      assert.equal(browser.PLAYWRIGHT_BROWSERS_PATH, '/tmp');
      assert.equal(browser.PLAYWRIGHT_OUTPUT_DIR, '/tmp/paired-evidence/playwright-first');

      const retryBrowser = buildBrowserEnvironment({
        baseUrl: 'http://127.0.0.1:21000',
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
        evidenceDir: '/tmp/paired-evidence',
        phase: 'first',
        outputPhase: 'first-context-retry-1',
      });
      assert.equal(retryBrowser.PAIRED_RELEASE_PHASE, 'first');
      assert.equal(
        retryBrowser.PLAYWRIGHT_OUTPUT_DIR,
        '/tmp/paired-evidence/playwright-first-context-retry-1',
      );
      assert.throws(() => buildBrowserEnvironment({
        baseUrl: 'http://127.0.0.1:21000',
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
        evidenceDir: '/tmp/paired-evidence',
        phase: 'first',
        outputPhase: '../overwrite',
      }), /invalid paired browser evidence phase/);

      const server = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
      });
      assert.equal(server.ASTRID_BRIDGE_TOKEN, 'generated-server-secret');
      assert.equal(server.OPENAI_API_KEY, undefined);
      const astridRenderServer = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
        nodeExecutable: '/usr/local/bin/node-pinned',
        remotionProjectDir: '/tmp/paired-astrid/remotion',
        timelineSchemaPythonpath: '/tmp/paired-venv/lib/python3.11/site-packages',
      });
      assert.equal(astridRenderServer.ASTRID_REMOTION_PROJECT_DIR, '/tmp/paired-astrid/remotion');
      assert.equal(astridRenderServer.ASTRID_NODE_EXECUTABLE, '/usr/local/bin/node-pinned');
      assert.equal(astridRenderServer.ASTRID_TIMELINE_SCHEMA_PYTHONPATH, '/tmp/paired-venv/lib/python3.11/site-packages');

      const development = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
        reighMode: 'development',
        reighPort: 21002,
      });
      assert.equal(development.VITE_DISABLE_REMOTE_FONTS, '1');

      const preview = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
        reighMode: 'preview',
        reighPort: 21003,
      });
      assert.equal(preview.VITE_DISABLE_REMOTE_FONTS, '0');
    } finally {
      if (previous === undefined) delete process.env.ASTRID_BRIDGE_TOKEN;
      else process.env.ASTRID_BRIDGE_TOKEN = previous;
    }
  });

  it('keeps every required phase and fixed acceptance count in code ownership', () => {
    assert.equal(EXPECTED_EXTENSION_COUNT, 13);
    assert.equal(EXPECTED_RUNAWAY_COUNT, 566);
    assert.deepEqual(PAIRED_RELEASE_PHASES, [
      'exact-ref capability preflight',
      'clean archive materialization',
      'locked Reigh, Playwright, paired Python, and archived Astrid Remotion runtime (attested Node/npm) provisioning plus production build',
      'Astrid database initialization and pre-migration backup',
      'Runaway migration first apply and idempotent second apply',
      'authenticated Astrid release bridge plus built Reigh preview smoke',
      'development-only local-editor paired acceptance (current production bridge limitation)',
      'Reigh and Astrid restart plus persisted-state/render acceptance',
      'backup restore, second restart, and rollback-state acceptance',
      'immutable receipt and artifact hash index publication',
    ]);
  });

  it('fails before provisioning when the standalone paired gate lacks its release disk budgets', () => {
    const gib = 1024n ** 3n;
    const capacities = new Map([
      ['/paired-temp', 5n * gib],
      ['/paired-astrid', 2n * gib],
    ]);
    const dependencies = {
      platform: 'linux',
      exists: () => true,
      ancestor: (candidate) => candidate,
      realpath: (candidate) => candidate,
      stat: (candidate) => ({ dev: candidate === '/paired-temp' ? 1n : 2n }),
      statfs: (candidate) => ({ bavail: capacities.get(candidate), bsize: 1n }),
    };

    assert.deepEqual(assertPairedReleaseDiskCapacity({
      astridCheckout: '/paired-astrid',
      tempPath: '/paired-temp',
    }, dependencies), [
      {
        target: '/paired-temp',
        availableBytes: String(5n * gib),
        requiredBytes: String(5n * gib),
        volume: 'dev:1',
      },
      {
        target: '/paired-astrid',
        availableBytes: String(2n * gib),
        requiredBytes: String(2n * gib),
        volume: 'dev:2',
      },
    ]);

    capacities.set('/paired-temp', (5n * gib) - 1n);
    assert.throws(
      () => assertPairedReleaseDiskCapacity({
        astridCheckout: '/paired-astrid',
        tempPath: '/paired-temp',
      }, dependencies),
      /insufficient release disk capacity.*requires at least 5\.0 GiB.*available 4\.9 GiB/,
    );
    capacities.set('/paired-temp', 5n * gib);
    capacities.set('/paired-astrid', (2n * gib) - 1n);
    assert.throws(
      () => assertPairedReleaseDiskCapacity({
        astridCheckout: '/paired-astrid',
        tempPath: '/paired-temp',
      }, dependencies),
      /insufficient release disk capacity.*requires at least 2\.0 GiB.*available 1\.9 GiB/,
    );

    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    const main = source.slice(source.indexOf('export async function main'));
    const repositoryPreflight = main.indexOf('preflightPinnedRepositories');
    const diskPreflight = main.indexOf('assertPairedReleaseDiskCapacity');
    const toolchainPreflight = main.indexOf('preflightNativeToolchain');
    const execution = main.indexOf('await executeGate');
    assert.ok(repositoryPreflight >= 0);
    assert.ok(repositoryPreflight < diskPreflight);
    assert.ok(diskPreflight < toolchainPreflight);
    assert.ok(toolchainPreflight < execution);
  });

  it('pins the independently owned canonical Runaway release inputs', () => {
    assert.deepEqual(RUNAWAY_RELEASE_FIXTURE_HASHES, {
      'audio-reactive-v1.json': 'd7925d72b52180e206a2511a5d30cf1638c7007a962fd57d8a6eb9ffb10af886',
      'timing-manifest.json': '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
    });
  });

  it('prints an honest non-executing plan and documents the production boundary', () => {
    const script = `${REPO_ROOT}/scripts/release/verify-paired-release-e2e.mjs`;
    const plan = runTestCommand(process.execPath, [script, '--plan'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH },
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /PLAN ONLY/);
    assert.match(plan.stdout, /no phase is optional/);
    assert.match(plan.stdout, /development-only local-editor paired acceptance/);
    assert.match(plan.stdout, new RegExp(RELEASE_BRIDGE_CAPABILITY.replaceAll('.', '\\.')));

    const help = runTestCommand(process.execPath, [script, '--help'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH },
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /serve-owned worker completes render tasks/);
    assert.match(help.stdout, /never placed on argv or exposed to the browser/);

    const source = readFileSync(script, 'utf8');
    assert.doesNotMatch(source, /shell\s*:\s*true/);
    assert.doesNotMatch(source, /execSync|execFileSync/);
    assert.match(source, /git', \['archive'/);
    assert.match(source, /npm-userconfig/);
    assert.match(source, /npm-globalconfig/);
    assert.doesNotMatch(source, /NPM_CONFIG_USERCONFIG: '\/dev\/null'/);
    assert.match(source, /freezeArtifacts\(evidenceRoot\)/);
    assert.match(source, /requirements\/runtime\.lock/);
    assert.match(source, /--require-hashes/);
    assert.match(source, /requireCleanWorktree/);
    assert.match(source, /render-full-decode\.log/);
    assert.match(source, /playwright-browser-install\.log/);
    assert.match(source, /PLAYWRIGHT_BROWSERS_PATH/);
    assert.match(source, /--only-binary=:all:/);
    assert.match(source, /paired-python-build-tools\.lock/);
    assert.match(source, /timeline-schema-source-snapshot\.json/);
    assert.match(source, /--no-build-isolation/);
    assert.match(source, /pip', '--isolated', 'list', '--format=json/);
    assert.match(source, /astrid-runtime-packages-normalized\.json/);
    assert.doesNotMatch(source, /pip', 'freeze'/);
    assert.match(source, /astrid-restored-logical-snapshot\.json/);
    assert.match(source, /astrid-restored-media-snapshot\.json/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /inspectCandidateController/);
    assert.match(source, /reighControllerHead: pins\.reighControllerHead/);
    assert.match(source, /archiveCommit\(REPO_ROOT, pins\.reighCommit/);
    assert.ok(source.indexOf("'receipt.json'") < source.indexOf("'artifact-index.json'"));
  });

  it('reconstructs a relative Playwright executable beneath its pinned browser root', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-browser-root-'));
    const outside = mkdtempSync(resolve(tmpdir(), 'paired-browser-outside-'));
    try {
      mkdirSync(resolve(root, 'chromium'));
      writeFileSync(resolve(root, 'chromium/chrome'), 'browser');
      const executable = resolvePinnedBrowserExecutable(root, 'chromium/chrome');
      assert.equal(executable, realpathSync(resolve(root, 'chromium/chrome')));
      assert.throws(
        () => resolvePinnedBrowserExecutable(root, '../outside/chrome'),
        /escaped its browser root/,
      );
      assert.throws(
        () => resolvePinnedBrowserExecutable(root, '/tmp/outside/chrome'),
        /non-empty relative executable path/,
      );
      writeFileSync(resolve(outside, 'chrome'), 'outside browser');
      symlinkSync(outside, resolve(root, 'linked-outside'));
      assert.throws(
        () => resolvePinnedBrowserExecutable(root, 'linked-outside/chrome'),
        /escaped its real browser root/,
      );

      const source = readFileSync(`${REPO_ROOT}/scripts/release/verify-paired-release-e2e.mjs`, 'utf8');
      const browserResolver = source.slice(source.indexOf('function resolvePinnedBrowser(context)'), source.indexOf('function astridCommand'));
      assert.match(browserResolver, /path\.relative\(process\.env\.PLAYWRIGHT_BROWSERS_PATH, chromium\.executablePath\(\)\)/);
      assert.match(browserResolver, /resolvePinnedBrowserExecutable\(browserRoot, relativeExecutable\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('makes pinned ffmpeg -xerror reject an actually truncated bitstream', { timeout: 180_000 }, () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-full-decode-corruption-'));
    const valid = resolve(root, 'valid.mp4');
    const truncated = resolve(root, 'truncated.mp4');
    try {
      const encoded = runTestCommand('ffmpeg', [
        '-v', 'error', '-loop', '1', '-i', resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE),
        '-frames:v', '24', '-an', '-c:v', 'mpeg4', '-y', valid,
      ], { cwd: root });
      assert.equal(encoded.status, 0, encoded.stderr);
      const bytes = readFileSync(valid);
      assert.ok(bytes.length > 256, 'fixture video must be large enough to truncate');
      writeFileSync(truncated, bytes.subarray(0, bytes.length - 256));
      const decoded = runTestCommand('ffmpeg', [
        '-xerror', '-v', 'error', '-i', truncated, '-f', 'null', '-',
      ], { cwd: root });
      assert.notEqual(decoded.status, 0, 'strict full decode must fail for a truncated bitstream');
      assert.notEqual(decoded.failureType, 'success');
      const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
      assert.match(source, /'-xerror', '-v', 'error', '-i', outputPath/);
      assert.match(source, /strictStderr: true/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes every synchronous external command through the bounded helper and owns phase budgets', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.doesNotMatch(source, /\bspawnSync\s*\(|\bexecSync\s*\(|\bexecFileSync\s*\(/);
    assert.match(source, /runBoundedCommand\(command, args/);
    assert.deepEqual(Object.keys(COMMAND_BUDGETS_MS), [
      'fastProbe', 'git', 'archive', 'npm', 'pip', 'playwright', 'migration',
      'backup', 'sqlite', 'ffmpeg', 'ffprobe', 'tesseract', 'magick',
    ]);
    for (const [phase, budgetMs] of Object.entries(COMMAND_BUDGETS_MS)) {
      assert.ok(Number.isSafeInteger(budgetMs) && budgetMs > 0, `${phase} budget must be positive`);
    }
    assert.equal(
      commandTimeout(process.execPath, ['/pinned/npm-cli.js', 'run', 'build']),
      COMMAND_BUDGETS_MS.npm,
      'pinned npm invoked through Node must retain the npm phase budget',
    );
    assert.equal(
      commandTimeout('/usr/bin/python', ['/tmp/npm-cli.js', 'run', 'build']),
      COMMAND_BUDGETS_MS.fastProbe,
      'an npm-cli.js-looking argument under a non-Node executable must not escalate its budget',
    );
    assert.match(source, /failureType: result\.failureType/);
    assert.match(source, /commandDiagnostic/);
    assert.match(source, /kill=\$\{result\.killSignal\}/);
  });

  it('keeps structured-command failure messages to field-specific summaries', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'scripts/release/verify-paired-release-e2e.mjs'), 'utf8');
    assert.doesNotMatch(source, /Runaway \$\{label\} migration count mismatch: \$\{JSON\.stringify\(payload\)\}/);
    assert.doesNotMatch(source, /Astrid doctor failed after restore: \$\{JSON\.stringify\(doctor\)\}/);
    assert.match(source, /hasProjectId: typeof payload\?\.project_id === 'string'/);
    assert.match(source, /name: typeof check\?\.name === 'string'/);
    assert.match(source, /code: typeof check\?\.code === 'string'/);
  });

  it('fails a bounded release probe closed without leaving a timed-out child behind', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'paired-command-timeout-'));
    const marker = resolve(root, 'orphan-marker');
    try {
      const result = runBoundedCommand(process.execPath, ['-e', [
        'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "orphan"), 500)',
        'process.argv[1] = process.argv[1]',
      ].join(';'), marker], {
        timeoutMs: 40,
        maxBuffer: 1024,
        killSignal: 'SIGKILL',
        allowFailure: true,
        label: 'paired-timeout-negative',
      });
      assert.equal(result.failureType, 'timeout');
      assert.equal(result.signal, 'SIGKILL');
      assert.equal(result.error?.code, 'ETIMEDOUT');
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
