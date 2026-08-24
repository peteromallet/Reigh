#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
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

import {
  assertCleanReleaseCheckout,
  inspectCandidateController,
  resolveAnnotatedCandidateTag,
} from './reigh-release-provenance.mjs';

const LABEL = '[paired-release-e2e]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const MANIFEST_PATH = resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json');
export const EXPECTED_EXTENSION_COUNT = 13;
export const EXPECTED_RUNAWAY_COUNT = 566;
export const RELEASE_BRIDGE_CAPABILITY = 'astrid.authenticated-release-bridge.v1';
export const TIMELINE_SCHEMA_DISTRIBUTION_VERSION = '0.0.2';
export const RUNAWAY_RELEASE_FIXTURE_HASHES = Object.freeze({
  'audio-reactive-v1.json': 'd7925d72b52180e206a2511a5d30cf1638c7007a962fd57d8a6eb9ffb10af886',
  'timing-manifest.json': '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
});
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
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_COUNT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
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
    // Paired browser phases are the deterministic localTest journey.  Keep
    // remote-font requests out of that route at the HTML transform boundary;
    // the built preview remains byte-for-byte production-configured.
    VITE_DISABLE_REMOTE_FONTS: reighMode === 'development' ? '1' : '0',
    EXTENSION_HOST_ENABLED: 'true',
    TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
    RUNAWAY_TYPED_TIMELINE_ENABLED: 'true',
    EXTENSION_RELEASE_CONFIG_REVISION: `paired-${reighMode}`,
  };
}

