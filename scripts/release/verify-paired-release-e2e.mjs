#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LABEL = '[paired-release-e2e]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const MANIFEST_PATH = resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json');
export const EXPECTED_EXTENSION_COUNT = 13;
export const EXPECTED_RUNAWAY_COUNT = 566;
export const RELEASE_BRIDGE_CAPABILITY = 'astrid.authenticated-release-bridge.v1';
const DEMO_PROJECT = 'paired-release-demo';
const DEMO_TIMELINE = 'paired-release-timeline';
const RUNAWAY_PROJECT = 'runaway-piano-colour-demo';
const TIMELINE_CONFIG = Object.freeze({
  output: { resolution: '1280x720', fps: 24, file: 'paired-release-output.mp4' },
  clips: [
    { id: 'paired-release-clip', track: 'V1', at: 0, clipType: 'media', hold: 4, asset: 'paired-release.jpg' },
  ],
  tracks: [
    { id: 'V1', kind: 'visual', label: 'Video' },
    { id: 'V2', kind: 'visual', label: 'Video 2' },
    { id: 'A1', kind: 'audio', label: 'Audio' },
  ],
});
const PUBLIC_BUILD_ENV = Object.freeze({
  VITE_SUPABASE_URL: 'https://example.invalid',
  VITE_SUPABASE_ANON_KEY: 'paired-release-public-anon-key',
  VITE_API_TARGET_URL: 'https://example.invalid',
  VITE_APP_ENV: 'production',
});
const BASE_ENV_KEYS = Object.freeze([
  'PATH',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
]);

class UsageError extends Error {}

function fail(message) {
  throw new Error(message);
}

export function parseCliArgs(argv) {
  let mode = 'run';
  let help = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--plan' || arg === '--dry-run') mode = 'plan';
    else throw new UsageError(`unknown option: ${arg}`);
  }
  return { help, mode };
}

function safeBaseEnvironment(overrides = {}) {
  const env = Object.fromEntries(
    BASE_ENV_KEYS
      .filter((key) => typeof process.env[key] === 'string')
      .map((key) => [key, process.env[key]]),
  );
  return {
    ...env,
    CI: 'true',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    ...overrides,
  };
}

export function buildServerEnvironment({
  home,
  projectsRoot,
  pythonPath,
  bridgePort,
  token,
  reighMode,
  reighPort,
}) {
  if (!token || typeof token !== 'string') fail('server token must be non-empty');
  const shared = safeBaseEnvironment({
    HOME: home,
    TMPDIR: tmpdir(),
    ASTRID_PROJECTS_ROOT: projectsRoot,
    PYTHONPATH: pythonPath,
  });
  if (reighMode === undefined) {
    return {
      ...shared,
      ASTRID_BRIDGE_TOKEN: token,
    };
  }
  return {
    ...shared,
    ...PUBLIC_BUILD_ENV,
    PORT: String(reighPort),
    VITE_ASTRID_BRIDGE_PORT: String(bridgePort),
    ASTRID_BRIDGE_ALLOW_UNAUTHENTICATED_STUB: '0',
    ASTRID_BRIDGE_TOKEN: token,
    EXTENSION_HOST_ENABLED: 'true',
    TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
    RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
    EXTENSION_RELEASE_CONFIG_REVISION: `paired-${reighMode}`,
  };
}

export function buildBrowserEnvironment({ baseUrl, evidenceDir, phase }) {
  return safeBaseEnvironment({
    PAIRED_RELEASE_BASE_URL: baseUrl,
    PAIRED_RELEASE_EVIDENCE_DIR: evidenceDir,
    PAIRED_RELEASE_PHASE: phase,
    PAIRED_RELEASE_DEMO_PROJECT: DEMO_PROJECT,
    PAIRED_RELEASE_DEMO_TIMELINE: DEMO_TIMELINE,
    PAIRED_RELEASE_RUNAWAY_PROJECT: RUNAWAY_PROJECT,
    PAIRED_RELEASE_EXPECTED_EXTENSIONS: String(EXPECTED_EXTENSION_COUNT),
    PAIRED_RELEASE_EXPECTED_RUNAWAY: String(EXPECTED_RUNAWAY_COUNT),
    PLAYWRIGHT_OUTPUT_DIR: resolve(evidenceDir, `playwright-${phase}`),
  });
}

