import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  EXPECTED_EXTENSION_COUNT,
  EXPECTED_PERSISTED_CAPTIONS,
  EXPECTED_RUNAWAY_COUNT,
  PAIRED_RELEASE_MEDIA_FIXTURE,
  PAIRED_RELEASE_MEDIA_METADATA,
  PAIRED_RELEASE_PHASES,
  RELEASE_BRIDGE_CAPABILITY,
  REPO_ROOT,
  RUNAWAY_RELEASE_FIXTURE_HASHES,
  TIMELINE_SCHEMA_DISTRIBUTION_VERSION,
  buildBrowserEnvironment,
  buildReadinessIdentity,
  buildServerEnvironment,
  buildViteArgs,
  assessCaptionProbe,
  captionProbePlan,
  childProcessFailure,
  isExactViteReadiness,
  normalizeCaptionText,
  parseCliArgs,
  requireFullCommitPin,
  requestRawHttp,
  validateTimelineSchemaInstallation,
  validateAstridReleaseBridgeSources,
  validateCaptionExpectations,
  validateMediaFixture,
  validateRenderedMediaFrame,
  verifyBridgeMediaContent,
  waitForUrl,
  waitForViteReadiness,
} from './verify-paired-release-e2e.mjs';

describe('paired repository release E2E gate', () => {
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
      const blackResult = spawnSync('magick', [fixture.path, '-fill', 'black', '-colorize', '100%', '-define', 'png:color-type=6', black], { encoding: 'utf8' });
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

  it('builds the vendored timeline schema from a clean archive without stale build output', {
    timeout: 180_000,
  }, () => {
    const trackedBuildOutput = spawnSync(
      'git',
      ['ls-files', 'vendor/timeline-schema/python/build'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    assert.equal(trackedBuildOutput.status, 0, trackedBuildOutput.stderr);
    assert.equal(trackedBuildOutput.stdout.trim(), '');

    const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'paired-schema-package-test-'));
    try {
      const tree = spawnSync('git', ['write-tree'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(tree.status, 0, tree.stderr);

      const archivePath = resolve(runtimeRoot, 'reigh.tar');
      const archive = spawnSync('git', [
        'archive', '--format=tar', `--output=${archivePath}`, tree.stdout.trim(),
        'scripts/release/paired-python-build-tools.lock',
        'vendor/timeline-schema/python',
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.equal(archive.status, 0, archive.stderr);
      const extract = spawnSync('tar', ['-xf', archivePath, '-C', runtimeRoot], {
        encoding: 'utf8',
      });
      assert.equal(extract.status, 0, extract.stderr);

      const bootstrapPython = process.env.ASTRID_PYTHON || 'python3.11';
      const venv = resolve(runtimeRoot, 'venv');
      const createVenv = spawnSync(bootstrapPython, ['-m', 'venv', '--system-site-packages', venv], {
        encoding: 'utf8',
      });
      assert.equal(
        createVenv.status,
        0,
        createVenv.error?.message || createVenv.stderr || `${bootstrapPython} could not create a venv`,
      );
      const python = resolve(venv, 'bin', 'python');
      const installBuildTools = spawnSync(python, [
        '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
        '--no-deps', '--only-binary=:all:', '--require-hashes',
        '-r', resolve(runtimeRoot, 'scripts/release/paired-python-build-tools.lock'),
      ], { encoding: 'utf8' });
      assert.equal(installBuildTools.status, 0, installBuildTools.stderr);

      const wheelDir = resolve(runtimeRoot, 'wheels');
      const buildWheel = spawnSync(python, [
        '-m', 'pip', '--isolated', 'wheel', '--disable-pip-version-check',
        '--no-cache-dir', '--no-deps', '--no-build-isolation',
        '--wheel-dir', wheelDir,
        resolve(runtimeRoot, 'vendor/timeline-schema/python'),
      ], { encoding: 'utf8' });
      assert.equal(buildWheel.status, 0, buildWheel.stderr);

      const wheels = readdirSync(wheelDir).filter((name) => name.endsWith('.whl'));
      assert.equal(wheels.length, 1, `expected one timeline-schema wheel, found ${wheels.join(', ')}`);
      const sourceSchema = resolve(
        runtimeRoot,
        'vendor/timeline-schema/python/banodoco_timeline_schema/timeline.schema.json',
      );
      const compare = spawnSync(python, ['-c', [
        'import hashlib, pathlib, sys, zipfile',
        'source = pathlib.Path(sys.argv[1]).read_bytes()',
        'with zipfile.ZipFile(sys.argv[2]) as wheel:',
        "    packaged = wheel.read('banodoco_timeline_schema/timeline.schema.json')",
        'assert hashlib.sha256(packaged).digest() == hashlib.sha256(source).digest()',
      ].join('\n'), sourceSchema, resolve(wheelDir, wheels[0])], { encoding: 'utf8' });
      assert.equal(compare.status, 0, compare.stderr);

      const wheel = resolve(wheelDir, wheels[0]);
      const installWheel = spawnSync(python, [
        '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
        '--no-deps', wheel,
      ], { encoding: 'utf8' });
      assert.equal(installWheel.status, 0, installWheel.stderr);
      const typeIdentity = spawnSync(python, ['-c', [
        'import sys, types',
        'sys.modules["jsonschema"] = types.SimpleNamespace(validate=lambda *args, **kwargs: None)',
        'from typing import get_args, get_type_hints',
        'from banodoco_timeline_schema import TimelineClip, TimelineConfig',
        'from banodoco_timeline_schema.generated import Clip',
        'assert TimelineClip is Clip',
        'assert get_args(get_type_hints(TimelineConfig)["clips"])[0] is TimelineClip',
      ].join('\n')], { encoding: 'utf8' });
      assert.equal(typeIdentity.status, 0, typeIdentity.stderr);
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
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), {
      astridModulePath: '/tmp/astrid/astrid/__init__.py',
      distributionVersion: '0.0.2',
      modulePath: '/tmp/venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py',
      schemaSha256: expectedSchemaSha256,
    });
    assert.throws(() => validateTimelineSchemaInstallation({
      probe: {
        astridModulePath: '/developer/astrid/__init__.py',
        distributionVersion: '0.0.2',
        modulePath: '/developer/site-packages/banodoco_timeline_schema/__init__.py',
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), /outside its pinned runtime root/);
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
      assert.equal(browser.OPENAI_API_KEY, undefined);
      assert.equal(browser.PLAYWRIGHT_CHROMIUM_EXECUTABLE, process.execPath);
      assert.equal(browser.PLAYWRIGHT_BROWSERS_PATH, '/tmp');

      const server = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
      });
      assert.equal(server.ASTRID_BRIDGE_TOKEN, 'generated-server-secret');
      assert.equal(server.OPENAI_API_KEY, undefined);

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
      'locked Reigh, Playwright, and paired Python provisioning plus production build',
      'Astrid database initialization and pre-migration backup',
      'Runaway migration first apply and idempotent second apply',
      'authenticated Astrid release bridge plus built Reigh preview smoke',
      'development-only local-editor paired acceptance (current production bridge limitation)',
      'Reigh and Astrid restart plus persisted-state/render acceptance',
      'backup restore, second restart, and rollback-state acceptance',
      'immutable receipt and artifact hash index publication',
    ]);
  });

  it('pins the independently owned canonical Runaway release inputs', () => {
    assert.deepEqual(RUNAWAY_RELEASE_FIXTURE_HASHES, {
      'audio-reactive-v1.json': 'd7925d72b52180e206a2511a5d30cf1638c7007a962fd57d8a6eb9ffb10af886',
      'timing-manifest.json': '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
    });
  });

  it('prints an honest non-executing plan and documents the production boundary', () => {
    const script = `${REPO_ROOT}/scripts/release/verify-paired-release-e2e.mjs`;
    const plan = spawnSync(process.execPath, [script, '--plan'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /PLAN ONLY/);
    assert.match(plan.stdout, /no phase is optional/);
    assert.match(plan.stdout, /development-only local-editor paired acceptance/);
    assert.match(plan.stdout, new RegExp(RELEASE_BRIDGE_CAPABILITY.replaceAll('.', '\\.')));

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
});