export function buildBrowserEnvironment({ baseUrl, browserExecutable, browserRoot, evidenceDir, phase }) {
  if (!browserExecutable || !isAbsolute(browserExecutable) || !existsSync(browserExecutable)) {
    fail('paired browser executable must be an existing absolute path');
  }
  if (!browserRoot || !isAbsolute(browserRoot) || !existsSync(browserRoot)) {
    fail('paired browser root must be an existing absolute path');
  }
  return safeBaseEnvironment({
    PAIRED_RELEASE_BASE_URL: baseUrl,
    PAIRED_RELEASE_EVIDENCE_DIR: evidenceDir,
    PAIRED_RELEASE_PHASE: phase,
    PAIRED_RELEASE_DEMO_PROJECT: DEMO_PROJECT,
    PAIRED_RELEASE_DEMO_TIMELINE: DEMO_TIMELINE,
    PAIRED_RELEASE_RUNAWAY_PROJECT: RUNAWAY_PROJECT,
    PAIRED_RELEASE_EXPECTED_EXTENSIONS: String(EXPECTED_EXTENSION_COUNT),
    PAIRED_RELEASE_EXPECTED_RUNAWAY: String(EXPECTED_RUNAWAY_COUNT),
    PLAYWRIGHT_CHROMIUM_EXECUTABLE: browserExecutable,
    PLAYWRIGHT_BROWSERS_PATH: browserRoot,
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

export function requireFullCommitPin(ref, label) {
  if (!/^[0-9a-f]{40}$/.test(ref ?? '')) {
    fail(`${label} is required and must be a full 40-character lowercase commit pin`);
  }
  return ref;
}

function requireCleanWorktree(checkout, label) {
  assertCleanReleaseCheckout(checkout, label);
}

export function preflightPinnedRepositories({ manifest, env }) {
  requireFullCommitPin(env.REIGH_REF, 'REIGH_REF');
  requireFullCommitPin(manifest.astrid.commit, 'manifest astrid.commit');
  requireFullCommitPin(env.ASTRID_REF, 'ASTRID_REF');
  const astridCheckout = env.ASTRID_CHECKOUT;
  if (!astridCheckout || !isAbsolute(astridCheckout)) {
    fail('ASTRID_CHECKOUT is required and must be absolute');
  }
  if (!existsSync(astridCheckout) || !statSync(astridCheckout).isDirectory()) {
    fail(`ASTRID_CHECKOUT is not a directory: ${astridCheckout}`);
  }
  const resolvedAstridCheckout = realpathSync(astridCheckout);
  requireCleanWorktree(REPO_ROOT, 'Reigh controller');
  requireCleanWorktree(resolvedAstridCheckout, 'Astrid source');
  const reighCommit = resolveCommit(REPO_ROOT, env.REIGH_REF, 'REIGH_REF');
  const reighHead = gitOutput(REPO_ROOT, ['rev-parse', 'HEAD']);
  const reighTag = resolveAnnotatedCandidateTag({
    repoRoot: REPO_ROOT,
    releaseTag: manifest.reigh.releaseTag,
  });
  if (reighTag.candidateCommit !== reighCommit) {
    fail(
      `Reigh release tag ${manifest.reigh.releaseTag} resolves to ${reighTag.candidateCommit}, `
      + `not REIGH_REF candidate ${reighCommit}`,
    );
  }
  const reighProvenance = inspectCandidateController({
    repoRoot: REPO_ROOT,
    candidateCommit: reighCommit,
    headCommit: reighHead,
    release: manifest.release,
  });
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
    reighControllerHead: reighHead,
    reighCommit,
    reighProvenance,
    reighTagObject: reighTag.tagObject,
  });
}

export const PAIRED_RELEASE_PHASES = Object.freeze([
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
  REIGH_REF       full Reigh candidate commit equal to the annotated release tag
  ASTRID_CHECKOUT absolute clean Astrid checkout at the manifest pin
  ASTRID_REF      exact commit resolving to the manifest Astrid pin
  ASTRID_PYTHON   absolute pinned Python executable

The clean Reigh controller HEAD must be a strict evidence-only descendant of
REIGH_REF. The candidate archive, tests, and receipt remain bound to REIGH_REF.
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
    else fail(`evidence contains an unsupported filesystem entry: ${relative(root, path)}`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function fileTreeSnapshot(root) {
  const files = listFiles(root);
  return {
    files,
    sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
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

/**
 * Issue a bounded loopback HTTP request without undici's browser-oriented
 * header normalization. Node's global fetch silently replaces a caller's
 * `Host` header with the URL authority, which makes a hostile-host rejection
 * probe report a false success. The release gate must put the exact header on
 * the wire so the Astrid server's host/origin policy is actually exercised.
 */
export function requestRawHttp(url, { headers = {}, timeoutMs = 10_000 } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:') fail(`raw HTTP helper only supports http:// URLs: ${url}`);
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers,
      // Never reuse a socket from a different probe: each request's Host is
      // part of the security assertion and must remain independently visible.
      agent: false,
    }, (response) => {
      const chunks = [];
      response.setEncoding('utf8');
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => {
        const body = chunks.join('');
        resolvePromise({
          status: response.statusCode ?? 0,
          headers: {
            get(name) {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value ?? null;
            },
          },
          async json() {
            return JSON.parse(body);
          },
        });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`raw HTTP request timed out after ${timeoutMs}ms`));
    });
    request.once('error', reject);
    request.end();
  });
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
  if (handle.stopped) return;
  const { child, log } = handle;
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  const waitForExit = async (timeoutMs) => {
    if (!isRunning()) return true;
    return Promise.race([
      new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
    ]);
  };
  if (isRunning() && child.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      // It may have exited between the state check and signal.
    }
    await waitForExit(5_000);
  }
  if (isRunning() && child.pid) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    if (!await waitForExit(5_000)) {
      fail(`server process group ${child.pid} did not terminate after SIGKILL`);
    }
  }
  await new Promise((resolvePromise) => log.end(resolvePromise));
  handle.stopped = true;
}

async function stopLoggedProcesses(handles) {
  const results = await Promise.allSettled(handles.filter(Boolean).map(stopLoggedProcess));
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, `failed to stop ${failures.length} server process group(s)`);
  }
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
  return {
    durationMs: Date.now() - start,
    payload,
    startedAt,
    status: result.status,
    stdout: result.stdout,
  };
}