/**
 * The paired gate intentionally probes source at the exact Astrid pin before
 * it installs dependencies or starts services. A newer checkout cannot make
 * an old manifest pin look release-capable.
 */
export function validateAstridReleaseBridgeSources({ dispatchSource, serverSource }) {
  const missing = [];
  if (!/['"]--release-mode['"]/.test(dispatchSource)) missing.push('serve --release-mode');
  if (!/ASTRID_BRIDGE_TOKEN/.test(dispatchSource + serverSource)) missing.push('ASTRID_BRIDGE_TOKEN');
  if (!/Authorization/.test(serverSource)) missing.push('Authorization bearer validation');
  if (!/X-Astrid-Bridge-Version/.test(serverSource)) missing.push('X-Astrid-Bridge-Version validation');
  if (!/(?:release_mode|require_auth)/.test(dispatchSource + serverSource)) missing.push('release-mode auth wiring');
  if (missing.length > 0) {
    fail(
      `Astrid pin lacks ${RELEASE_BRIDGE_CAPABILITY}: ${missing.join(', ')}. `
      + 'Repin only to a clean settled Astrid commit that implements the complete capability.',
    );
  }
  return Object.freeze({ capability: RELEASE_BRIDGE_CAPABILITY });
}

function commandFailure(command, args, result) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return `${command} ${args.join(' ')} failed with exit ${result.status ?? 'unknown'}${output ? `: ${output.slice(-3000)}` : ''}`;
}

function capture(command, args, { cwd, env, allowFailure = false, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ?? safeBaseEnvironment(),
    encoding: 'utf8',
    input,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    if (result.error) throw result.error;
    fail(commandFailure(command, args, result));
  }
  return result;
}

function gitOutput(checkout, args) {
  return capture('git', args, { cwd: checkout }).stdout.trim();
}

function resolveCommit(checkout, ref, label) {
  if (!/^[0-9a-f]{12,40}$/.test(ref ?? '')) {
    fail(`${label} must be a 12-40 character lowercase commit pin`);
  }
  const commit = gitOutput(checkout, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`${label} did not resolve to a full commit`);
  return commit;
}

export function preflightPinnedRepositories({ manifest, env }) {
  if (!/^[0-9a-f]{40}$/.test(env.REIGH_REF ?? '')) {
    fail('REIGH_REF is required and must be the full paired Reigh candidate commit');
  }
  const astridCheckout = env.ASTRID_CHECKOUT;
  if (!astridCheckout || !isAbsolute(astridCheckout)) {
    fail('ASTRID_CHECKOUT is required and must be absolute');
  }
  if (!existsSync(astridCheckout) || !statSync(astridCheckout).isDirectory()) {
    fail(`ASTRID_CHECKOUT is not a directory: ${astridCheckout}`);
  }
  const resolvedAstridCheckout = realpathSync(astridCheckout);
  const reighCommit = resolveCommit(REPO_ROOT, env.REIGH_REF, 'REIGH_REF');
  const reighHead = gitOutput(REPO_ROOT, ['rev-parse', 'HEAD']);
  if (reighHead !== reighCommit) {
    fail(`Reigh checkout HEAD ${reighHead} does not match REIGH_REF ${reighCommit}`);
  }
  const baseCommit = resolveCommit(REPO_ROOT, manifest.reigh.baseCommit, 'manifest reigh.baseCommit');
  const ancestry = capture('git', ['merge-base', '--is-ancestor', baseCommit, reighCommit], {
    cwd: REPO_ROOT,
    allowFailure: true,
  });
  if (ancestry.status !== 0) fail(`Reigh candidate is not descended from ${baseCommit}`);

  const manifestAstridCommit = resolveCommit(
    resolvedAstridCheckout,
    manifest.astrid.commit,
    'manifest astrid.commit',
  );
  const requestedAstridCommit = resolveCommit(
    resolvedAstridCheckout,
    env.ASTRID_REF,
    'ASTRID_REF',
  );
  if (requestedAstridCommit !== manifestAstridCommit) {
    fail(`ASTRID_REF ${requestedAstridCommit} does not match manifest pin ${manifestAstridCommit}`);
  }
  const astridHead = gitOutput(resolvedAstridCheckout, ['rev-parse', 'HEAD']);
  if (astridHead !== manifestAstridCommit) {
    fail(`Astrid checkout HEAD ${astridHead} does not match manifest pin ${manifestAstridCommit}`);
  }
  if (!env.ASTRID_PYTHON || !isAbsolute(env.ASTRID_PYTHON) || !existsSync(env.ASTRID_PYTHON)) {
    fail('ASTRID_PYTHON is required and must be an existing absolute executable');
  }
  const dispatchSource = gitOutput(resolvedAstridCheckout, [
    'show', `${manifestAstridCommit}:astrid/core/gateway/dispatch.py`,
  ]);
  const serverSource = gitOutput(resolvedAstridCheckout, [
    'show', `${manifestAstridCommit}:astrid/core/integrations/reigh/local_bridge_server.py`,
  ]);
  const capability = validateAstridReleaseBridgeSources({ dispatchSource, serverSource });
  const nodeVersion = process.version.replace(/^v/, '');
  if (nodeVersion !== manifest.verification.node) {
    fail(`Node version mismatch: expected ${manifest.verification.node}, got ${nodeVersion}`);
  }
  const npmVersion = capture('npm', ['--version'], { cwd: REPO_ROOT }).stdout.trim();
  if (npmVersion !== manifest.verification.npm) {
    fail(`npm version mismatch: expected ${manifest.verification.npm}, got ${npmVersion}`);
  }
  const astridPython = realpathSync(env.ASTRID_PYTHON);
  const pythonProbe = capture(astridPython, [
    '-c',
    'import json, os, sys; print(json.dumps({"executable": os.path.realpath(sys.executable), "version": ".".join(map(str, sys.version_info[:3]))}))',
  ], { cwd: resolvedAstridCheckout });
  let pythonIdentity;
  try {
    pythonIdentity = JSON.parse(pythonProbe.stdout);
  } catch {
    fail('ASTRID_PYTHON identity probe returned invalid JSON');
  }
  if (pythonIdentity.executable !== astridPython || pythonIdentity.version !== manifest.verification.astridPython) {
    fail(
      `Astrid Python mismatch: expected ${manifest.verification.astridPython} at ${astridPython}, `
      + `got ${pythonIdentity.version ?? '<invalid>'} at ${pythonIdentity.executable ?? '<invalid>'}`,
    );
  }
  return Object.freeze({
    astridCheckout: resolvedAstridCheckout,
    astridCommit: manifestAstridCommit,
    astridPython,
    capability: capability.capability,
    reighCommit,
  });
}

export const PAIRED_RELEASE_PHASES = Object.freeze([
  'exact-ref capability preflight',
  'clean archive materialization',
  'locked Reigh dependency install and production build',
  'Astrid database initialization and pre-migration backup',
  'Runaway migration first apply and idempotent second apply',
  'authenticated Astrid release bridge plus built Reigh preview smoke',
  'development-only local-editor paired acceptance (current production bridge limitation)',
  'Reigh and Astrid restart plus persisted-state/render acceptance',
  'backup restore, second restart, and rollback-state acceptance',
  'immutable receipt and artifact hash index publication',
]);

export function buildRunawayMigrationFixture(count = EXPECTED_RUNAWAY_COUNT) {
  if (!Number.isInteger(count) || count < 1) fail('Runaway fixture count must be a positive integer');
  const colours = ['rose', 'teal'];
  const transitions = Array.from({ length: count }, (_, index) => ({
    id: `paired-release-transition-${String(index + 1).padStart(4, '0')}`,
    segment_id: 'S01',
    segment_label: 'Paired release deterministic fixture',
    timing_mode: 'literal_main_note',
    frame: index * 10,
    colour_index: index % 2 === 0 ? 0 : 4,
    colour_name: colours[index % colours.length],
    colour_hex: index % 2 === 0 ? '#D47795' : '#16B09B',
  }));
  return Object.freeze({
    manifest: {
      schema_version: 1,
      intent: 'Hermetic paired release migration and duplicate-prevention fixture',
      clock: { fps: 48 },
      transition_count: count,
      segments: [{ id: 'S01', transition_count: count }],
      transitions,
    },
    audioReactive: {
      timebase: { fps: 48, range_end_frame: count * 10 + 10 },
    },
  });
}

function printPlan(manifest, env) {
  console.log(`${LABEL} PLAN ONLY - no commands will execute`);
  console.log(`${LABEL} release=${manifest.release} status=${manifest.status}`);
  console.log(`${LABEL} Reigh candidate=${env.REIGH_REF || '<REIGH_REF required>'}`);
  console.log(`${LABEL} Astrid pin=${manifest.astrid.commit}`);
  console.log(`${LABEL} Astrid checkout=${env.ASTRID_CHECKOUT || '<ASTRID_CHECKOUT required>'}`);
  console.log(`${LABEL} required capability=${RELEASE_BRIDGE_CAPABILITY}`);
  for (const [index, phase] of PAIRED_RELEASE_PHASES.entries()) {
    console.log(`${LABEL} ${String(index + 1).padStart(2, '0')}. ${phase}`);
  }
  console.log(`${LABEL} no phase is optional and no skip flag is accepted`);
}

function printHelp() {
  console.log(`Usage: npm run verify:paired-release-e2e -- [--plan | --dry-run]

Run the production-like paired Reigh/Astrid release acceptance gate from clean
temporary archives of the exact manifest-bound commits. Run mode requires:
  REIGH_REF       full Reigh candidate commit equal to this checkout HEAD
  ASTRID_CHECKOUT absolute clean Astrid checkout at the manifest pin
  ASTRID_REF      exact commit resolving to the manifest Astrid pin
  ASTRID_PYTHON   absolute pinned Python executable

The bearer credential is generated in memory and passed only to the Astrid and
Reigh proxy server processes. Evidence is retained beneath /tmp and sealed
read-only. The current Reigh production build deliberately cannot enter local
bridge mode; the gate therefore proves the built preview/auth proxy boundary,
then labels its browser editing lane as development-only until that production
product boundary changes. There are no skip flags.`);
}

function archiveCommit(checkout, commit, destination, archivePath) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  capture('git', ['archive', '--format=tar', '--output', archivePath, commit], { cwd: checkout });
  capture('tar', ['-xf', archivePath, '-C', destination], { cwd: destination });
  rmSync(archivePath, { force: true });
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function listFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, path));
    else if (entry.isFile()) files.push({ path: relative(root, path), bytes: statSync(path).size, sha256: sha256File(path) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function freezeArtifacts(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) freezeArtifacts(resolve(path, name));
    chmodSync(path, 0o555);
  } else if (stat.isFile()) {
    chmodSync(path, 0o444);
  }
}