export function validateTimelineSchemaInstallation({
  probe,
  astridSnapshot,
  expectedSchemaSha256,
  venv,
}) {
  if (probe?.distributionVersion !== TIMELINE_SCHEMA_DISTRIBUTION_VERSION) {
    fail(
      `timeline schema distribution mismatch: expected ${TIMELINE_SCHEMA_DISTRIBUTION_VERSION}, `
      + `got ${probe?.distributionVersion ?? '<missing>'}`,
    );
  }
  if (probe?.schemaSha256 !== expectedSchemaSha256) {
    fail(`installed timeline schema hash mismatch: ${probe?.schemaSha256 ?? '<missing>'}`);
  }
  for (const [label, path, root] of [
    ['timeline schema module', probe?.modulePath, venv],
    ['Astrid module', probe?.astridModulePath, astridSnapshot],
  ]) {
    if (!path || !isAbsolute(path)) fail(`${label} probe did not return an absolute path`);
    const scopedPath = relative(root, path);
    if (scopedPath === '' || scopedPath === '..' || scopedPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      fail(`${label} resolved outside its pinned runtime root: ${path}`);
    }
  }
  return Object.freeze({
    astridModulePath: probe.astridModulePath,
    distributionVersion: probe.distributionVersion,
    modulePath: probe.modulePath,
    schemaSha256: probe.schemaSha256,
  });
}