function createEvidenceRoot(release) {
  const parent = resolve(tmpdir(), 'reigh-paired-release-evidence');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = resolve(parent, `${release}-${stamp}-${process.pid}`);
  if (existsSync(root)) fail(`evidence directory already exists: ${root}`);
  mkdirSync(root, { mode: 0o700 });
  return root;
}

async function allocatePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
}

async function waitForUrl(url, { headers, process: child, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) fail(`server exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url, {
        headers,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`timed out waiting for ${url}: ${last}`);
}

function startLoggedProcess(command, args, { cwd, env, logPath }) {
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('error', (error) => log.write(`\n${LABEL} spawn error: ${error.message}\n`));
  return { child, log };
}

async function stopLoggedProcess(handle) {
  if (!handle) return;
  const { child, log } = handle;
  if (child.exitCode === null && child.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // It may have exited between the state check and signal.
    }
    await Promise.race([
      new Promise((resolvePromise) => child.once('exit', resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
  }
  if (child.exitCode === null && child.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  await new Promise((resolvePromise) => log.end(resolvePromise));
}

function runLogged(command, args, { cwd, env, logPath, parseJson = false }) {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const result = capture(command, args, { cwd, env, allowFailure: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(logPath, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  if (result.error || result.status !== 0) fail(commandFailure(command, args, result));
  let payload;
  if (parseJson) {
    try {
      payload = JSON.parse(result.stdout);
    } catch (error) {
      fail(`${command} returned invalid JSON: ${error.message}`);
    }
  }
  return { durationMs: Date.now() - start, payload, startedAt, status: result.status };
}

function astridCommand(context, args, logName, { parseJson = true } = {}) {
  return runLogged(context.astridPython, ['-m', 'astrid', ...args], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment({
      HOME: context.home,
      TMPDIR: context.runtimeRoot,
      PYTHONPATH: context.astridSnapshot,
      ASTRID_PROJECTS_ROOT: context.projectsRoot,
    }),
    logPath: resolve(context.evidenceRoot, logName),
    parseJson,
  });
}

function seedDemoProject(context) {
  const sourceDir = resolve(context.projectsRoot, 'seed-sources');
  mkdirSync(sourceDir, { recursive: true, mode: 0o700 });
  const imagePath = resolve(sourceDir, 'paired-release.jpg');
  writeFileSync(imagePath, Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AV//2Q==',
    'base64',
  ), { mode: 0o600 });
  astridCommand(context, [
    'projects', 'create', DEMO_PROJECT,
    '--name', 'Paired Release Demo',
    '--idempotency-key', 'paired-release-project-v1',
    '--json',
  ], 'astrid-project-create.log');
  const media = astridCommand(context, [
    'media', 'import', imagePath,
    '--project', DEMO_PROJECT,
    '--realm', 'managed_local',
    '--idempotency-key', 'paired-release-media-v1',
    '--json',
  ], 'astrid-media-import.log').payload;
  const mediaId = media?.data?.id ?? media?.data?.media_id;
  if (typeof mediaId !== 'string' || !mediaId) fail('Astrid media seed returned no media id');
  astridCommand(context, [
    'timelines', 'create', DEMO_TIMELINE,
    '--project', DEMO_PROJECT,
    '--name', 'Paired Release Timeline',
    '--config', JSON.stringify(TIMELINE_CONFIG),
    '--registry', JSON.stringify({
      assets: {
        'paired-release.jpg': {
          file: 'paired-release.jpg',
          media_id: mediaId,
          type: 'image/jpeg',
        },
      },
    }),
    '--default',
    '--idempotency-key', 'paired-release-timeline-v1',
    '--json',
  ], 'astrid-timeline-create.log');
}

function runMigrationTwice(context) {
  const script = resolve(context.astridSnapshot, 'scripts/migrations/runaway_v1_migrate.py');
  const fixtureDir = resolve(context.runtimeRoot, 'runaway-migration-fixture');
  mkdirSync(fixtureDir, { mode: 0o700 });
  const manifest = resolve(fixtureDir, 'timing-manifest.json');
  const audio = resolve(fixtureDir, 'audio-reactive-v1.json');
  const fixture = buildRunawayMigrationFixture();
  writeFileSync(manifest, `${JSON.stringify(fixture.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  writeFileSync(audio, `${JSON.stringify(fixture.audioReactive, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const env = safeBaseEnvironment({
    HOME: context.home,
    TMPDIR: context.runtimeRoot,
    PYTHONPATH: context.astridSnapshot,
    ASTRID_PROJECTS_ROOT: context.projectsRoot,
  });
  const args = [script, '--projects-root', context.projectsRoot, '--manifest', manifest, '--audio-reactive', audio, '--apply'];
  const first = runLogged(context.astridPython, args, {
    cwd: context.astridSnapshot,
    env,
    logPath: resolve(context.evidenceRoot, 'runaway-migration-first.log'),
    parseJson: true,
  }).payload;
  const second = runLogged(context.astridPython, args, {
    cwd: context.astridSnapshot,
    env,
    logPath: resolve(context.evidenceRoot, 'runaway-migration-second.log'),
    parseJson: true,
  }).payload;
  for (const [label, payload] of [['first', first], ['second', second]]) {
    if (payload.transition_count !== EXPECTED_RUNAWAY_COUNT || payload.stored_count !== EXPECTED_RUNAWAY_COUNT) {
      fail(`Runaway ${label} migration count mismatch: ${JSON.stringify(payload)}`);
    }
    if (payload.evidence_count !== 1) fail(`Runaway ${label} migration duplicated/missed evidence receipt`);
  }
  if (first.project_id !== second.project_id || first.run_id !== second.run_id) {
    fail('Runaway second migration did not preserve project/run identity');
  }
  return { first, second };
}

function sqliteCount(context, sql, logName) {
  const code = [
    'import json, sqlite3, sys',
    'conn=sqlite3.connect(sys.argv[1])',
    'row=conn.execute(sys.argv[2]).fetchone()',
    'print(json.dumps({"count": int(row[0])}))',
  ].join('; ');
  return runLogged(context.astridPython, [
    '-c', code, resolve(context.projectsRoot, '.astrid/astrid.sqlite3'), sql,
  ], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, logName),
    parseJson: true,
  }).payload.count;
}

async function startAstrid(context, suffix, port, token) {
  const logPath = resolve(context.evidenceRoot, `astrid-${suffix}.log`);
  const handle = startLoggedProcess(context.astridPython, [
    '-m', 'astrid', 'serve', '--release-mode', '--no-open-editor',
    '--projects-root', context.projectsRoot, '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: context.astridSnapshot,
    env: buildServerEnvironment({
      home: context.home,
      projectsRoot: context.projectsRoot,
      pythonPath: context.astridSnapshot,
      bridgePort: port,
      token,
    }),
    logPath,
  });
  const headers = { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v1' };
  await waitForUrl(`http://127.0.0.1:${port}/health`, { headers, process: handle.child });
  const unauthorized = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { 'X-Astrid-Bridge-Version': 'v1' },
    redirect: 'manual',
  });
  if (unauthorized.status !== 401) fail(`release bridge unauthenticated health returned ${unauthorized.status}, expected 401`);
  return handle;
}

async function startReigh(context, suffix, port, bridgePort, token, mode) {
  const viteBin = resolve(context.reighSnapshot, 'node_modules/vite/bin/vite.js');
  const args = mode === 'preview'
    ? [viteBin, 'preview', '--config', 'config/vite/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)]
    : [viteBin, '--config', 'config/vite/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)];
  const handle = startLoggedProcess(process.execPath, args, {
    cwd: context.reighSnapshot,
    env: buildServerEnvironment({
      home: context.home,
      projectsRoot: context.projectsRoot,
      pythonPath: context.astridSnapshot,
      bridgePort,
      token,
      reighMode: mode,
      reighPort: port,
    }),
    logPath: resolve(context.evidenceRoot, `reigh-${suffix}.log`),
  });
  await waitForUrl(`http://127.0.0.1:${port}/`, { process: handle.child, timeoutMs: 120_000 });
  return handle;
}

async function smokeBuiltPreview(port) {
  const base = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${base}/runtime-config/v1/extensions.json`, { cache: 'no-store' });
  if (!configResponse.ok) fail(`built preview runtime config returned ${configResponse.status}`);
  const config = await configResponse.json();
  const expected = {
    schemaVersion: 1,
    revision: 'paired-preview',
    extensions: {
      hostEnabled: true,
      transcriptCaptionFoundryEnabled: true,
      runawayTypedTimelineEnabled: true,
    },
  };
  if (JSON.stringify(config) !== JSON.stringify(expected)) {
    fail(`built preview runtime config mismatch: ${JSON.stringify(config)}`);
  }
  const proxy = await fetch(`${base}/api/astrid/health`, {
    headers: { 'X-Astrid-Bridge-Version': 'v1' },
    cache: 'no-store',
  });
  if (!proxy.ok) fail(`built preview authenticated same-origin proxy returned ${proxy.status}`);
  return { config, proxyStatus: proxy.status };
}

function runPlaywright(context, phase, port) {
  const cli = resolve(context.reighSnapshot, 'node_modules/@playwright/test/cli.js');
  return runLogged(process.execPath, [
    cli, 'test', '--config', 'playwright.paired-release.config.ts', '--workers=1',
  ], {
    cwd: context.reighSnapshot,
    env: buildBrowserEnvironment({
      baseUrl: `http://127.0.0.1:${port}`,
      evidenceDir: context.evidenceRoot,
      phase,
    }),
    logPath: resolve(context.evidenceRoot, `playwright-${phase}.log`),
  });
}