function installLockedAstridRuntime(context) {
  const venv = resolve(context.runtimeRoot, 'astrid-venv');
  runLogged(context.bootstrapAstridPython, ['-m', 'venv', venv], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment({ HOME: context.home, TMPDIR: context.runtimeRoot }),
    logPath: resolve(context.evidenceRoot, 'astrid-venv-create.log'),
  });
  const python = resolve(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const lock = resolve(context.astridSnapshot, 'requirements/runtime.lock');
  if (!existsSync(lock)) fail('pinned Astrid archive has no requirements/runtime.lock');
  runLogged(python, [
    '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-deps',
    '--only-binary=:all:', '--require-hashes', '-r', lock,
  ], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment({ HOME: context.home, TMPDIR: context.runtimeRoot }),
    logPath: resolve(context.evidenceRoot, 'astrid-runtime-lock-install.log'),
  });
  const buildToolsLock = resolve(
    context.reighSnapshot,
    'scripts/release/paired-python-build-tools.lock',
  );
  if (!existsSync(buildToolsLock)) fail('pinned Reigh archive has no paired Python build-tools lock');
  runLogged(python, [
    '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-deps',
    '--only-binary=:all:', '--require-hashes', '-r', buildToolsLock,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment({ HOME: context.home, TMPDIR: context.runtimeRoot }),
    logPath: resolve(context.evidenceRoot, 'paired-python-build-tools-install.log'),
  });
  const timelineSchemaSource = resolve(context.reighSnapshot, 'vendor/timeline-schema/python');
  const timelineSchemaFile = resolve(
    timelineSchemaSource,
    'banodoco_timeline_schema/timeline.schema.json',
  );
  if (!existsSync(timelineSchemaFile)) {
    fail('pinned Reigh archive has no vendored Python timeline schema package');
  }
  const timelineSchemaSourceSnapshot = fileTreeSnapshot(timelineSchemaSource);
  writeFileSync(
    resolve(context.evidenceRoot, 'timeline-schema-source-snapshot.json'),
    `${JSON.stringify(timelineSchemaSourceSnapshot, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  runLogged(python, [
    '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-deps',
    '--no-build-isolation', timelineSchemaSource,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment({ HOME: context.home, TMPDIR: context.runtimeRoot }),
    logPath: resolve(context.evidenceRoot, 'timeline-schema-install.log'),
  });
  const schemaProbe = runLogged(python, ['-c', `
import hashlib
import json
import os
from importlib.metadata import version
from importlib.resources import files
import astrid
import banodoco_timeline_schema

schema_path = files("banodoco_timeline_schema").joinpath("timeline.schema.json")
print(json.dumps({
    "astridModulePath": os.path.realpath(astrid.__file__),
    "distributionVersion": version("banodoco-timeline-schema"),
    "modulePath": os.path.realpath(banodoco_timeline_schema.__file__),
    "schemaSha256": hashlib.sha256(schema_path.read_bytes()).hexdigest(),
}))
`.trim()], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment({
      HOME: context.home,
      TMPDIR: context.runtimeRoot,
      PYTHONPATH: context.astridSnapshot,
    }),
    logPath: resolve(context.evidenceRoot, 'timeline-schema-import-probe.json'),
    parseJson: true,
  }).payload;
  const timelineSchema = validateTimelineSchemaInstallation({
    probe: schemaProbe,
    astridSnapshot: realpathSync(context.astridSnapshot),
    expectedSchemaSha256: sha256File(timelineSchemaFile),
    venv: realpathSync(venv),
  });
  const inventory = runLogged(python, ['-m', 'pip', '--isolated', 'list', '--format=json'], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment({ HOME: context.home, TMPDIR: context.runtimeRoot }),
    logPath: resolve(context.evidenceRoot, 'astrid-runtime-packages-raw.json'),
    parseJson: true,
  }).payload
    .map((entry) => ({ name: String(entry.name).toLowerCase(), version: String(entry.version) }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const inventoryJson = `${JSON.stringify(inventory, null, 2)}\n`;
  writeFileSync(
    resolve(context.evidenceRoot, 'astrid-runtime-packages-normalized.json'),
    inventoryJson,
    { flag: 'wx', mode: 0o600 },
  );
  context.astridPython = python;
  return {
    lock: relative(context.astridSnapshot, lock),
    lockSha256: sha256File(lock),
    buildToolsLock: relative(context.reighSnapshot, buildToolsLock),
    buildToolsLockSha256: sha256File(buildToolsLock),
    environmentPackageCount: inventory.length,
    environmentSha256: createHash('sha256').update(inventoryJson).digest('hex'),
    python: realpathSync(python),
    timelineSchema: {
      ...timelineSchema,
      source: relative(context.reighSnapshot, timelineSchemaSource),
      sourceTreeSha256: timelineSchemaSourceSnapshot.sha256,
    },
  };
}

function resolvePinnedBrowser(context) {
  const playwrightCli = resolve(context.reighSnapshot, 'node_modules/playwright/cli.js');
  const browserRoot = resolve(context.runtimeRoot, 'playwright-browsers');
  const browserEnv = safeBaseEnvironment({
    HOME: context.home,
    TMPDIR: context.runtimeRoot,
    PLAYWRIGHT_BROWSERS_PATH: browserRoot,
  });
  runLogged(process.execPath, [playwrightCli, 'install', 'chromium'], {
    cwd: context.reighSnapshot,
    env: browserEnv,
    logPath: resolve(context.evidenceRoot, 'playwright-browser-install.log'),
  });
  const probe = runLogged(process.execPath, ['-e', [
    "const { chromium } = require('playwright')",
    'process.stdout.write(chromium.executablePath())',
  ].join(';')], {
    cwd: context.reighSnapshot,
    env: browserEnv,
    logPath: resolve(context.evidenceRoot, 'playwright-browser-path.log'),
  });
  const executable = probe.stdout.trim();
  if (!isAbsolute(executable) || !existsSync(executable)) {
    fail(`lock-aligned Playwright Chromium executable is unavailable: ${executable || '<empty>'}`);
  }
  context.browserExecutable = realpathSync(executable);
  context.browserRoot = realpathSync(browserRoot);
  return {
    executable: context.browserExecutable,
    executableSha256: sha256File(context.browserExecutable),
    browsersPath: relative(context.runtimeRoot, context.browserRoot),
  };
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
  const fixtureDir = resolve(context.astridSnapshot, 'tests/fixtures/runaway_release');
  const manifest = resolve(fixtureDir, 'timing-manifest.json');
  const audio = resolve(fixtureDir, 'audio-reactive-v1.json');
  const fixtureHashes = Object.fromEntries(Object.entries(RUNAWAY_RELEASE_FIXTURE_HASHES).map(
    ([name, expected]) => {
      const path = resolve(fixtureDir, name);
      if (!existsSync(path)) fail(`Astrid release fixture is missing from the pinned archive: ${name}`);
      const actual = sha256File(path);
      if (actual !== expected) fail(`Astrid release fixture hash mismatch for ${name}: ${actual}`);
      return [name, actual];
    },
  ));
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
  return { first, second, fixtureHashes };
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

function sqliteCountSnapshot(context, logName) {
  const code = [
    'import json, sqlite3, sys',
    'conn=sqlite3.connect(sys.argv[1])',
    "tables=['projects','events','command_receipts','runs','tasks','evidence_items','runaway_transitions']",
    "existing={row[0] for row in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}",
    "print(json.dumps({name:(int(conn.execute(f'SELECT COUNT(*) FROM {name}').fetchone()[0]) if name in existing else None) for name in tables}, sort_keys=True))",
  ].join('; ');
  return runLogged(context.astridPython, [
    '-c', code, resolve(context.projectsRoot, '.astrid/astrid.sqlite3'),
  ], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, logName),
    parseJson: true,
  }).payload;
}

function sqliteLogicalSnapshot(context, databasePath, logName) {
  const code = `
import hashlib
import json
import sqlite3
import sys

def encode(value):
    if isinstance(value, bytes):
        return {"$bytes": value.hex()}
    return value

conn = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
schema = [tuple(row) for row in conn.execute(
    "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
)]
tables = {}
for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    quoted = '"' + name.replace('"', '""') + '"'
    encoded_rows = [
        json.dumps([encode(value) for value in row], ensure_ascii=False, separators=(",", ":"))
        for row in conn.execute(f"SELECT * FROM {quoted}")
    ]
    encoded_rows.sort()
    payload = "[" + ",".join(encoded_rows) + "]"
    tables[name] = {
        "rows": len(encoded_rows),
        "sha256": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
    }
snapshot = {"schema": schema, "tables": tables}
canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
print(json.dumps({
    "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    "schemaSha256": hashlib.sha256(json.dumps(schema, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
    "tables": tables,
}, sort_keys=True))
`.trim();
  return runLogged(context.astridPython, ['-c', code, databasePath], {
    cwd: context.astridSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, logName),
    parseJson: true,
  }).payload;
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
  const assertFailure = async (label, requestHeaders, status, code) => {
    const response = await requestRawHttp(`http://127.0.0.1:${port}/health`, {
      headers: requestHeaders,
      redirect: 'manual',
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (
      response.status !== status
      || response.headers.get('x-astrid-bridge-version') !== 'v1'
      || payload?.error !== code
    ) {
      fail(`${label} returned ${response.status}/${payload?.error ?? '<no-code>'}, expected ${status}/${code}`);
    }
  };
  await assertFailure(
    'missing bearer',
    { 'X-Astrid-Bridge-Version': 'v1' },
    401,
    'unauthorized',
  );
  await assertFailure(
    'wrong bearer',
    { Authorization: 'Bearer definitely-wrong', 'X-Astrid-Bridge-Version': 'v1' },
    401,
    'unauthorized',
  );
  await assertFailure(
    'missing protocol version',
    { Authorization: `Bearer ${token}` },
    426,
    'protocol_version_mismatch',
  );
  await assertFailure(
    'wrong protocol version',
    { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v0' },
    426,
    'protocol_version_mismatch',
  );
  await assertFailure(
    'disallowed origin',
    { ...headers, Origin: 'https://attacker.invalid' },
    403,
    'forbidden',
  );
  await assertFailure(
    'disallowed host',
    { ...headers, Host: 'attacker.invalid' },
    403,
    'forbidden',
  );
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
    headers: {
      Authorization: 'Bearer attacker-controlled-value-must-be-replaced',
      'X-Astrid-Bridge-Version': 'v0',
    },
    cache: 'no-store',
  });
  if (!proxy.ok) fail(`built preview authenticated same-origin proxy returned ${proxy.status}`);
  if (proxy.headers.get('x-astrid-bridge-version') !== 'v1') {
    fail('built preview proxy did not preserve the authenticated upstream protocol response');
  }
  return {
    config,
    proxyStatus: proxy.status,
    proxyReplacedClientAuthorization: true,
    proxyReplacedClientProtocolVersion: true,
  };
}

function runPlaywright(context, phase, port) {
  const cli = resolve(context.reighSnapshot, 'node_modules/@playwright/test/cli.js');
  return runLogged(process.execPath, [
    cli, 'test', '--config', 'playwright.paired-release.config.ts', '--workers=1',
  ], {
    cwd: context.reighSnapshot,
    env: buildBrowserEnvironment({
      baseUrl: `http://127.0.0.1:${port}`,
      browserExecutable: context.browserExecutable,
      browserRoot: context.browserRoot,
      evidenceDir: context.evidenceRoot,
      phase,
    }),
    logPath: resolve(context.evidenceRoot, `playwright-${phase}.log`),
  });
}

function parseRate(value) {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number);
  return numerator > 0 && denominator > 0 ? numerator / denominator : Number.NaN;
}

function verifyRenderedArtifact(context) {
  const outputPath = resolve(context.evidenceRoot, 'paired-release-render.mp4');
  const browserReceipt = JSON.parse(readFileSync(
    resolve(context.evidenceRoot, 'render-browser-receipt.json'),
    'utf8',
  ));
  const restartState = JSON.parse(readFileSync(
    resolve(context.evidenceRoot, 'browser-restart-state.json'),
    'utf8',
  ));
  if (browserReceipt.persistedStateHash !== restartState.timelineStateHash) {
    fail('render receipt is not bound to the exact persisted restart state');
  }
  if (browserReceipt.sha256 !== sha256File(outputPath)) {
    fail('downloaded render hash changed between browser and media verification');
  }
  const probe = runLogged('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height,avg_frame_rate,nb_frames,duration:format=duration',
    '-of', 'json',
    outputPath,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, 'render-ffprobe.json'),
    parseJson: true,
  }).payload;
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  const fps = parseRate(video?.avg_frame_rate);
  const duration = Number(video?.duration ?? probe?.format?.duration);
  const frames = Number(video?.nb_frames);
  const expectedFps = Number(browserReceipt.expectedFps);
  const expectedDuration = Number(browserReceipt.expectedDuration);
  if (
    video?.codec_name !== 'h264'
    || video?.width !== 1280
    || video?.height !== 720
    || fps !== expectedFps
    || !Number.isInteger(frames)
    || Math.abs(frames - Math.round(expectedDuration * expectedFps)) > 1
    || !Number.isFinite(duration)
    || Math.abs(duration - expectedDuration) > (1 / expectedFps)
  ) {
    fail(`render stream contract mismatch: ${JSON.stringify({ video, expectedFps, expectedDuration })}`);
  }
  if (audio && audio.codec_name !== 'aac') {
    fail(`render audio codec is not AAC: ${audio.codec_name}`);
  }
  runLogged('ffmpeg', ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, 'render-full-decode.log'),
  });
  const captionMidpoints = Array.isArray(browserReceipt.captionMidpoints)
    ? browserReceipt.captionMidpoints.slice(0, 2).map(Number)
    : [];
  if (captionMidpoints.length < 2 || captionMidpoints.some((value) => !Number.isFinite(value))) {
    fail('render receipt has fewer than two caption midpoint semantic probes');
  }
  const frameHashes = captionMidpoints.map((seconds, index) => {
    const framePath = resolve(context.runtimeRoot, `caption-proof-${index}.png`);
    runLogged('ffmpeg', [
      '-v', 'error', '-ss', String(seconds), '-i', outputPath, '-frames:v', '1', '-y', framePath,
    ], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment(),
      logPath: resolve(context.evidenceRoot, `render-caption-frame-${index}.log`),
    });
    return { seconds, sha256: sha256File(framePath) };
  });
  if (new Set(frameHashes.map((entry) => entry.sha256)).size !== frameHashes.length) {
    fail('caption midpoint frames are byte-identical; rendered caption semantics were not demonstrated');
  }
  const verification = {
    schemaVersion: 1,
    persistedStateHash: browserReceipt.persistedStateHash,
    mp4Sha256: browserReceipt.sha256,
    bytes: browserReceipt.bytes,
    video: {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps,
      frames,
      duration,
    },
    audioCodec: audio?.codec_name ?? null,
    fullDecode: true,
    captionFrameHashes: frameHashes,
  };
  writeFileSync(
    resolve(context.evidenceRoot, 'render-verification.json'),
    `${JSON.stringify(verification, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return verification;
}

async function executeGate(manifest, pins, evidenceRoot) {
  const runtimeRoot = mkdtempSync(resolve(tmpdir(), 'reigh-paired-release-runtime-'));
  chmodSync(runtimeRoot, 0o700);
  const context = {
    ...pins,
    bootstrapAstridPython: pins.astridPython,
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
    reighControllerHead: pins.reighControllerHead,
    reighTagObject: pins.reighTagObject,
    reighEvidencePaths: pins.reighProvenance.changedPaths,
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
  let cleanupError;
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
    const browser = resolvePinnedBrowser(context);
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
    receipt.phases.push({ id: 'reigh-build', status: 'pass', browser });

    const astridRuntime = installLockedAstridRuntime(context);
    receipt.phases.push({ id: 'astrid-locked-runtime', status: 'pass', ...astridRuntime });

    seedDemoProject(context);
    const baselineDbCounts = sqliteCountSnapshot(context, 'astrid-pre-migration-counts.log');
    const backupDir = resolve(runtimeRoot, 'pre-migration-backup');
    const backup = astridCommand(context, [
      'backup', 'create', '--projects-root', context.projectsRoot, '--out', backupDir, '--json',
    ], 'astrid-backup-create.log').payload;
    if (backup?.ok !== true || !existsSync(resolve(backupDir, 'backup.json'))) fail('Astrid pre-migration backup was not published');
    const baselineDbSnapshot = sqliteLogicalSnapshot(
      context,
      resolve(context.projectsRoot, '.astrid/astrid.sqlite3'),
      'astrid-pre-migration-logical-snapshot.json',
    );
    const backupDbSnapshot = sqliteLogicalSnapshot(
      context,
      resolve(backupDir, 'astrid.sqlite3'),
      'astrid-backup-logical-snapshot.json',
    );
    if (JSON.stringify(backupDbSnapshot) !== JSON.stringify(baselineDbSnapshot)) {
      fail(`backup logical database snapshot differs from baseline: ${JSON.stringify({ baselineDbSnapshot, backupDbSnapshot })}`);
    }
    const baselineMediaSnapshot = fileTreeSnapshot(resolve(context.projectsRoot, '.astrid/media'));
    const backupMediaSnapshot = fileTreeSnapshot(resolve(backupDir, 'media'));
    writeFileSync(
      resolve(evidenceRoot, 'astrid-backup-media-snapshots.json'),
      `${JSON.stringify({ baseline: baselineMediaSnapshot, backup: backupMediaSnapshot }, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    if (JSON.stringify(backupMediaSnapshot) !== JSON.stringify(baselineMediaSnapshot)) {
      fail(`backup managed-media snapshot differs from baseline: ${JSON.stringify({ baselineMediaSnapshot, backupMediaSnapshot })}`);
    }
    const migration = runMigrationTwice(context);
    receipt.runawayFixtureHashes = migration.fixtureHashes;
    receipt.phases.push({
      id: 'migrate-twice',
      status: 'pass',
      storedCount: migration.second.stored_count,
      evidenceCount: migration.second.evidence_count,
      fixtureHashes: migration.fixtureHashes,
    });

    let bridgePort = await allocatePort();
    astridHandle = await startAstrid(context, 'preview', bridgePort, token);
    let reighPort = await allocatePort();
    reighHandle = await startReigh(context, 'preview', reighPort, bridgePort, token, 'preview');
    const preview = await smokeBuiltPreview(reighPort);
    receipt.phases.push({ id: 'built-preview-auth-proxy', status: 'pass', ...preview });
    await stopLoggedProcesses([reighHandle, astridHandle]);
    reighHandle = undefined;
    astridHandle = undefined;

    bridgePort = await allocatePort();
    astridHandle = await startAstrid(context, 'browser-first', bridgePort, token);
    reighPort = await allocatePort();
    reighHandle = await startReigh(context, 'browser-first', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'first', reighPort);
    receipt.phases.push({ id: 'browser-first', status: 'pass' });
    await stopLoggedProcesses([reighHandle, astridHandle]);
    reighHandle = undefined;
    astridHandle = undefined;

    bridgePort = await allocatePort();
    astridHandle = await startAstrid(context, 'browser-restart', bridgePort, token);
    reighPort = await allocatePort();
    reighHandle = await startReigh(context, 'browser-restart', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'restart', reighPort);
    const renderVerification = verifyRenderedArtifact(context);
    receipt.phases.push({
      id: 'restart-persistence-render',
      status: 'pass',
      persistedStateHash: renderVerification.persistedStateHash,
      mp4Sha256: renderVerification.mp4Sha256,
      videoFrames: renderVerification.video.frames,
      fullDecode: true,
    });
    await stopLoggedProcesses([reighHandle, astridHandle]);
    reighHandle = undefined;
    astridHandle = undefined;

    astridCommand(context, [
      'backup', 'restore', backupDir, '--projects-root', context.projectsRoot, '--force', '--json',
    ], 'astrid-backup-restore.log');
    const restoredDbCounts = sqliteCountSnapshot(context, 'astrid-restored-counts.log');
    if (JSON.stringify(restoredDbCounts) !== JSON.stringify(baselineDbCounts)) {
      fail(`restore database counts differ from baseline: ${JSON.stringify({ baselineDbCounts, restoredDbCounts })}`);
    }
    const restoredDbSnapshot = sqliteLogicalSnapshot(
      context,
      resolve(context.projectsRoot, '.astrid/astrid.sqlite3'),
      'astrid-restored-logical-snapshot.json',
    );
    if (JSON.stringify(restoredDbSnapshot) !== JSON.stringify(baselineDbSnapshot)) {
      fail(`restore logical database snapshot differs from baseline: ${JSON.stringify({ baselineDbSnapshot, restoredDbSnapshot })}`);
    }
    const restoredMediaSnapshot = fileTreeSnapshot(resolve(context.projectsRoot, '.astrid/media'));
    writeFileSync(
      resolve(evidenceRoot, 'astrid-restored-media-snapshot.json'),
      `${JSON.stringify(restoredMediaSnapshot, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    if (JSON.stringify(restoredMediaSnapshot) !== JSON.stringify(baselineMediaSnapshot)) {
      fail(`restore managed-media snapshot differs from baseline: ${JSON.stringify({ baselineMediaSnapshot, restoredMediaSnapshot })}`);
    }
    const doctor = astridCommand(context, [
      'doctor', '--projects-root', context.projectsRoot, '--json',
    ], 'astrid-restore-doctor.log').payload;
    if (doctor?.ok !== true || !Array.isArray(doctor.checks) || doctor.checks.some((check) => check.status !== 'ok')) {
      fail(`Astrid doctor failed after restore: ${JSON.stringify(doctor)}`);
    }
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
    astridHandle = await startAstrid(context, 'restore', bridgePort, token);
    reighPort = await allocatePort();
    reighHandle = await startReigh(context, 'restore', reighPort, bridgePort, token, 'development');
    runPlaywright(context, 'restore', reighPort);
    receipt.phases.push({
      id: 'rollback-restore',
      status: 'pass',
      runawayRows: restoredRows,
      baselineDbCounts,
      restoredDbCounts,
      baselineDbSha256: baselineDbSnapshot.sha256,
      restoredDbSha256: restoredDbSnapshot.sha256,
      baselineMediaSha256: baselineMediaSnapshot.sha256,
      restoredMediaSha256: restoredMediaSnapshot.sha256,
      doctorChecks: doctor.checks.length,
    });

    receipt.status = 'pass';
  } catch (error) {
    receipt.error = error.message;
    throw error;
  } finally {
    try {
      await stopLoggedProcesses([reighHandle, astridHandle]);
    } catch (error) {
      cleanupError = error;
      receipt.status = 'failed';
      receipt.error = receipt.error
        ? `${receipt.error}; cleanup: ${error.message}`
        : `cleanup: ${error.message}`;
    }
    receipt.finishedAt = new Date().toISOString();
    try {
      writeFileSync(resolve(evidenceRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      const indexedFiles = listFiles(evidenceRoot);
      const indexPath = resolve(evidenceRoot, 'artifact-index.json');
      writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, files: indexedFiles }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      const artifactIndexSha256 = sha256File(indexPath);
      freezeArtifacts(evidenceRoot);
      console.log(`${LABEL} evidence=${evidenceRoot}`);
      console.log(`${LABEL} artifact-index-sha256=${artifactIndexSha256}`);
    } finally {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }
  if (cleanupError) throw cleanupError;
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
    };
    const receiptPath = resolve(evidenceRoot, 'receipt.json');
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const indexPath = resolve(evidenceRoot, 'artifact-index.json');
    writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, files: listFiles(evidenceRoot) }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const artifactIndexSha256 = sha256File(indexPath);
    freezeArtifacts(evidenceRoot);
    console.error(`${LABEL} evidence=${evidenceRoot}`);
    console.error(`${LABEL} artifact-index-sha256=${artifactIndexSha256}`);
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