async function executeGate(manifest, pins, evidenceRoot) {
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'reigh-paired-release-runtime-'));
  chmodSync(runtimeRoot, 0o700);
  const context = {
    ...pins,
    evidenceRoot,
    runtimeRoot,
    home: resolve(runtimeRoot, 'home'),
    projectsRoot: resolve(runtimeRoot, 'projects'),
    reighSnapshot: resolve(runtimeRoot, 'reigh'),
    astridSnapshot: resolve(runtimeRoot, 'astrid'),
  };
  mkdirSync(context.home, { recursive: true, mode: 0o700 });
  mkdirSync(context.projectsRoot, { recursive: true, mode: 0o700 });
  const npmUserConfig = resolve(runtimeRoot, 'npm-userconfig');
  const npmGlobalConfig = resolve(runtimeRoot, 'npm-globalconfig');
  writeFileSync(npmUserConfig, '', { flag: 'wx', mode: 0o600 });
  writeFileSync(npmGlobalConfig, '', { flag: 'wx', mode: 0o600 });
  const receipt = {
    schemaVersion: 1,
    release: manifest.release,
    startedAt: new Date().toISOString(),
    status: 'failed',
    reighCommit: pins.reighCommit,
    astridCommit: pins.astridCommit,
    capability: pins.capability,
    expected: { extensions: EXPECTED_EXTENSION_COUNT, runawayTransitions: EXPECTED_RUNAWAY_COUNT },
    runtimeModes: {
      productionPreview: 'built Vite preview plus authenticated same-origin proxy smoke',
      browserEditing: 'development-only local bridge mode; production local bridge is intentionally unavailable',
    },
    phases: [],
  };
  let astridHandle;
  let reighHandle;
  const token = randomBytes(32).toString('base64url');
  try {
    archiveCommit(REPO_ROOT, pins.reighCommit, context.reighSnapshot, resolve(runtimeRoot, 'reigh.tar'));
    archiveCommit(pins.astridCheckout, pins.astridCommit, context.astridSnapshot, resolve(runtimeRoot, 'astrid.tar'));
    receipt.phases.push({ id: 'archives', status: 'pass' });

    runLogged('npm', ['ci', '--no-audit', '--no-fund'], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment({ HOME: context.home, TMPDIR: runtimeRoot, NPM_CONFIG_USERCONFIG: npmUserConfig, NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig }),
      logPath: resolve(evidenceRoot, 'reigh-npm-ci.log'),
    });
    runLogged('npm', ['run', 'build'], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment({ ...PUBLIC_BUILD_ENV, HOME: context.home, TMPDIR: runtimeRoot, NPM_CONFIG_USERCONFIG: npmUserConfig, NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig }),
      logPath: resolve(evidenceRoot, 'reigh-build.log'),
    });
    runLogged(process.execPath, ['scripts/runtime/write-extension-release-config.mjs'], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment({
        HOME: context.home,
        EXTENSION_HOST_ENABLED: 'true',
        TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
        RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
        EXTENSION_RELEASE_CONFIG_REVISION: 'paired-preview',
      }),
      logPath: resolve(evidenceRoot, 'reigh-runtime-config.log'),
    });
    receipt.phases.push({ id: 'reigh-build', status: 'pass' });

    seedDemoProject(context);
    const backupDir = resolve(runtimeRoot, 'pre-migration-backup');
    const backup = astridCommand(context, [
      'backup', 'create', '--projects-root', context.projectsRoot, '--out', backupDir, '--json',
    ], 'astrid-backup-create.log').payload;
    if (backup?.ok !== true || !existsSync(resolve(backupDir, 'backup.json'))) fail('Astrid pre-migration backup was not published');
    const migration = runMigrationTwice(context);
    receipt.phases.push({ id: 'migrate-twice', status: 'pass', storedCount: migration.second.stored_count, evidenceCount: migration.second.evidence_count });

    let bridgePort = await allocatePort();
    let reighPort = await allocatePort();
    astridHandle = await startAstrid(context, 'preview', bridgePort, token);
    reighHandle = await startReigh(context, 'preview', reighPort, bridgePort, token, 'preview');
    const preview = await smokeBuiltPreview(reighPort);
    receipt.phases.push({ id: 'built-preview-auth-proxy', status: 'pass', ...preview });
    await stopLoggedProcess(reighHandle); reighHandle = undefined;
    await stopLoggedProcess(astridHandle); astridHandle = undefined;

    bridgePort = await allocatePort();
    reighPort = await allocatePort();
    astridHandle = await startAstrid(context, 'browser-first', bridgePort, token);
    reighHandle = await startReigh(context, 'browser-first', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'first', reighPort);
    receipt.phases.push({ id: 'browser-first', status: 'pass' });
    await stopLoggedProcess(reighHandle); reighHandle = undefined;
    await stopLoggedProcess(astridHandle); astridHandle = undefined;

    bridgePort = await allocatePort();
    reighPort = await allocatePort();
    astridHandle = await startAstrid(context, 'browser-restart', bridgePort, token);
    reighHandle = await startReigh(context, 'browser-restart', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'restart', reighPort);
    receipt.phases.push({ id: 'restart-persistence-render', status: 'pass' });
    await stopLoggedProcess(reighHandle); reighHandle = undefined;
    await stopLoggedProcess(astridHandle); astridHandle = undefined;

    astridCommand(context, [
      'backup', 'restore', backupDir, '--projects-root', context.projectsRoot, '--force', '--json',
    ], 'astrid-backup-restore.log');
    const restoredRunawayCount = sqliteCount(
      context,
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='runaway_transitions'",
      'astrid-restore-schema-count.log',
    );
    // Pack migrations are expected to remain present after restoring a backup
    // made by the same pinned binary; data rows, not schema, are rolled back.
    const restoredRows = sqliteCount(
      context,
      'SELECT COUNT(*) FROM runaway_transitions',
      'astrid-restore-runaway-count.log',
    );
    if (restoredRunawayCount !== 1 || restoredRows !== 0) {
      fail(`restore did not roll Runaway data back cleanly (table=${restoredRunawayCount}, rows=${restoredRows})`);
    }
    bridgePort = await allocatePort();
    reighPort = await allocatePort();
    astridHandle = await startAstrid(context, 'restore', bridgePort, token);
    reighHandle = await startReigh(context, 'restore', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'restore', reighPort);
    receipt.phases.push({ id: 'rollback-restore', status: 'pass', runawayRows: restoredRows });

    receipt.status = 'pass';
  } catch (error) {
    receipt.error = error.message;
    throw error;
  } finally {
    await stopLoggedProcess(reighHandle);
    await stopLoggedProcess(astridHandle);
    receipt.finishedAt = new Date().toISOString();
    try {
      const preIndex = listFiles(evidenceRoot);
      writeFileSync(resolve(evidenceRoot, 'artifact-index.json'), `${JSON.stringify({ schemaVersion: 1, files: preIndex }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      receipt.artifactIndexSha256 = sha256File(resolve(evidenceRoot, 'artifact-index.json'));
      writeFileSync(resolve(evidenceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      freezeArtifacts(evidenceRoot);
      console.log(`${LABEL} evidence=${evidenceRoot}`);
      console.log(`${LABEL} artifact-index-sha256=${receipt.artifactIndexSha256}`);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }
  console.log(`${LABEL} PASS: exact paired release acceptance completed`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCliArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (options.mode === 'plan') {
    printPlan(manifest, env);
    return;
  }
  const evidenceRoot = createEvidenceRoot(manifest.release);
  let pins;
  try {
    pins = preflightPinnedRepositories({ manifest, env });
  } catch (error) {
    const indexPath = resolve(evidenceRoot, 'artifact-index.json');
    writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, files: [] }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const receipt = {
      schemaVersion: 1,
      release: manifest.release,
      status: 'failed',
      phase: 'exact-ref capability preflight',
      reighRef: env.REIGH_REF || null,
      astridRef: env.ASTRID_REF || null,
      manifestAstridPin: manifest.astrid.commit,
      requiredCapability: RELEASE_BRIDGE_CAPABILITY,
      error: error.message,
      finishedAt: new Date().toISOString(),
      artifactIndexSha256: sha256File(indexPath),
    };
    writeFileSync(resolve(evidenceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    freezeArtifacts(evidenceRoot);
    console.error(`${LABEL} evidence=${evidenceRoot}`);
    console.error(`${LABEL} artifact-index-sha256=${receipt.artifactIndexSha256}`);
    throw error;
  }
  await executeGate(manifest, pins, evidenceRoot);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`${LABEL} FAIL: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
