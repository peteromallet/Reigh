#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
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
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertCleanReleaseCheckout,
  inspectCandidateController,
  resolveAnnotatedCandidateTag,
} from './reigh-release-provenance.mjs';
import { PROCESS_SCOPE_ENV_KEY, runBoundedCommand } from './bounded-command.mjs';
import {
  assertPinnedPlatform,
  attestNativeTools,
  buildContainerBoundaryAttestation,
  resolvePinnedExecutable,
} from './native-tool-attestation.mjs';
import { assertHeavyStepDiskCapacity } from './verify-extension-ship.mjs';

const LABEL = '[paired-release-e2e]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const MANIFEST_PATH = resolve(REPO_ROOT, 'config/releases/extension-ship-quality.json');
export const EXPECTED_EXTENSION_COUNT = 13;
export const EXPECTED_RUNAWAY_COUNT = 566;
export const RELEASE_BRIDGE_CAPABILITY = 'astrid.authenticated-release-bridge.v1';
export const PAIRED_RENDER_WORKER_CAPABILITY = 'rendering.render';
export const PAIRED_RENDER_WORKER_DEADLINE_MS = 14 * 60_000;
export const TIMELINE_SCHEMA_DISTRIBUTION_VERSION = '0.0.2';
export const RUNAWAY_RELEASE_FIXTURE_HASHES = Object.freeze({
  'audio-reactive-v1.json': 'd7925d72b52180e206a2511a5d30cf1638c7007a962fd57d8a6eb9ffb10af886',
  'timing-manifest.json': '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
});
export const PAIRED_RELEASE_MEDIA_FIXTURE = 'tests/e2e/fixtures/paired-release/paired-release-test-card.png';
export const PAIRED_RELEASE_MEDIA_METADATA = 'tests/e2e/fixtures/paired-release/paired-release-test-card.json';
export const PAIRED_RELEASE_AUDIO_FIXTURE = 'public/motion-output-audio.aac';
export const PAIRED_RELEASE_AUDIO_EXPECTED = Object.freeze({
  sha256: '2ed05a66ecf1cd5a2da308f507e02d99d86f52a0a5848f158983cb4b7b2ec8c2',
  sizeBytes: 457_980,
  bridgeMimeType: 'audio/x-aac',
  registryMimeType: 'audio/aac',
  formatName: 'aac',
  codecName: 'aac',
  profile: 'LC',
  sampleRate: 44_100,
  channels: 2,
  channelLayout: 'stereo',
  durationSeconds: 39.156558,
});
export const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const COMMAND_BUDGETS_MS = Object.freeze({
  fastProbe: 30_000,
  git: 60_000,
  archive: 2 * 60_000,
  npm: 10 * 60_000,
  pip: 20 * 60_000,
  playwright: 15 * 60_000,
  migration: 5 * 60_000,
  backup: 5 * 60_000,
  sqlite: 30_000,
  ffmpeg: 3 * 60_000,
  ffprobe: 60_000,
  tesseract: 60_000,
  magick: 60_000,
});
// Backwards-compatible command-family view for release tooling that consumed
// the pre-helper timeout export. New call sites should use phase budgets.
export const COMMAND_TIMEOUTS_MS = Object.freeze({
  npm: COMMAND_BUDGETS_MS.npm,
  'npm ci': COMMAND_BUDGETS_MS.npm,
  'npm run build': COMMAND_BUDGETS_MS.npm,
  'playwright install': COMMAND_BUDGETS_MS.playwright,
  ffmpeg: COMMAND_BUDGETS_MS.ffmpeg,
  ffprobe: COMMAND_BUDGETS_MS.ffprobe,
  magick: COMMAND_BUDGETS_MS.magick,
  tesseract: COMMAND_BUDGETS_MS.tesseract,
});
export const COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
export function assertPairedReleaseDiskCapacity({ astridCheckout, tempPath = tmpdir() }, dependencies = {}) {
  return assertHeavyStepDiskCapacity(
    { id: 'paired-release-e2e' },
    { astridCheckout, tempPath },
    dependencies,
  ).map(({ availableBytes, requiredBytes, ...measurement }) => Object.freeze({
    ...measurement,
    availableBytes: availableBytes.toString(),
    requiredBytes: requiredBytes.toString(),
  }));
}

const DEMO_PROJECT = 'paired-release-demo';
const DEMO_TIMELINE = 'paired-release-timeline';
const RUNAWAY_PROJECT = 'runaway-piano-colour-demo';
export const PAIRED_RELEASE_TIMELINE_CONFIG = Object.freeze({
  output: { resolution: '1280x720', fps: 24, file: 'paired-release-output.mp4' },
  clips: [
    { id: 'paired-release-clip', track: 'V1', at: 0, clipType: 'media', hold: 4, asset: 'paired-release-test-card.png' },
    { id: 'paired-release-audio', track: 'A1', at: 0, clipType: 'media', hold: 8, asset: 'motion-output-audio.aac' },
  ],
  tracks: [
    { id: 'V1', kind: 'visual', label: 'Video' },
    { id: 'V2', kind: 'visual', label: 'Video 2' },
    { id: 'A1', kind: 'audio', label: 'Audio' },
  ],
});

export function buildPairedReleaseRegistry({ mediaId, audioMediaId } = {}) {
  if (typeof mediaId !== 'string' || !mediaId || typeof audioMediaId !== 'string' || !audioMediaId) {
    fail('paired release registry requires exact image and audio media IDs');
  }
  return Object.freeze({
    assets: Object.freeze({
      'paired-release-test-card.png': Object.freeze({
        file: 'paired-release-test-card.png',
        media_id: mediaId,
        type: 'image/png',
      }),
      'motion-output-audio.aac': Object.freeze({
        file: 'motion-output-audio.aac',
        media_id: audioMediaId,
        type: PAIRED_RELEASE_AUDIO_EXPECTED.registryMimeType,
      }),
    }),
  });
}
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

const SERVER_SCOPE_PREFIX = `${PROCESS_SCOPE_ENV_KEY}_`;
const SERVER_SCOPE_QUIESCENCE_SCANS = 3;
const SERVER_SCOPE_SCAN_DELAY_MS = 40;
const SERVER_SCOPE_SCAN_TIMEOUT_MS = 1_000;
const SERVER_SCOPE_SCAN_OUTPUT_CAP = 8 * 1024 * 1024;
const SERVER_SUPERVISOR_ARG = '--paired-server-supervisor';
const SERVER_PS_PATH = process.platform === 'darwin' ? '/bin/ps' : '/usr/bin/ps';
const SERVER_SUPERVISOR_READY_TIMEOUT_MS = 3_000;

function commandBudgetKey(command, args = [], requested) {
  if (typeof requested === 'string' && Object.hasOwn(COMMAND_BUDGETS_MS, requested)) return requested;
  const base = String(command).split(/[\\/]/).at(-1) ?? String(command);
  const joined = args.map(String).join(' ');
  if (base === 'npm'
    || (/^node(?:\.exe)?$/i.test(base) && /(?:^|[\\/])npm-cli\.js$/.test(String(args[0] ?? '')))) return 'npm';
  if (base === 'ffmpeg') return 'ffmpeg';
  if (base === 'ffprobe') return 'ffprobe';
  if (base === 'magick' || base === 'convert') return 'magick';
  if (base === 'tesseract') return 'tesseract';
  if (base === 'tar' || (base === 'git' && /\barchive\b/.test(joined))) return 'archive';
  if (base === 'git') return 'git';
  if (/playwright|@playwright|playwright\.config/i.test(joined)) return 'playwright';
  if (/(^|\s)-m\s+pip\b/.test(joined)) return 'pip';
  if (/\b(runaway_v1_migrate|migrate|migration)\b/i.test(joined)) return 'migration';
  if (/\bbackup\b|\brestore\b/i.test(joined)) return 'backup';
  if (/sqlite|sqlite3/i.test(joined)) return 'sqlite';
  return 'fastProbe';
}

export function commandTimeout(command, args, requested) {
  if (Number.isFinite(requested) && requested > 0) return requested;
  const budgetKey = commandBudgetKey(command, args, requested);
  return COMMAND_BUDGETS_MS[budgetKey] ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

class UsageError extends Error {}

class ReleaseCommandError extends Error {
  constructor(message, result, diagnosticsPath) {
    super(message);
    this.name = 'ReleaseCommandError';
    this.result = result;
    this.diagnosticsPath = diagnosticsPath ?? null;
  }
}

function commandDiagnosticSummary(error) {
  const result = error.result;
  return {
    failureType: result.failureType,
    label: result.label,
    command: result.command,
    args: result.args,
    cwd: result.cwd,
    timeoutMs: result.timeoutMs,
    maxBuffer: result.maxBuffer,
    killSignal: result.killSignal,
    elapsedMs: result.elapsedMs,
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdoutTail: String(result.stdout ?? '').slice(-3_000),
    stderrTail: String(result.stderr ?? '').slice(-3_000),
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    diagnosticsPath: error.diagnosticsPath,
  };
}

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
  readinessIdentity,
  nodeExecutable,
  remotionProjectDir,
  timelineSchemaPythonpath,
}) {
  if (!token || typeof token !== 'string') fail('server token must be non-empty');
  const shared = safeBaseEnvironment({
    HOME: home,
    TMPDIR: tmpdir(),
    ASTRID_PROJECTS_ROOT: projectsRoot,
    PYTHONPATH: pythonPath,
    ...(nodeExecutable ? { ASTRID_NODE_EXECUTABLE: nodeExecutable } : {}),
    ...(remotionProjectDir ? { ASTRID_REMOTION_PROJECT_DIR: remotionProjectDir } : {}),
    ...(timelineSchemaPythonpath ? { ASTRID_TIMELINE_SCHEMA_PYTHONPATH: timelineSchemaPythonpath } : {}),
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
    EXTENSION_RELEASE_CONFIG_REVISION: readinessIdentity ?? `paired-${reighMode}`,
  };
}

export function buildReadinessIdentity({ nonce, reighCommit }) {
  if (!/^[0-9a-f]{8}$/.test(nonce ?? '')) fail('readiness nonce must be eight lowercase hexadecimal characters');
  if (!/^[0-9a-f]{40}$/.test(reighCommit ?? '')) fail('readiness candidate must be a full commit pin');
  return `paired-${nonce}-${reighCommit}`;
}

export function isExactViteReadiness(payload, expectedIdentity) {
  return JSON.stringify(payload) === JSON.stringify({
    schemaVersion: 1,
    revision: expectedIdentity,
    extensions: {
      hostEnabled: true,
      transcriptCaptionFoundryEnabled: true,
      runawayTypedTimelineEnabled: true,
    },
  });
}

export function buildViteArgs(viteBin, mode, port) {
  return mode === 'preview'
    ? [viteBin, 'preview', '--config', 'config/vite/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : [viteBin, '--config', 'config/vite/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
}

export function buildBrowserEnvironment({ baseUrl, browserExecutable, browserRoot, evidenceDir, phase, audioMediaId }) {
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
    ...(audioMediaId ? { PAIRED_RELEASE_AUDIO_MEDIA_ID: audioMediaId } : {}),
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

export function validateAstridRenderWorkerSources({
  adapterSource,
  capabilitySource,
  taskBridgeSource,
  remotionRuntimeSource = '',
  envSource = '',
  remotionPackageSource = '',
  remotionLockSource = '',
}) {
  const missing = [];
  if (!/class\s+RenderExportTaskAdapter/.test(adapterSource ?? '')) missing.push('RenderExportTaskAdapter');
  if (!/execute_render_export_task/.test(adapterSource ?? '')) missing.push('bounded render adapter entrypoint');
  if (!/rendering\.render/.test(capabilitySource ?? '')) missing.push('rendering.render capability');
  if (!/timeline_snapshot/.test(taskBridgeSource ?? '')) missing.push('frozen timeline snapshot admission');
  if (!/ASTRID_REMOTION_PROJECT_DIR/.test(envSource + remotionRuntimeSource)) missing.push('server-owned Remotion project env');
  if (!/ASTRID_NODE_EXECUTABLE/.test(envSource + remotionRuntimeSource)) missing.push('server-owned Node executable env');
  if (!/ASTRID_TIMELINE_SCHEMA_PYTHONPATH/.test(envSource + remotionRuntimeSource)) missing.push('server-owned timeline-schema env');
  if (!/remotion_runtime_status/.test(remotionRuntimeSource ?? '')) missing.push('Remotion runtime readiness probe');
  if (!/REMOTION_CLI_RELATIVE_PATH/.test(remotionRuntimeSource ?? '')) missing.push('locked local Remotion CLI resolution');
  if (!/"name"\s*:\s*"tools-remotion"/.test(remotionPackageSource ?? '')) missing.push('pinned Remotion package manifest');
  if (!/"lockfileVersion"\s*:\s*3/.test(remotionLockSource ?? '')) missing.push('pinned Remotion npm lockfile');
  if (missing.length > 0) {
    fail(
      `Astrid pin lacks the paired render worker contract: ${missing.join(', ')}. `
      + 'Repin only to a clean settled Astrid commit containing the reviewed render adapter.',
    );
  }
  return Object.freeze({ capability: PAIRED_RENDER_WORKER_CAPABILITY });
}

function commandFailure(command, args, result, diagnosticsPath) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const detail = result.failureType === 'timeout'
    ? `timed out after ${result.timeoutMs}ms; kill=${result.killSignal}`
    : result.failureType === 'output-cap'
      ? `exceeded output cap ${result.maxBuffer} bytes`
      : result.failureType === 'signal'
        ? `terminated by ${result.signal ?? 'unknown signal'}`
        : result.failureType === 'stderr'
          ? 'wrote unexpected stderr'
        : result.failureType === 'spawn-error'
          ? `failed to spawn${result.error?.code ? ` (${result.error.code})` : ''}`
          : result.error?.message ?? `failed with exit ${result.status ?? 'unknown'}`;
  const safeCommand = typeof result.command === 'string' ? result.command : command;
  const safeArgs = Array.isArray(result.args) ? result.args : args;
  return `${safeCommand} ${safeArgs.join(' ')} ${detail}${output ? `: ${output.slice(-3000)}` : ''}${diagnosticsPath ? `; diagnostics=${diagnosticsPath}` : ''}`;
}

export function capture(command, args, {
  cwd,
  env,
  allowFailure = false,
  input,
  timeoutMs,
  phase = 'unscoped-command',
  diagnosticsPath,
  budgetKey,
  redactEnvValues = true,
  structuredOutput,
} = {}) {
  const budget = commandTimeout(command, args, timeoutMs ?? budgetKey);
  const result = runBoundedCommand(command, args, {
    cwd,
    env: env ?? safeBaseEnvironment(),
    input,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeoutMs: budget,
    killSignal: 'SIGKILL',
    allowFailure: true,
    label: phase,
    redactEnvValues,
    structuredOutput,
  });
  const failed = !result.ok;
  if (failed && diagnosticsPath) {
    const diagnostic = `${JSON.stringify({
      schemaVersion: 1,
      kind: 'bounded-command-diagnostic',
      command: result.command,
      args: result.args,
      phase,
      timeoutMs: budget,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      failureType: result.failureType,
      signal: result.signal ?? null,
      error: result.error ?? null,
      elapsedMs: result.elapsedMs,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      stdoutTail: String(result.stdout ?? '').slice(-3_000),
      stderrTail: String(result.stderr ?? '').slice(-3_000),
    })}\n`;
    writeFileSync(diagnosticsPath, diagnostic, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  if (!allowFailure && failed) {
    throw new ReleaseCommandError(commandFailure(command, args, result, diagnosticsPath), result, diagnosticsPath);
  }
  return result;
}

function gitOutput(checkout, args) {
  return capture('git', args, { cwd: checkout }).stdout.trim();
}

function pinnedSource(checkout, commit, path) {
  const result = capture('git', ['show', `${commit}:${path}`], {
    cwd: checkout,
    allowFailure: true,
    phase: `pinned-source:${path}`,
  });
  if (result.status !== 0) fail(`Astrid pin is missing required source: ${path}`);
  return result.stdout;
}

/** Resolve npm's executable bin wrapper; never execute its env-node shebang. */
export function resolvePinnedNpmCli(npmExecutable) {
  if (!npmExecutable || !isAbsolute(npmExecutable) || !existsSync(npmExecutable)) {
    fail(`pinned npm executable is not an existing absolute file: ${npmExecutable ?? '<missing>'}`);
  }
  const shim = realpathSync(npmExecutable);
  const source = readFileSync(shim, 'utf8');
  const required = source.match(/require\(['"]([^'"]+)['"]\)/)?.[1];
  if (!required || !required.endsWith('.js') || required.startsWith('node:')) {
    fail(`pinned npm executable does not disclose a local CLI JavaScript target: ${shim}`);
  }
  const internalCli = realpathSync(resolve(dirname(shim), required));
  const npmRoot = resolve(dirname(shim), '..');
  if (!internalCli.startsWith(`${npmRoot}${sep}`) || !statSync(internalCli).isFile()) {
    fail(`pinned npm internal CLI escaped the npm installation root: ${internalCli}`);
  }
  // The bin wrapper invokes the internal target with npm's required process
  // bootstrap. Calling lib/cli.js directly is a false-success trap: it only
  // exports a function and does not implement npm's command lifecycle.
  return shim;
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
  const mediaFixture = validateMediaFixture({
    fixturePath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_FIXTURE),
    metadataPath: resolve(REPO_ROOT, PAIRED_RELEASE_MEDIA_METADATA),
    gitCheckout: REPO_ROOT,
    gitRef: reighCommit,
  });
  const audioFixture = validateAudioFixture({
    fixturePath: resolve(REPO_ROOT, PAIRED_RELEASE_AUDIO_FIXTURE),
    expectedRoot: REPO_ROOT,
    gitCheckout: REPO_ROOT,
    gitRef: reighCommit,
  });
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
  const renderWorker = validateAstridRenderWorkerSources({
    adapterSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'astrid/packs/rendering/executors/render/task_adapter.py',
    ),
    capabilitySource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'astrid/core/integrations/reigh/capabilities.py',
    ),
    taskBridgeSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'astrid/core/integrations/reigh/task_bridge.py',
    ),
    remotionRuntimeSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'astrid/core/integrations/reigh/remotion_runtime.py',
    ),
    envSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'astrid/core/env_vars.py',
    ),
    remotionPackageSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'remotion/package.json',
    ),
    remotionLockSource: pinnedSource(
      resolvedAstridCheckout,
      manifestAstridCommit,
      'remotion/package-lock.json',
    ),
  });
  const nodeVersion = process.version.replace(/^v/, '');
  if (nodeVersion !== manifest.verification.node) {
    fail(`Node version mismatch: expected ${manifest.verification.node}, got ${nodeVersion}`);
  }
  const npmExecutable = resolvePinnedExecutable('npm', { pathValue: env.PATH ?? process.env.PATH });
  const nodeExecutable = realpathSync(process.execPath);
  const npmCliJs = resolvePinnedNpmCli(npmExecutable);
  const npmVersion = capture(nodeExecutable, [npmCliJs, '--version'], { cwd: REPO_ROOT }).stdout.trim();
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
    renderWorkerCapability: renderWorker.capability,
    reighControllerHead: reighHead,
    reighCommit,
    reighProvenance,
    reighTagObject: reighTag.tagObject,
    audioFixture,
    mediaFixture,
    nodeVersion,
    npmVersion,
    npmExecutable,
    npmCliJs,
    nodeExecutable,
    astridPythonVersion: pythonIdentity.version,
  });
}

export function preflightNativeToolchain({ manifest, env = process.env, pins = {} }) {
  const pathValue = env.PATH ?? process.env.PATH;
  const attestation = attestNativeTools({
    manifest,
    pathValue,
    run(command, args, label) {
      return capture(command, args, {
        cwd: REPO_ROOT,
        env: safeBaseEnvironment({ PATH: pathValue }),
        allowFailure: true,
        phase: `native-toolchain:${label}`,
      });
    },
  });
  const pinnedPlatform = assertPinnedPlatform(manifest, attestation.platform);
  const nodeExecutable = realpathSync(pins.nodeExecutable ?? process.execPath);
  const npmExecutable = pins.npmExecutable ?? resolvePinnedExecutable('npm', { pathValue });
  const npmCliJs = pins.npmCliJs ?? resolvePinnedNpmCli(npmExecutable);
  const runtime = {
    node: {
      executable: nodeExecutable,
      executableSha256: `sha256:${sha256File(nodeExecutable)}`,
      version: pins.nodeVersion ?? process.version.replace(/^v/, ''),
    },
    npm: {
      executable: npmExecutable,
      executableSha256: `sha256:${sha256File(npmExecutable)}`,
      cliJs: npmCliJs,
      cliJsSha256: `sha256:${sha256File(npmCliJs)}`,
      version: pins.npmVersion ?? null,
    },
    astridPython: {
      executable: pins.astridPython ? realpathSync(pins.astridPython) : null,
      executableSha256: pins.astridPython ? `sha256:${sha256File(pins.astridPython)}` : null,
      version: pins.astridPythonVersion ?? null,
    },
    platform: pinnedPlatform,
    container: buildContainerBoundaryAttestation(manifest),
  };
  return Object.freeze({ ...attestation, platform: pinnedPlatform, runtime });
}

export const PAIRED_RELEASE_PHASES = Object.freeze([
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
The bearer credential is generated in memory and passed by environment only to
the Astrid server (whose serve-owned worker completes render tasks) and Reigh
proxy server. It is never placed on argv or exposed to the browser. Evidence is retained beneath /tmp and sealed
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

function decodePng(path) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) {
    fail(`media fixture is not a PNG: ${path}`);
  }
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (width === undefined || height === undefined || bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    fail(`unsupported RGB/RGBA PNG shape in ${path}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const decoded = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset++];
      const left = x >= bytesPerPixel ? decoded[rowStart + x - bytesPerPixel] : 0;
      const above = y > 0 ? decoded[rowStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? decoded[rowStart - rowBytes + x - bytesPerPixel] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + above;
      else if (filter === 3) value = raw + Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - above);
        const pc = Math.abs(estimate - upperLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft);
      } else if (filter !== 0) fail(`unsupported PNG filter ${filter} in ${path}`);
      decoded[rowStart + x] = value & 0xff;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = decoded[index * bytesPerPixel];
    pixels[index * 4 + 1] = decoded[index * bytesPerPixel + 1];
    pixels[index * 4 + 2] = decoded[index * bytesPerPixel + 2];
    pixels[index * 4 + 3] = bytesPerPixel === 4 ? decoded[index * bytesPerPixel + 3] : 255;
  }
  return { width, height, pixels };
}

function rgbaAt(image, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= image.width || y >= image.height) {
    fail(`PNG probe is outside image bounds: ${x},${y} for ${image.width}x${image.height}`);
  }
  const index = (y * image.width + x) * 4;
  return [...image.pixels.subarray(index, index + 4)];
}

export function validateMediaFixture({ fixturePath, metadataPath, gitCheckout, gitRef } = {}) {
  if (!fixturePath || !metadataPath || !existsSync(fixturePath) || !existsSync(metadataPath)) {
    fail(`paired media fixture and metadata are required: ${fixturePath}, ${metadataPath}`);
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const image = decodePng(fixturePath);
  const actualSha256 = sha256File(fixturePath);
  if (metadata.schemaVersion !== 1 || metadata.asset !== PAIRED_RELEASE_MEDIA_FIXTURE.split('/').at(-1)
    || metadata.mimeType !== 'image/png' || metadata.sha256 !== actualSha256
    || !Number.isInteger(metadata.width) || metadata.width <= 0
    || !Number.isInteger(metadata.height) || metadata.height <= 0) {
    fail(`paired media fixture metadata/hash mismatch: ${JSON.stringify({ metadata, actualSha256 })}`);
  }
  if (metadata.width !== image.width || metadata.height !== image.height) {
    fail(`paired media fixture dimensions mismatch: metadata=${metadata.width}x${metadata.height}, actual=${image.width}x${image.height}`);
  }
  if (!Array.isArray(metadata.probes) || metadata.probes.length < 4) fail('paired media fixture has insufficient pixel probes');
  const probeNames = new Set();
  for (const probe of metadata.probes) {
    if (typeof probe.name !== 'string' || probeNames.has(probe.name)) fail(`paired media fixture probe name is missing or duplicated: ${probe.name}`);
    probeNames.add(probe.name);
    if (!Array.isArray(probe.expectedRgba) || probe.expectedRgba.length !== 4
      || !probe.expectedRgba.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      fail(`paired media fixture probe ${probe.name} has invalid RGBA bytes`);
    }
    const actual = rgbaAt(image, probe.x, probe.y);
    if (JSON.stringify(actual) !== JSON.stringify(probe.expectedRgba)) {
      fail(`paired media fixture probe ${probe.name} mismatch: expected ${probe.expectedRgba}, got ${actual}`);
    }
  }
  let gitBlobSha;
  let metadataGitBlobSha;
  if (gitCheckout && gitRef) {
    const checkoutRoot = realpathSync(gitCheckout);
    const fixtureRealPath = realpathSync(fixturePath);
    const metadataRealPath = realpathSync(metadataPath);
    const relativePath = relative(checkoutRoot, fixtureRealPath);
    const metadataRelativePath = relative(checkoutRoot, metadataRealPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath) || metadataRelativePath.startsWith('..') || isAbsolute(metadataRelativePath)) {
      fail(`paired media fixture is outside controller checkout: ${fixturePath}`);
    }
    gitBlobSha = gitOutput(gitCheckout, ['rev-parse', `${gitRef}:${relativePath}`]);
    const workingTreeBlobSha = gitOutput(gitCheckout, ['hash-object', '--', relativePath]);
    if (workingTreeBlobSha !== gitBlobSha) fail('working-tree paired media fixture bytes do not match the exact pinned Git blob');
    metadataGitBlobSha = gitOutput(gitCheckout, ['rev-parse', `${gitRef}:${metadataRelativePath}`]);
    const workingTreeMetadataBlobSha = gitOutput(gitCheckout, ['hash-object', '--', metadataRelativePath]);
    if (workingTreeMetadataBlobSha !== metadataGitBlobSha) fail('working-tree paired media metadata does not match the exact pinned Git blob');
  }
  return Object.freeze({
    path: fixturePath,
    metadataPath,
    sha256: actualSha256,
    gitBlobSha,
    metadataGitBlobSha,
    mimeType: metadata.mimeType,
    width: image.width,
    height: image.height,
    probes: metadata.probes,
  });
}

export function validateAudioFixture({ fixturePath, expectedRoot, gitCheckout, gitRef, ffprobeExecutable } = {}) {
  if (!fixturePath || !existsSync(fixturePath) || !statSync(fixturePath).isFile()) {
    fail(`paired audio fixture is required: ${fixturePath}`);
  }
  const actualSha256 = sha256File(fixturePath);
  const actualSizeBytes = statSync(fixturePath).size;
  if (actualSha256 !== PAIRED_RELEASE_AUDIO_EXPECTED.sha256
    || actualSizeBytes !== PAIRED_RELEASE_AUDIO_EXPECTED.sizeBytes) {
    fail(`paired audio fixture hash/size mismatch: ${JSON.stringify({ actualSha256, actualSizeBytes })}`);
  }
  if (expectedRoot) {
    const relativePath = relative(realpathSync(expectedRoot), realpathSync(fixturePath));
    if (relativePath !== PAIRED_RELEASE_AUDIO_FIXTURE) {
      fail(`paired audio fixture path mismatch: expected ${PAIRED_RELEASE_AUDIO_FIXTURE}, got ${relativePath}`);
    }
  }
  let gitBlobSha;
  if (gitCheckout && gitRef) {
    const checkoutRoot = realpathSync(gitCheckout);
    const fixtureRealPath = realpathSync(fixturePath);
    const relativePath = relative(checkoutRoot, fixtureRealPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      fail(`paired audio fixture is outside controller checkout: ${fixturePath}`);
    }
    gitBlobSha = gitOutput(gitCheckout, ['rev-parse', `${gitRef}:${relativePath}`]);
    const workingTreeBlobSha = gitOutput(gitCheckout, ['hash-object', '--', relativePath]);
    if (workingTreeBlobSha !== gitBlobSha) fail('working-tree paired audio fixture bytes do not match the exact pinned Git blob');
  }
  let mediaProperties;
  if (ffprobeExecutable) {
    const probe = capture(ffprobeExecutable, [
      '-v', 'error',
      '-show_entries', 'format=duration,size,format_name:stream=codec_name,codec_type,profile,channels,channel_layout,sample_rate',
      '-of', 'json',
      fixturePath,
    ], { phase: 'paired-audio-fixture-probe' });
    let payload;
    try {
      payload = JSON.parse(probe.stdout);
    } catch {
      fail('paired audio fixture ffprobe returned invalid JSON');
    }
    const audioStreams = Array.isArray(payload?.streams)
      ? payload.streams.filter((stream) => stream?.codec_type === 'audio')
      : [];
    const stream = audioStreams[0];
    const media = {
      formatName: payload?.format?.format_name,
      codecName: stream?.codec_name,
      profile: stream?.profile,
      sampleRate: Number(stream?.sample_rate),
      channels: Number(stream?.channels),
      channelLayout: stream?.channel_layout,
      durationSeconds: Number(payload?.format?.duration),
      sizeBytes: Number(payload?.format?.size),
      audioStreamCount: audioStreams.length,
      streamCount: Array.isArray(payload?.streams) ? payload.streams.length : 0,
    };
    if (media.formatName !== PAIRED_RELEASE_AUDIO_EXPECTED.formatName
      || media.codecName !== PAIRED_RELEASE_AUDIO_EXPECTED.codecName
      || media.profile !== PAIRED_RELEASE_AUDIO_EXPECTED.profile
      || media.sampleRate !== PAIRED_RELEASE_AUDIO_EXPECTED.sampleRate
      || media.channels !== PAIRED_RELEASE_AUDIO_EXPECTED.channels
      || media.channelLayout !== PAIRED_RELEASE_AUDIO_EXPECTED.channelLayout
      || media.durationSeconds !== PAIRED_RELEASE_AUDIO_EXPECTED.durationSeconds
      || media.sizeBytes !== PAIRED_RELEASE_AUDIO_EXPECTED.sizeBytes
      || media.audioStreamCount !== 1
      || media.streamCount !== 1) {
      fail(`paired audio fixture media properties mismatch: ${JSON.stringify(media)}`);
    }
    mediaProperties = Object.freeze(media);
  }
  return Object.freeze({
    path: fixturePath,
    sha256: actualSha256,
    sizeBytes: actualSizeBytes,
    mimeType: PAIRED_RELEASE_AUDIO_EXPECTED.bridgeMimeType,
    gitBlobSha,
    mediaProperties,
  });
}

export function validateImportedAudio(payload) {
  const data = payload?.data;
  const mediaId = data?.id ?? data?.media_id;
  const managedLocations = Array.isArray(data?.locations)
    ? data.locations.filter((location) => location?.realm === 'managed_local' && location?.media_id === mediaId)
    : [];
  if (payload?.ok !== true
    || typeof mediaId !== 'string' || !mediaId
    || data?.media_kind !== 'audio'
    || data?.content_hash !== PAIRED_RELEASE_AUDIO_EXPECTED.sha256
    || data?.byte_size !== PAIRED_RELEASE_AUDIO_EXPECTED.sizeBytes
    || data?.mime_type !== PAIRED_RELEASE_AUDIO_EXPECTED.bridgeMimeType
    || data?.metadata?.rel_path !== PAIRED_RELEASE_AUDIO_FIXTURE.split('/').at(-1)
    || managedLocations.length !== 1) {
    fail(`Astrid audio import contract mismatch: ${JSON.stringify({
      ok: payload?.ok,
      hasMediaId: typeof mediaId === 'string' && Boolean(mediaId),
      mediaKind: data?.media_kind,
      contentHash: data?.content_hash,
      byteSize: data?.byte_size,
      mimeType: data?.mime_type,
      relativePath: data?.metadata?.rel_path,
      managedLocationCount: managedLocations.length,
    })}`);
  }
  return Object.freeze({
    mediaId,
    contentHash: data.content_hash,
    byteSize: data.byte_size,
    mediaKind: data.media_kind,
    mimeType: data.mime_type,
    relativePath: data.metadata.rel_path,
  });
}

export async function verifyBridgeMediaContent({
  baseUrl,
  projectSlug,
  mediaId,
  fixture,
  token,
} = {}) {
  if (!baseUrl || !projectSlug || !mediaId || !fixture?.path) fail('bridge media verification requires base URL, project, media ID, and fixture');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/projects/${encodeURIComponent(projectSlug)}/media/${encodeURIComponent(mediaId)}/content`;
  const response = await requestRawHttp(url, {
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      'X-Astrid-Bridge-Version': 'v1',
    },
  });
  if (response.status !== 200) fail(`bridge media content returned HTTP ${response.status}, expected 200`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const expectedBytes = readFileSync(fixture.path);
  const requiredHeaders = {
    'content-type': fixture.mimeType,
    'content-length': String(expectedBytes.length),
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    'x-astrid-bridge-version': 'v1',
  };
  for (const [name, expected] of Object.entries(requiredHeaders)) {
    if (response.headers.get(name) !== expected) fail(`bridge media content ${name} mismatch: expected ${expected}, got ${response.headers.get(name) ?? '<missing>'}`);
  }
  if (!response.headers.get('etag') || !response.headers.get('last-modified')) fail('bridge media content omitted cache validators');
  if (!bytes.equals(expectedBytes) || createHash('sha256').update(bytes).digest('hex') !== fixture.sha256) {
    fail('bridge media content bytes do not exactly match the committed fixture');
  }
  return Object.freeze({
    url,
    status: response.status,
    bytes: bytes.length,
    sha256: fixture.sha256,
    mimeType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    acceptRanges: response.headers.get('accept-ranges'),
    cacheControl: response.headers.get('cache-control'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  });
}

export function validateRenderedMediaFrame(framePath, fixture, tolerance = 40) {
  const frame = decodePng(framePath);
  if (frame.width !== fixture.width || frame.height !== fixture.height) {
    fail(`rendered media frame geometry mismatch: expected ${fixture.width}x${fixture.height}, got ${frame.width}x${frame.height}`);
  }
  const checks = fixture.probes.map((probe) => {
    const actual = rgbaAt(frame, probe.x, probe.y);
    const error = Math.max(...actual.map((value, index) => Math.abs(value - probe.expectedRgba[index])));
    return { name: probe.name, x: probe.x, y: probe.y, expectedRgba: probe.expectedRgba, actualRgba: actual, maxChannelError: error };
  });
  const failed = checks.filter((probe) => probe.maxChannelError > tolerance);
  if (failed.length > 0) fail(`rendered no-caption media frame does not contain the seeded test card: ${JSON.stringify(failed.slice(0, 3))}`);
  return Object.freeze({ width: frame.width, height: frame.height, tolerance, probes: checks });
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

/** Return a terminal child failure before a readiness loop attempts I/O. */
export function childProcessFailure(child, label = 'child') {
  if (!child) return null;
  const spawnError = child.pairedSpawnError;
  if (spawnError) {
    return `${label} failed to spawn: ${spawnError.message ?? String(spawnError)}`;
  }
  if (child.signalCode) {
    return `${label} exited before readiness via ${child.signalCode}`;
  }
  if (child.exitCode !== null && child.exitCode !== undefined) {
    return `${label} exited before readiness (exit ${child.exitCode})`;
  }
  return null;
}

export async function waitForUrl(url, { headers, process: child, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    const failure = childProcessFailure(child, 'server');
    if (failure) fail(failure);
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
    const failureAfterProbe = childProcessFailure(child, 'server');
    if (failureAfterProbe) fail(failureAfterProbe);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`timed out waiting for ${url}: ${last}`);
}

export async function waitForViteReadiness(baseUrl, { expectedIdentity, process: child, timeoutMs = 120_000 } = {}) {
  const readinessUrl = `${baseUrl}/runtime-config/v1/extensions.json?readiness=${encodeURIComponent(expectedIdentity ?? '')}`;
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    const failure = childProcessFailure(child, 'Vite server');
    if (failure) fail(failure);
    try {
      const response = await fetch(readinessUrl, {
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      if (response.ok && isExactViteReadiness(payload, expectedIdentity)) return response;
      last = `HTTP ${response.status} with non-matching runtime identity`;
    } catch (error) {
      last = error.message;
    }
    const failureAfterProbe = childProcessFailure(child, 'Vite server');
    if (failureAfterProbe) fail(failureAfterProbe);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`timed out waiting for exact Vite readiness at ${readinessUrl}: ${last}`);
}

/**
 * Wait for the contract exposed by the selected Reigh server mode.
 *
 * Production preview serves the generated, fail-closed runtime extension
 * document and must match the paired candidate identity exactly. Development
 * Vite intentionally does not fetch or publish that document: its extension
 * controls default open so local iteration remains fast. Probing the release
 * path in development receives Vite's SPA fallback (HTTP 200 HTML), which is
 * not evidence of a runtime-config mismatch. In that mode the root document is
 * the server-readiness primitive; the browser journey remains responsible for
 * proving the development runtime itself.
 */
export async function waitForReighReadiness(
  baseUrl,
  { mode, expectedIdentity, process: child, timeoutMs = 120_000 } = {},
) {
  if (mode === 'preview') {
    return waitForViteReadiness(baseUrl, {
      expectedIdentity,
      process: child,
      timeoutMs,
    });
  }
  if (mode === 'development') {
    return waitForUrl(`${baseUrl}/`, {
      process: child,
      timeoutMs,
    });
  }
  fail(`unsupported Reigh readiness mode: ${mode ?? '<missing>'}`);
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
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () => {
        const body = Buffer.concat(chunks);
        resolvePromise({
          status: response.statusCode ?? 0,
          headers: {
            get(name) {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : value ?? null;
            },
          },
          async arrayBuffer() {
            return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
          },
          async json() {
            return JSON.parse(body.toString('utf8'));
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

function spawnServerSupervisor({ cwd, scopeKey, scopeToken, parentPid }) {
  const supervisor = spawn(process.execPath, [fileURLToPath(import.meta.url), SERVER_SUPERVISOR_ARG], {
    cwd,
    // The supervisor receives its scope over stdin. Keeping the token out of
    // argv and the supervisor's environment prevents it from appearing in
    // ordinary process listings for the watchdog itself.
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    },
    detached: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  supervisor.unref();
  supervisor.stdin.write(`${JSON.stringify({ scopeKey, scopeToken, parentPid })}\n`);
  return supervisor;
}

async function awaitServerSupervisorReady(supervisor) {
  if (!supervisor?.stdout) throw new Error('server supervisor did not expose a readiness channel');
  supervisor.stdout.setEncoding('utf8');
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      supervisor.stdout.removeListener('data', onData);
      supervisor.removeListener('error', onError);
      supervisor.removeListener('close', onClose);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onData = (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'supervisor-ready') return finish();
          if (message.type === 'supervisor-error') return finish(new Error('server supervisor failed to initialize'));
        } catch { /* wait for the next complete protocol line */ }
      }
    };
    const onError = () => finish(new Error('server supervisor exited before readiness'));
    const onClose = () => finish(new Error('server supervisor exited before readiness'));
    const timer = setTimeout(() => finish(new Error(`server supervisor readiness timed out after ${SERVER_SUPERVISOR_READY_TIMEOUT_MS}ms`)), SERVER_SUPERVISOR_READY_TIMEOUT_MS);
    supervisor.stdout.on('data', onData);
    supervisor.once('error', onError);
    supervisor.once('close', onClose);
  });
}

async function terminateSupervisorProcess(supervisor) {
  if (!supervisor || (supervisor.exitCode !== null && supervisor.exitCode !== undefined) || supervisor.signalCode) return;
  try { supervisor.kill('SIGKILL'); } catch { /* already exited */ }
  await new Promise((resolvePromise) => {
    if (supervisor.exitCode !== null || supervisor.signalCode !== null) resolvePromise();
    else {
      const timer = setTimeout(resolvePromise, SERVER_SUPERVISOR_READY_TIMEOUT_MS);
      supervisor.once('close', () => { clearTimeout(timer); resolvePromise(); });
    }
  });
}

async function releaseServerSupervisor(handle, signal = 'SIGTERM') {
  const supervisor = handle.supervisor;
  if (!supervisor) return;
  if (supervisor.exitCode !== null || supervisor.signalCode !== null) {
    if (supervisor.exitCode !== null && supervisor.exitCode !== 0) {
      throw new Error('server supervisor exited during cleanup');
    }
    return;
  }
  try {
    // Let the watchdog perform one final drain using the observations it has
    // collected throughout the server lifetime. This closes the leader-exit
    // to detached-child-start race after the verifier's first scan.
    supervisor.stdin.write(`${JSON.stringify({ type: 'drain', signal })}\n`);
    supervisor.stdin.end();
  } catch { /* the supervisor may already have noticed parent loss */ }
  await new Promise((resolvePromise) => {
    if (supervisor.exitCode !== null || supervisor.signalCode !== null) resolvePromise();
    else {
      const timer = setTimeout(async () => {
        await terminateSupervisorProcess(supervisor);
        resolvePromise();
      }, 10_000);
      supervisor.once('close', () => { clearTimeout(timer); resolvePromise(); });
    }
  });
  if (supervisor.exitCode !== null && supervisor.exitCode !== 0) {
    throw new Error('server supervisor failed to drain its scope');
  }
  if (supervisor.signalCode) throw new Error('server supervisor was terminated during cleanup');
}

/**
 * Detached watchdog for the asynchronous server handles. Its only normal
 * exit is an explicit release from the verifier. If the verifier is killed,
 * stdin closes or ppid changes and the watchdog drains the token scope.
 */
async function runServerSupervisor() {
  let config = null;
  let released = false;
  let cleaning = false;
  let timer = null;
  let observing = false;
  let buffer = '';
  const finish = (code = 0) => {
    if (timer) clearInterval(timer);
    if (!process.stdin.destroyed) process.stdin.destroy();
    process.exitCode = code;
  };
  const cleanup = async () => {
    if (released || cleaning || !config) return;
    cleaning = true;
    try {
      await drainServerScope(config, 'SIGKILL');
      finish(0);
    } catch {
      // A supervisor must not linger after its owner is gone. There is no
      // token-bearing diagnostic to expose here; the verifier's own cleanup
      // reports failures when it remains alive to receive them.
      finish(1);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === 'release') {
          released = true;
          finish(0);
        } else if (!config && message.scopeKey && message.scopeToken && Number.isSafeInteger(message.parentPid)) {
          config = message;
          config.seen = new Map();
          const observe = async () => {
            if (observing || cleaning || released) return;
            observing = true;
            try {
              const rows = await scanScopedPids(config.scopeKey, config.scopeToken);
              for (const row of rows) config.seen.set(row.pid, row.identity);
            } catch { /* cleanup performs bounded retries */ }
            observing = false;
          };
          timer = setInterval(() => {
            void observe();
            if (process.ppid !== config.parentPid) void cleanup();
          }, SERVER_SCOPE_SCAN_DELAY_MS);
          // A readiness acknowledgement means the watchdog has completed an
          // initial authoritative scan, not merely parsed its configuration.
          // The target cannot start before this resolves.
          await observe();
          if (!cleaning && !released) process.stdout.write('{"type":"supervisor-ready"}\n');
        } else if (config && message.type === 'drain') {
          released = true;
          try {
            await drainServerScope(config, message.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
            finish(0);
          } catch {
            finish(1);
          }
        }
      } catch { /* malformed control input is treated as owner loss at EOF */ }
    }
  });
  process.stdin.on('end', () => { if (!released) void cleanup(); });
  process.once('SIGTERM', () => { if (!released) void cleanup(); else finish(0); });
  process.once('SIGINT', () => { if (!released) void cleanup(); else finish(0); });
}

async function startLoggedProcess(command, args, { cwd, env, logPath }) {
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
  const scopeToken = randomBytes(32).toString('hex');
  // Every server owns a distinct environment key as well as a distinct
  // token. This prevents inherited/caller-provided scope values from making
  // concurrent server lifetimes indistinguishable to the scanner.
  const scopeKey = `${SERVER_SCOPE_PREFIX}${randomBytes(12).toString('hex')}`;
  const supervisor = process.platform === 'win32' ? null : spawnServerSupervisor({
    cwd,
    scopeKey,
    scopeToken,
    parentPid: process.pid,
  });
  try {
    // No target code is started until the detached watchdog has parsed the
    // scope and positively acknowledged that it is monitoring this owner.
    if (supervisor) await awaitServerSupervisorReady(supervisor);
  } catch (error) {
    await terminateSupervisorProcess(supervisor);
    await new Promise((resolvePromise) => log.end(resolvePromise));
    throw error;
  }
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      // The scope is visible only to this server and descendants. The parent
      // verifier and its ps probes never inherit the token.
      env: { ...(env ?? process.env), [scopeKey]: scopeToken },
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    await releaseServerSupervisor({ supervisor }, 'SIGKILL');
    await new Promise((resolvePromise) => log.end(resolvePromise));
    throw error;
  }
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('error', (error) => {
    child.pairedSpawnError = error;
    log.write(`\n${LABEL} spawn error: ${error.message}\n`);
  });
  child.scopeKey = scopeKey;
  child.scopeToken = scopeToken;
  return { child, log, scopeKey, scopeToken, supervisor };
}

/**
 * A detached process handle is deliberately not returned until its readiness
 * contract has passed. If any readiness/security probe rejects, reap the
 * complete process group here so callers cannot lose the handle through an
 * awaited assignment.
 */
export async function startLoggedProcessUntilReady(command, args, options, readiness) {
  const handle = await startLoggedProcess(command, args, options);
  try {
    await readiness(handle.child);
    return handle;
  } catch (error) {
    try {
      await stopLoggedProcess(handle);
    } catch (cleanupError) {
      error.message = `${error.message}; readiness cleanup: ${cleanupError.message}`;
    }
    throw error;
  }
}

export async function stopLoggedProcess(handle) {
  if (!handle) return;
  if (handle.stopped) return;
  const { child, log } = handle;
  handle.stopping = true;
  const failures = [];
  const isRunning = () => (
    !child.pairedSpawnError
    && child.exitCode === null
    && child.signalCode === null
  );
  const waitForExit = async (timeoutMs) => {
    if (!isRunning()) return true;
    return Promise.race([
      new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true))),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), timeoutMs)),
    ]);
  };
  try {
    if (child.pid && process.platform === 'win32') {
      if (isRunning()) child.kill('SIGTERM');
      await waitForExit(5_000);
      if (isRunning()) child.kill('SIGKILL');
      if (!await waitForExit(5_000)) fail(`server process ${child.pid} did not terminate after SIGKILL`);
    } else if (child.pid) {
      await drainServerScope(handle, 'SIGTERM');
      if (!await waitForExit(5_000)) {
        fail(`server process did not terminate after scoped cleanup (pid ${child.pid})`);
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await releaseServerSupervisor(handle, failures.length > 0 ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      failures.push(error);
      await terminateSupervisorProcess(handle.supervisor);
    }
    try {
      await new Promise((resolvePromise, rejectPromise) => log.end((error) => (error ? rejectPromise(error) : resolvePromise())));
    } catch (error) {
      failures.push(error);
    }
    handle.stopped = true;
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'failed to stop paired server process scope');
  }
}

function readScopedProcessesOnce(scopeKey, scopeToken) {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((resolvePromise, rejectPromise) => {
    const ps = spawn(SERVER_PS_PATH, ['eww', '-axo', 'pid=,pgid=,lstart=,command='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks = [];
    let bytes = 0;
    let outputTooLarge = false;
    let settled = false;
    const finish = (error, entries = []) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectPromise(error);
      else resolvePromise(entries);
    };
    const timer = setTimeout(() => {
      try { ps.kill('SIGKILL'); } catch { /* already exited */ }
      finish(new Error(`ps eww timed out after ${SERVER_SCOPE_SCAN_TIMEOUT_MS}ms`));
    }, SERVER_SCOPE_SCAN_TIMEOUT_MS);
    ps.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > SERVER_SCOPE_SCAN_OUTPUT_CAP) outputTooLarge = true;
      if (bytes <= SERVER_SCOPE_SCAN_OUTPUT_CAP) chunks.push(Buffer.from(chunk));
    });
    ps.once('error', (error) => finish(new Error(`ps eww failed: ${error.message}`)));
    ps.once('close', (code) => {
      if (outputTooLarge) {
        finish(new Error(`ps eww output exceeded ${SERVER_SCOPE_SCAN_OUTPUT_CAP} bytes`));
        return;
      }
      if (code !== 0) {
        finish(new Error(`ps eww exited with status ${code}`));
        return;
      }
      const escaped = String(scopeToken).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const key = String(scopeKey).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|\\s)${key}=${escaped}(?:\\s|$)`);
      const processes = Buffer.concat(chunks).toString('utf8').split('\n').flatMap((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/);
        if (!match || !pattern.test(match[4])) return [];
        const pid = Number(match[1]);
        const pgid = Number(match[2]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(pgid) || pgid <= 0) return [];
        return [{ pid, identity: { pgid, start: match[3] } }];
      });
      const unique = new Map(processes.map((entry) => [entry.pid, entry]));
      finish(null, [...unique.values()]);
    });
  });
}

async function scanScopedPids(scopeKey, scopeToken) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await readScopedProcessesOnce(scopeKey, scopeToken);
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    }
  }
  throw new Error(`process-scope scan failed after 3 attempts: ${lastError?.message ?? 'unknown ps failure'}`);
}

function sameProcessIdentity(left, right) {
  return Boolean(left && right)
    && left.pgid === right.pgid
    && left.start === right.start;
}

async function signalScopedProcesses(handle, processes, signal) {
  // Revalidate the PID and its process identity immediately before signaling.
  // In particular, never signal a negative PGID: a dead leader's PID may have
  // been reused for an unrelated process group.
  const current = await scanScopedPids(handle.scopeKey, handle.scopeToken);
  const byPid = new Map(current.map((entry) => [entry.pid, entry]));
  for (const entry of processes) {
    const fresh = byPid.get(entry.pid);
    if (!sameProcessIdentity(fresh?.identity, entry.identity)) continue;
    try { process.kill(entry.pid, signal); } catch (error) {
      if (error?.code !== 'ESRCH') throw new Error(`scoped ${signal} failed during cleanup (${error.message})`);
    }
  }
}

async function drainServerScope(handle, initialSignal) {
  let quietScans = 0;
  const maxAttempts = 3 + SERVER_SCOPE_QUIESCENCE_SCANS + 24;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    // Scan before signaling. A leader can exit while a detached descendant is
    // still starting; consecutive scans below keep that race observable.
    const current = await scanScopedPids(handle.scopeKey, handle.scopeToken);
    if (!(handle.seen instanceof Map)) handle.seen = new Map();
    for (const row of current) handle.seen.set(row.pid, row.identity);
    // Retain every identity observed by the watchdog, while requiring a
    // current same-identity match before signaling it. This covers a detached
    // child that appears between the leader's exit and the first cleanup scan
    // without widening the PID-reuse window.
    const currentByPid = new Map(current.map((row) => [row.pid, row]));
    const processes = [...handle.seen].flatMap(([pid, identity]) => {
      const row = currentByPid.get(pid);
      return row && sameProcessIdentity(row.identity, identity) ? [row] : [];
    });
    if (processes.length === 0) {
      quietScans += 1;
    } else {
      quietScans = 0;
      const signal = initialSignal === 'SIGKILL' || attempt >= 3 ? 'SIGKILL' : initialSignal;
      await signalScopedProcesses(handle, processes, signal);
    }
    // One empty scan is insufficient evidence of quiescence: a TERM handler
    // may spawn a detached child immediately after it.
    if (quietScans >= SERVER_SCOPE_QUIESCENCE_SCANS) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, SERVER_SCOPE_SCAN_DELAY_MS));
  }
  const remaining = await scanScopedPids(handle.scopeKey, handle.scopeToken);
  if (remaining.length > 0) fail(`server process scope did not reach quiescence (${remaining.length} remaining)`);
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

export function runLogged(command, args, {
  cwd,
  env,
  logPath,
  parseJson = false,
  strictStderr = false,
  phase = logPath,
  budgetKey,
  redactEnvValues = true,
} = {}) {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const timeoutDiagnosticsPath = `${logPath}.timeout.json`;
  const result = capture(command, args, {
    cwd,
    env,
    allowFailure: true,
    phase,
    budgetKey,
    diagnosticsPath: timeoutDiagnosticsPath,
    redactEnvValues,
    structuredOutput: parseJson ? 'json' : undefined,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const unexpectedStderr = strictStderr && String(result.stderr ?? '').trim().length > 0;
  const failedResult = unexpectedStderr ? { ...result, ok: false, failureType: 'stderr' } : result;
  const diagnostic = !failedResult.ok
    ? `\n${LABEL} bounded command failure=${failedResult.failureType}; timeoutMs=${result.timeoutMs}; `
      + `kill=${result.killSignal}; maxBuffer=${result.maxBuffer}; diagnostics=${timeoutDiagnosticsPath}\n`
    : '';
  writeFileSync(logPath, `${output}${diagnostic}`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  if (!failedResult.ok) {
    throw new ReleaseCommandError(
      commandFailure(command, args, failedResult, timeoutDiagnosticsPath),
      failedResult,
      timeoutDiagnosticsPath,
    );
  }
  return {
    durationMs: Date.now() - start,
    payload: result.payload,
    startedAt,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
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
    ['timeline schema package parent', probe?.schemaPythonpath, venv],
  ]) {
    if (!path || !isAbsolute(path)) fail(`${label} probe did not return an absolute path`);
    const scopedPath = relative(root, path);
    if (scopedPath === '' || scopedPath === '..' || scopedPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      fail(`${label} resolved outside its pinned runtime root: ${path}`);
    }
  }
  const expectedPackage = resolve(probe.schemaPythonpath, 'banodoco_timeline_schema');
  if (expectedPackage !== dirname(probe.modulePath)) {
    fail(`timeline schema package parent does not own the imported module: ${probe.schemaPythonpath}`);
  }
  return Object.freeze({
    astridModulePath: probe.astridModulePath,
    distributionVersion: probe.distributionVersion,
    modulePath: probe.modulePath,
    schemaPythonpath: probe.schemaPythonpath,
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
    "schemaPythonpath": os.path.dirname(os.path.dirname(os.path.realpath(banodoco_timeline_schema.__file__))),
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
  context.timelineSchemaPythonpath = realpathSync(timelineSchema.schemaPythonpath);
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

export function buildPinnedNpmArgs({ nodeExecutable, npmCliJs }, args) {
  if (!nodeExecutable || !npmCliJs) fail('pinned npm invocation requires explicit Node executable and npm CLI JavaScript target');
  return [nodeExecutable, npmCliJs, ...args];
}

function runPinnedNpm(context, args, options = {}) {
  if (!context.nodeExecutable || !context.npmCliJs) fail('pinned npm invocation requires explicit Node executable and npm CLI JavaScript target');
  const [command, npmCliJs, ...npmArgs] = buildPinnedNpmArgs(context, args);
  return runLogged(command, [npmCliJs, ...npmArgs], options);
}

function installAstridRemotionRuntime(context, { npmUserConfig, npmGlobalConfig }) {
  const projectDir = resolve(context.astridSnapshot, 'remotion');
  const packageJsonPath = resolve(projectDir, 'package.json');
  const lockPath = resolve(projectDir, 'package-lock.json');
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    fail(`pinned Astrid archive has no Remotion project directory: ${projectDir}`);
  }
  if (!existsSync(packageJsonPath) || !existsSync(lockPath)) {
    fail(`pinned Astrid Remotion runtime requires package.json and package-lock.json: ${projectDir}`);
  }
  let packageJson;
  let packageLock;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packageLock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    fail(`pinned Astrid Remotion manifests are invalid: ${error.message}`);
  }
  if (packageJson?.name !== 'tools-remotion' || packageLock?.lockfileVersion !== 3) {
    fail('pinned Astrid Remotion manifests do not match the lock-aligned runtime contract');
  }
  const cache = resolve(context.runtimeRoot, 'npm-cache-astrid-remotion');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const env = safeBaseEnvironment({
    HOME: context.home,
    TMPDIR: context.runtimeRoot,
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  });
  runPinnedNpm(context, ['ci', '--no-audit', '--no-fund'], {
    cwd: projectDir,
    env,
    logPath: resolve(context.evidenceRoot, 'astrid-remotion-npm-ci.log'),
    budgetKey: 'npm',
  });
  const nodeVersion = runLogged(context.nodeExecutable, ['--version'], {
    cwd: projectDir,
    env,
    logPath: resolve(context.evidenceRoot, 'astrid-remotion-node-version.log'),
    budgetKey: 'fastProbe',
  }).stdout.trim();
  const npmVersion = runPinnedNpm(context, ['--version'], {
    cwd: projectDir,
    env,
    logPath: resolve(context.evidenceRoot, 'astrid-remotion-npm-version.log'),
    budgetKey: 'fastProbe',
  }).stdout.trim();
  const inventory = runPinnedNpm(context, ['ls', '--json', '--all'], {
    cwd: projectDir,
    env,
    logPath: resolve(context.evidenceRoot, 'astrid-remotion-npm-tree.log'),
    parseJson: true,
    budgetKey: 'npm',
  }).payload;
  const scrubbedInventory = JSON.stringify(inventory, (key, value) => (
    ['path', '_resolved', 'resolved', 'from'].includes(key) ? undefined : value
  ), 2) + '\n';
  const provenance = {
    schemaVersion: 1,
    projectDir: relative(context.astridSnapshot, realpathSync(projectDir)),
    packageJsonSha256: sha256File(packageJsonPath),
    packageLockSha256: sha256File(lockPath),
    node: {
      executable: realpathSync(context.nodeExecutable),
      executableSha256: `sha256:${sha256File(context.nodeExecutable)}`,
      version: nodeVersion,
    },
    npm: {
      executable: realpathSync(context.npmExecutable),
      executableSha256: `sha256:${sha256File(context.npmExecutable)}`,
      cliJs: realpathSync(context.npmCliJs),
      cliJsSha256: `sha256:${sha256File(context.npmCliJs)}`,
      version: npmVersion,
    },
    cache: relative(context.runtimeRoot, cache),
    installedTreeSha256: createHash('sha256').update(scrubbedInventory).digest('hex'),
  };
  writeFileSync(
    resolve(context.evidenceRoot, 'astrid-remotion-runtime-provenance.json'),
    `${JSON.stringify({ ...provenance, installedTree: JSON.parse(scrubbedInventory) }, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  context.remotionProjectDir = realpathSync(projectDir);
  return provenance;
}

export function resolvePinnedBrowserExecutable(browserRoot, relativeExecutable) {
  if (!isAbsolute(browserRoot) || !relativeExecutable || isAbsolute(relativeExecutable)) {
    fail('lock-aligned Playwright Chromium probe must return a non-empty relative executable path');
  }
  const executable = resolve(browserRoot, relativeExecutable);
  const fromRoot = relative(browserRoot, executable);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    fail('lock-aligned Playwright Chromium executable escaped its browser root');
  }
  if (!existsSync(browserRoot) || !existsSync(executable)) {
    fail(`lock-aligned Playwright Chromium executable is unavailable: ${relativeExecutable}`);
  }
  const realRoot = realpathSync(browserRoot);
  const realExecutable = realpathSync(executable);
  const fromRealRoot = relative(realRoot, realExecutable);
  if (!fromRealRoot || fromRealRoot === '..' || fromRealRoot.startsWith(`..${sep}`) || isAbsolute(fromRealRoot)) {
    fail('lock-aligned Playwright Chromium executable escaped its real browser root');
  }
  return realExecutable;
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
    "const path = require('node:path')",
    "const { chromium } = require('playwright')",
    'process.stdout.write(path.relative(process.env.PLAYWRIGHT_BROWSERS_PATH, chromium.executablePath()))',
  ].join(';')], {
    cwd: context.reighSnapshot,
    env: browserEnv,
    logPath: resolve(context.evidenceRoot, 'playwright-browser-path.log'),
  });
  const relativeExecutable = probe.stdout.trim();
  const executable = resolvePinnedBrowserExecutable(browserRoot, relativeExecutable);
  context.browserExecutable = executable;
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
  const fixturePath = resolve(context.reighSnapshot, PAIRED_RELEASE_MEDIA_FIXTURE);
  const audioFixturePath = resolve(context.reighSnapshot, PAIRED_RELEASE_AUDIO_FIXTURE);
  const imagePath = resolve(sourceDir, 'paired-release-test-card.png');
  const audioPath = resolve(sourceDir, 'motion-output-audio.aac');
  writeFileSync(imagePath, readFileSync(fixturePath), { mode: 0o600 });
  writeFileSync(audioPath, readFileSync(audioFixturePath), { mode: 0o600 });
  if (sha256File(imagePath) !== context.mediaFixture.sha256) fail('seeded media bytes changed before import');
  if (sha256File(audioPath) !== context.audioFixture.sha256) fail('seeded audio bytes changed before import');
  writeFileSync(resolve(context.evidenceRoot, 'seed-media-fixture.json'), `${JSON.stringify({
    image: {
      ...context.mediaFixture,
      source: relative(context.reighSnapshot, fixturePath),
      seeded: relative(context.projectsRoot, imagePath),
    },
    audio: {
      ...context.audioFixture,
      source: relative(context.reighSnapshot, audioFixturePath),
      seeded: relative(context.projectsRoot, audioPath),
    },
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
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
  const audioImportArgs = [
    'media', 'import', audioPath,
    '--project', DEMO_PROJECT,
    '--realm', 'managed_local',
    '--idempotency-key', 'paired-release-audio-v1',
    '--json',
  ];
  const audioImport = validateImportedAudio(
    astridCommand(context, audioImportArgs, 'astrid-audio-import.log').payload,
  );
  const repeatedAudioImport = validateImportedAudio(
    astridCommand(context, audioImportArgs, 'astrid-audio-import-idempotent.log').payload,
  );
  if (repeatedAudioImport.mediaId !== audioImport.mediaId) {
    fail('Astrid idempotent audio import returned a different media id');
  }
  const audioMediaId = audioImport.mediaId;
  astridCommand(context, [
    'timelines', 'create', DEMO_TIMELINE,
    '--project', DEMO_PROJECT,
    '--name', 'Paired Release Timeline',
    '--config', JSON.stringify(PAIRED_RELEASE_TIMELINE_CONFIG),
    '--registry', JSON.stringify(buildPairedReleaseRegistry({ mediaId, audioMediaId })),
    '--default',
    '--idempotency-key', 'paired-release-timeline-v1',
    '--json',
  ], 'astrid-timeline-create.log');
  return Object.freeze({ audioMediaId, mediaId });
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
      const summary = {
        transitionCount: Number.isSafeInteger(payload?.transition_count) ? payload.transition_count : null,
        storedCount: Number.isSafeInteger(payload?.stored_count) ? payload.stored_count : null,
        evidenceCount: Number.isSafeInteger(payload?.evidence_count) ? payload.evidence_count : null,
        hasProjectId: typeof payload?.project_id === 'string',
        hasRunId: typeof payload?.run_id === 'string',
      };
      fail(`Runaway ${label} migration count mismatch: ${JSON.stringify(summary)}`);
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

export async function startAstrid(context, suffix, port, token) {
  const logPath = resolve(context.evidenceRoot, `astrid-${suffix}.log`);
  const args = [
    '-m', 'astrid', 'serve', '--release-mode', '--no-open-editor',
    '--projects-root', context.projectsRoot, '--host', '127.0.0.1', '--port', String(port),
  ];
  return startLoggedProcessUntilReady(context.astridPython, args, {
    cwd: context.astridSnapshot,
    env: buildServerEnvironment({
      home: context.home,
      projectsRoot: context.projectsRoot,
      pythonPath: context.astridSnapshot,
      nodeExecutable: context.nodeExecutable,
      bridgePort: port,
      token,
      remotionProjectDir: context.remotionProjectDir,
      timelineSchemaPythonpath: context.timelineSchemaPythonpath,
    }),
    logPath,
  }, async (child) => {
    const headers = { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v1' };
    await waitForUrl(`http://127.0.0.1:${port}/health`, { headers, process: child });
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
    await assertFailure('missing bearer', { 'X-Astrid-Bridge-Version': 'v1' }, 401, 'unauthorized');
    await assertFailure('wrong bearer', { Authorization: 'Bearer definitely-wrong', 'X-Astrid-Bridge-Version': 'v1' }, 401, 'unauthorized');
    await assertFailure('missing protocol version', { Authorization: `Bearer ${token}` }, 426, 'protocol_version_mismatch');
    await assertFailure('wrong protocol version', { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v0' }, 426, 'protocol_version_mismatch');
    await assertFailure('disallowed origin', { ...headers, Origin: 'https://attacker.invalid' }, 403, 'forbidden');
    await assertFailure('disallowed host', { ...headers, Host: 'attacker.invalid' }, 403, 'forbidden');
  });
}

export async function waitForRenderWorkerReadiness(child, { timeoutMs = 10_000 } = {}) {
  if (!child?.stdout) throw new Error('render worker did not expose a readiness channel');
  child.stdout.setEncoding('utf8');
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onData = (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.event === 'worker-ready' && message?.capability === PAIRED_RENDER_WORKER_CAPABILITY) {
          finish();
          return;
        }
        if (message?.event === 'worker-failed') {
          finish(new Error(`render worker failed before readiness: ${String(message.error ?? 'unknown error')}`));
          return;
        }
      }
    };
    const onError = (error) => finish(new Error(`render worker failed to spawn: ${error.message}`));
    const onClose = () => finish(new Error('render worker exited before readiness'));
    const timer = setTimeout(
      () => finish(new Error(`render worker readiness timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('close', onClose);
  });
}

export async function startRenderWorker(context, suffix, bridgePort, token) {
  const script = resolve(context.reighSnapshot, 'scripts/release/paired-render-worker.py');
  if (!existsSync(script)) fail(`paired render worker is missing from the archived Reigh candidate: ${script}`);
  const evidencePath = resolve(context.evidenceRoot, `astrid-render-worker-${suffix}.json`);
  const stagingRoot = resolve(context.runtimeRoot, `render-worker-staging-${suffix}`);
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const env = safeBaseEnvironment({
    HOME: context.home,
    TMPDIR: context.runtimeRoot,
    PYTHONPATH: context.astridSnapshot,
    ASTRID_PROJECTS_ROOT: context.projectsRoot,
    ASTRID_NODE_EXECUTABLE: context.nodeExecutable,
    ASTRID_REMOTION_PROJECT_DIR: context.remotionProjectDir,
    ASTRID_TIMELINE_SCHEMA_PYTHONPATH: context.timelineSchemaPythonpath,
    ASTRID_BRIDGE_TOKEN: token,
    PAIRED_RENDER_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
    PAIRED_RENDER_WORKER_CAPABILITY: PAIRED_RENDER_WORKER_CAPABILITY,
  });
  const handle = await startLoggedProcessUntilReady(context.astridPython, [
    '-u', script,
    '--executor-id', `paired-render-worker:${suffix}`,
    '--deadline-ms', String(PAIRED_RENDER_WORKER_DEADLINE_MS),
    '--staging-root', stagingRoot,
    '--evidence-path', evidencePath,
  ], {
    cwd: context.astridSnapshot,
    env,
    logPath: resolve(context.evidenceRoot, `astrid-render-worker-${suffix}.log`),
  }, (child) => waitForRenderWorkerReadiness(child));
  handle.renderWorkerEvidencePath = evidencePath;
  return handle;
}

export async function assertRenderWorkerCompleted(handle, { timeoutMs = 10_000 } = {}) {
  if (!handle?.child) throw new Error('render worker handle is missing');
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`render worker did not exit within ${timeoutMs}ms`)), timeoutMs);
      handle.child.once('close', () => { clearTimeout(timer); resolvePromise(); });
      handle.child.once('error', (error) => { clearTimeout(timer); rejectPromise(error); });
    });
  }
  if (handle.child.exitCode !== 0 || handle.child.signalCode) {
    throw new Error(`render worker exited unsuccessfully: ${childProcessFailure(handle.child, 'render worker')}`);
  }
  const evidencePath = handle.renderWorkerEvidencePath;
  if (!evidencePath || !existsSync(evidencePath)) throw new Error('render worker did not publish evidence');
  let evidence;
  try { evidence = JSON.parse(readFileSync(evidencePath, 'utf8')); } catch { throw new Error('render worker evidence is not valid JSON'); }
  if (
    evidence?.schemaVersion !== 1
    || evidence?.status !== 'completed'
    || evidence?.capability !== PAIRED_RENDER_WORKER_CAPABILITY
    || typeof evidence?.executor_id !== 'string'
    || typeof evidence?.task_id !== 'string'
    || typeof evidence?.attempt_id !== 'string'
    || !Number.isInteger(evidence?.attempt_no)
    || typeof evidence?.project_slug !== 'string'
    || !Number.isInteger(evidence?.bytes)
    || evidence.bytes <= 0
    || !/^[0-9a-f]{64}$/.test(evidence?.sha256 ?? '')
    || typeof evidence?.media?.media_id !== 'string'
    || evidence.media.mime_type !== 'video/mp4'
    || evidence.media.content_hash !== evidence.sha256
  ) {
    throw new Error(`render worker evidence did not prove completion: ${JSON.stringify(evidence)}`);
  }
  return evidence;
}

export async function startReigh(context, suffix, port, bridgePort, token, mode) {
  const viteBin = resolve(context.reighSnapshot, 'node_modules/vite/bin/vite.js');
  const args = buildViteArgs(viteBin, mode, port);
  return startLoggedProcessUntilReady(process.execPath, args, {
    cwd: context.reighSnapshot,
    env: buildServerEnvironment({
      home: context.home,
      projectsRoot: context.projectsRoot,
      pythonPath: context.astridSnapshot,
      bridgePort,
      token,
      reighMode: mode,
      reighPort: port,
      readinessIdentity: context.readinessIdentity,
    }),
    logPath: resolve(context.evidenceRoot, `reigh-${suffix}.log`),
  }, (child) => waitForReighReadiness(`http://127.0.0.1:${port}`, {
    mode,
    process: child,
    expectedIdentity: context.readinessIdentity,
    timeoutMs: 120_000,
  }));
}

async function smokeBuiltPreview(port, expectedIdentity) {
  const base = `http://127.0.0.1:${port}`;
  const configResponse = await fetch(`${base}/runtime-config/v1/extensions.json`, { cache: 'no-store' });
  if (!configResponse.ok) fail(`built preview runtime config returned ${configResponse.status}`);
  const config = await configResponse.json();
  if (!isExactViteReadiness(config, expectedIdentity)) {
    fail(`built preview runtime config mismatch: ${JSON.stringify(config)}`);
  }
  // The first proxy request deliberately supplies credentials and a protocol
  // version that must never reach Astrid.  This goes through the actual Vite
  // preview proxy (not a direct bridge request); a 200/v1 response proves the
  // server-side policy replaced both values.
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

  // Keep cross-origin input hostile at the proxy boundary.  The Vite proxy
  // must not normalize an attacker origin into a trusted request; Astrid
  // should reject it with its normal forbidden response.  Raw HTTP is used so
  // the Origin and Host values are observed exactly as sent on the wire.
  const hostileOrigin = await requestRawHttp(`${base}/api/astrid/health`, {
    headers: {
      Authorization: 'Bearer attacker-controlled-value-must-be-replaced',
      'X-Astrid-Bridge-Version': 'v0',
      Origin: 'https://attacker.invalid',
      Host: `127.0.0.1:${port}`,
    },
  });
  let hostileOriginPayload;
  try { hostileOriginPayload = await hostileOrigin.json(); } catch { hostileOriginPayload = null; }
  if (
    hostileOrigin.status !== 403
    || hostileOriginPayload?.error !== 'forbidden'
    || hostileOrigin.headers.get('x-astrid-bridge-version') !== 'v1'
  ) {
    fail(
      `built preview proxy did not reject hostile Origin safely: `
      + `${hostileOrigin.status}/${hostileOriginPayload?.error ?? '<no-code>'}`,
    );
  }

  // Vite preview's allowed-host boundary must reject a hostile Host before it
  // can select the Astrid proxy.  A status in the documented 4xx family is
  // accepted because Vite has changed the exact response between releases;
  // success is never acceptable.
  const hostileHost = await requestRawHttp(`${base}/api/astrid/health`, {
    headers: {
      Authorization: 'Bearer attacker-controlled-value-must-be-replaced',
      'X-Astrid-Bridge-Version': 'v0',
      Origin: 'https://attacker.invalid',
      Host: 'attacker.invalid',
    },
  });
  if (hostileHost.status < 400 || hostileHost.status >= 500) {
    fail(`built preview proxy accepted hostile Host: HTTP ${hostileHost.status}`);
  }
  return {
    config,
    proxyStatus: proxy.status,
    proxyReplacedClientAuthorization: true,
    proxyReplacedClientProtocolVersion: true,
    hostileOriginStatus: hostileOrigin.status,
    hostileOriginRejected: true,
    hostileHostStatus: hostileHost.status,
    hostileHostRejected: true,
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
      audioMediaId: context.audioMediaId,
    }),
    logPath: resolve(context.evidenceRoot, `playwright-${phase}.log`),
  });
}

function parseRate(value) {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number);
  return numerator > 0 && denominator > 0 ? numerator / denominator : Number.NaN;
}

const CAPTION_FOREGROUND_THRESHOLD = 0.001;
const CAPTION_CONTROL_DELTA = 0.0005;
const CAPTION_MIN_CONTRAST = 0.04;
// The no-caption frame is compared with the independently committed clean
// test-card PNG. These limits allow the expected video colour conversion while
// still rejecting a caption-sized foreground, including a sparse stray mark.
const CONTROL_MAX_FOREGROUND = 0.0015;
const CONTROL_MAX_CONTRAST = 0.02;
const CAPTION_FRAME_WIDTH = 1280;
const CAPTION_FRAME_HEIGHT = 720;
export const EXPECTED_PERSISTED_CAPTIONS = Object.freeze([
  Object.freeze({
    id: 'transcript-caption-94f8d62cad776aca',
    text: 'Fixture segment one',
    at: 2,
    duration: 2,
    region: Object.freeze({ x: 128, y: 418, width: 1024, height: 101 }),
  }),
  Object.freeze({
    id: 'transcript-caption-5b0feed951226a00',
    text: 'Fixture segment two',
    at: 5,
    duration: 3,
    region: Object.freeze({ x: 128, y: 418, width: 1024, height: 101 }),
  }),
]);

/**
 * OCR is deliberately normalized only for Unicode form, case, and spacing/
 * punctuation that Tesseract cannot consistently preserve. The letters and
 * numbers must still match exactly; a different caption cannot pass because
 * the media frame happens to differ elsewhere.
 */
export function normalizeCaptionText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function captionText(clip) {
  const value = clip?.text?.content ?? clip?.text ?? clip?.content;
  return typeof value === 'string' ? value.trim() : '';
}

function captionDuration(clip) {
  return Number(clip?.hold ?? clip?.duration ?? 0);
}

function rectangleFromClip(clip) {
  const values = ['x', 'y', 'width', 'height'].map((key) => Number(clip?.[key]));
  return values.every(Number.isFinite) && values.every((value) => value >= 0)
    ? { x: values[0], y: values[1], width: values[2], height: values[3] }
    : null;
}

function intersectionArea(left, right) {
  const x = Math.max(left.left, right.x);
  const y = Math.max(left.top, right.y);
  const rightEdge = Math.min(left.left + left.width, right.x + right.width);
  const bottom = Math.min(left.top + left.height, right.y + right.height);
  return Math.max(0, rightEdge - x) * Math.max(0, bottom - y);
}

function wordOverlapsRegion(word, region) {
  if (!word || !region) return false;
  return intersectionArea(
    { left: Number(word.left), top: Number(word.top), width: Number(word.width), height: Number(word.height) },
    region,
  ) > 0;
}

/**
 * Pure no-caption control proof. The control must be OCR-clean in every
 * persisted caption region and its pixels must remain close to the
 * independently expected clean test-card frame. A control-vs-itself metric is
 * deliberately not accepted: it is always zero, even when a stray caption is
 * present.
 */
export function assessNoCaptionControl({
  recognizedText = '',
  recognizedBounds = null,
  recognizedWords = [],
  frameWidth,
  frameHeight,
  codeOwnedRegions = [],
  foregroundByRegion = [],
  contrastByRegion = [],
  expectedCleanFrameSha256,
  controlFrameSha256,
}) {
  const reasons = [];
  if (!expectedCleanFrameSha256 || !controlFrameSha256) {
    reasons.push('no-caption control is missing an independently expected clean frame');
  }
  if (!Array.isArray(codeOwnedRegions) || codeOwnedRegions.length === 0) {
    reasons.push('no-caption control has no code-owned caption regions');
  }
  for (const region of codeOwnedRegions) {
    const right = Number(region?.x) + Number(region?.width);
    const bottom = Number(region?.y) + Number(region?.height);
    if (
      !region || ![region.x, region.y, region.width, region.height].every(Number.isFinite)
      || region.x < 1 || region.y < 1 || region.width < 2 || region.height < 2
      || right > frameWidth - 1 || bottom > frameHeight - 1
    ) {
      reasons.push('code-owned no-caption region is clipped or empty');
    }
  }
  const words = Array.isArray(recognizedWords) ? recognizedWords : [];
  const overlappingWords = words.filter((word) => codeOwnedRegions.some((region) => wordOverlapsRegion(word, region)));
  if (overlappingWords.length > 0) {
    reasons.push(`no-caption control OCR recognized text in a caption region: ${overlappingWords.map((word) => word.text).join(' ')}`);
  } else if (recognizedText && recognizedBounds && codeOwnedRegions.some((region) => wordOverlapsRegion(recognizedBounds, region))) {
    // Keep this fallback for callers that only have the aggregate OCR bounds.
    reasons.push('no-caption control OCR recognized text in a caption region');
  }
  if (!Array.isArray(foregroundByRegion) || foregroundByRegion.length !== codeOwnedRegions.length) {
    reasons.push('no-caption control foreground metrics are incomplete');
  }
  if (!Array.isArray(contrastByRegion) || contrastByRegion.length !== codeOwnedRegions.length) {
    reasons.push('no-caption control contrast metrics are incomplete');
  }
  foregroundByRegion.forEach((value, index) => {
    if (!Number.isFinite(value) || value > CONTROL_MAX_FOREGROUND) {
      reasons.push(`no-caption control has caption-like foreground in region ${index + 1}`);
    }
  });
  contrastByRegion.forEach((value, index) => {
    if (!Number.isFinite(value) || value > CONTROL_MAX_CONTRAST) {
      reasons.push(`no-caption control has caption-like contrast in region ${index + 1}`);
    }
  });
  return {
    pass: reasons.length === 0,
    reasons,
    recognizedText,
    recognizedBounds,
    overlappingWords,
    foregroundByRegion,
    contrastByRegion,
    expectedCleanFrameSha256: expectedCleanFrameSha256 ?? null,
    controlFrameSha256: controlFrameSha256 ?? null,
  };
}

/**
 * Pure caption proof predicate. Keeping this separate from ffmpeg/ImageMagick
 * makes the negative cases auditable without a multi-minute paired render.
 */
export function assessCaptionProbe({
  expectedText,
  recognizedText,
  frameWidth,
  frameHeight,
  expectedRegion,
  recognizedBounds,
  occupancy,
  controlOccupancy,
  contrast,
  frameSha256,
  controlFrameSha256,
}) {
  const reasons = [];
  const normalizedExpected = normalizeCaptionText(expectedText);
  const normalizedRecognized = normalizeCaptionText(recognizedText);
  if (!normalizedExpected) reasons.push('expected caption text is empty');
  if (normalizedExpected !== normalizedRecognized) reasons.push('OCR text does not exactly match expected caption text');
  if (!recognizedBounds || !expectedRegion) {
    reasons.push('caption OCR or expected render region is missing');
  } else {
    const regionRight = expectedRegion.x + expectedRegion.width;
    const regionBottom = expectedRegion.y + expectedRegion.height;
    const recognizedRight = recognizedBounds.left + recognizedBounds.width;
    const recognizedBottom = recognizedBounds.top + recognizedBounds.height;
    if (
      expectedRegion.x < 1 || expectedRegion.y < 1
      || regionRight > frameWidth - 1 || regionBottom > frameHeight - 1
    ) reasons.push('caption render region is clipped by the frame bounds');
    if (
      recognizedBounds.left < 1 || recognizedBounds.top < 1
      || recognizedRight > frameWidth - 1 || recognizedBottom > frameHeight - 1
      || recognizedBounds.width <= 0 || recognizedBounds.height <= 0
    ) reasons.push('OCR bounds are clipped or empty');
    const recognizedArea = recognizedBounds.width * recognizedBounds.height;
    if (recognizedArea <= 0 || intersectionArea(recognizedBounds, expectedRegion) / recognizedArea < 0.25) {
      reasons.push('OCR text is outside the persisted caption render region');
    }
    // A degenerate region is not a useful reference mask even if OCR happened
    // to find the right words elsewhere in the frame.
    if (intersectionArea(recognizedBounds, expectedRegion) <= 0 || expectedRegion.width < 2 || expectedRegion.height < 2) {
      reasons.push('caption region has no usable text overlap');
    }
  }
  if (!Number.isFinite(occupancy) || occupancy <= CAPTION_FOREGROUND_THRESHOLD) {
    reasons.push('caption region has no visible foreground occupancy');
  }
  if (!Number.isFinite(controlOccupancy) || occupancy <= controlOccupancy + CAPTION_CONTROL_DELTA) {
    reasons.push('caption occupancy does not exceed the no-caption control');
  }
  if (!Number.isFinite(contrast) || contrast < CAPTION_MIN_CONTRAST) {
    reasons.push('caption region is not legible against its background');
  }
  if (frameSha256 && controlFrameSha256 && frameSha256 === controlFrameSha256) {
    reasons.push('caption frame and no-caption control are byte-identical');
  }
  return {
    pass: reasons.length === 0,
    reasons,
    expectedText,
    recognizedText,
    normalizedExpected,
    normalizedRecognized,
    occupancy,
    controlOccupancy,
    contrast,
    recognizedBounds: recognizedBounds ?? null,
    expectedRegion: expectedRegion ?? null,
  };
}

export function validateCaptionExpectations(captions, expected = EXPECTED_PERSISTED_CAPTIONS) {
  if (!Array.isArray(captions) || captions.length !== expected.length) {
    fail(`persisted caption count mismatch: expected ${expected.length}, got ${captions?.length ?? 0}`);
  }
  const ids = captions.map((caption) => caption.id);
  if (new Set(ids).size !== ids.length) fail('persisted caption IDs contain duplicates');
  const expectedById = new Map(expected.map((caption) => [caption.id, caption]));
  for (const caption of captions) {
    const wanted = expectedById.get(caption.id);
    if (!wanted) fail(`unexpected persisted caption ID: ${caption.id}`);
    if (caption.text !== wanted.text) fail(`persisted caption ${caption.id} text mismatch`);
    if (caption.at !== wanted.at || caption.duration !== wanted.duration) {
      fail(`persisted caption ${caption.id} interval mismatch: expected ${wanted.at}-${wanted.at + wanted.duration}s`);
    }
    if (JSON.stringify(caption.region) !== JSON.stringify(wanted.region)) {
      fail(`persisted caption ${caption.id} render geometry mismatch`);
    }
  }
  const ordered = [...captions].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    if (ordered[index].at < previous.at + previous.duration) {
      fail(`persisted caption intervals overlap: ${previous.id} and ${ordered[index].id}`);
    }
  }
  return Object.freeze(ordered);
}

function captionExpectations(evidenceRoot) {
  const path = resolve(evidenceRoot, 'timeline-restart.json');
  if (!existsSync(path)) fail('persisted restart timeline is missing; exact caption text cannot be verified');
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  const config = envelope?.timeline?.config ?? envelope?.config;
  const clips = Array.isArray(config?.clips) ? config.clips : [];
  const captions = clips
    .filter((clip) => String(clip?.id ?? '').startsWith('transcript-caption-'))
    .map((clip) => ({
      id: clip.id,
      at: Number(clip.at ?? 0),
      duration: captionDuration(clip),
      text: captionText(clip),
      region: rectangleFromClip(clip),
    }))
    .filter((clip) => Number.isFinite(clip.at) && clip.duration > 0 && clip.text && clip.region);
  return validateCaptionExpectations(captions);
}

export function captionProbePlan(captions, fps) {
  if (!Number.isFinite(fps) || fps <= 0) fail(`caption probe FPS is invalid: ${fps}`);
  return captions.flatMap((caption) => {
    const firstFrame = Math.round(caption.at * fps);
    const endFrame = Math.round((caption.at + caption.duration) * fps);
    const lastFrame = endFrame - 1;
    if (lastFrame < firstFrame) fail(`caption ${caption.id} has no encoded frames`);
    return [
      { captionId: caption.id, kind: 'first', frame: firstFrame, seconds: firstFrame / fps },
      { captionId: caption.id, kind: 'midpoint', frame: (firstFrame + lastFrame) / 2, seconds: caption.at + (caption.duration / 2) },
      { captionId: caption.id, kind: 'last', frame: lastFrame, seconds: lastFrame / fps },
    ];
  });
}

function parseTesseractTsv(tsv) {
  const lines = String(tsv ?? '').split(/\r?\n/).filter(Boolean);
  const words = [];
  for (const line of lines.slice(1)) {
    const fields = line.split('\t');
    if (fields.length < 12) continue;
    const text = fields.slice(11).join('\t').trim();
    const left = Number(fields[6]);
    const top = Number(fields[7]);
    const width = Number(fields[8]);
    const height = Number(fields[9]);
    const confidence = Number(fields[10]);
    if (text && [left, top, width, height, confidence].every(Number.isFinite) && confidence >= 0) {
      words.push({ text, left, top, width, height, confidence });
    }
  }
  return words;
}

function recognizedCaption(words) {
  if (words.length === 0) return { text: '', bounds: null };
  const text = words.map((word) => word.text).join(' ');
  const left = Math.min(...words.map((word) => word.left));
  const top = Math.min(...words.map((word) => word.top));
  const right = Math.max(...words.map((word) => word.left + word.width));
  const bottom = Math.max(...words.map((word) => word.top + word.height));
  return { text, bounds: { left, top, width: right - left, height: bottom - top } };
}

function imageDifferenceMetric(framePath, controlPath, region, kind, magickExecutable) {
  if (!magickExecutable || !isAbsolute(magickExecutable)) fail('caption metric requires the preflight-attested absolute ImageMagick executable');
  const crop = `${Math.round(region.width)}x${Math.round(region.height)}+${Math.round(region.x)}+${Math.round(region.y)}`;
  const args = [framePath, controlPath, '-compose', 'difference', '-composite', '-crop', crop, '+repage', '-colorspace', 'gray'];
  if (kind === 'occupancy') args.push('-threshold', '8%');
  args.push('-format', kind === 'occupancy' ? '%[fx:mean]' : '%[fx:standard_deviation]', 'info:');
  const result = capture(magickExecutable, args, { env: safeBaseEnvironment() });
  const value = Number(result.stdout.trim());
  if (!Number.isFinite(value)) fail(`ImageMagick returned an invalid caption difference ${kind}: ${result.stdout}`);
  return value;
}

function noCaptionControlSeconds(captions, duration) {
  const intervals = captions.map((caption) => ({ start: caption.at, end: caption.at + caption.duration }));
  const candidates = [
    Math.max(0, Math.min(...intervals.map((interval) => interval.start)) / 2),
    Math.max(...intervals.map((interval) => interval.end)) + 0.05,
  ];
  return candidates.find((seconds) => seconds >= 0 && seconds < duration && intervals.every(
    (interval) => seconds < interval.start || seconds >= interval.end,
  ));
}

export function validateRenderWorkerBinding({ browserReceipt, workerEvidence }) {
  if (!workerEvidence || workerEvidence.status !== 'completed') return null;
  if (!Number.isInteger(browserReceipt?.bytes) || browserReceipt.bytes !== workerEvidence.bytes) {
    fail(`browser MP4 bytes do not match worker evidence: ${browserReceipt?.bytes} != ${workerEvidence.bytes}`);
  }
  if (browserReceipt.sha256 !== workerEvidence.sha256) {
    fail(`browser MP4 hash does not match worker evidence: ${browserReceipt?.sha256} != ${workerEvidence.sha256}`);
  }
  const browserMediaId = typeof browserReceipt.mediaId === 'string' && browserReceipt.mediaId
    ? browserReceipt.mediaId
    : null;
  if (browserMediaId && browserMediaId !== workerEvidence.media.media_id) {
    fail(`browser media id does not match worker evidence: ${browserMediaId} != ${workerEvidence.media.media_id}`);
  }
  return {
    taskId: workerEvidence.task_id,
    attemptId: workerEvidence.attempt_id,
    workerMediaId: workerEvidence.media.media_id,
    browserMediaId,
    bytes: workerEvidence.bytes,
    sha256: workerEvidence.sha256,
    binding: browserMediaId ? 'sha256+bytes+media_id' : 'sha256+bytes',
    mediaIdSource: browserMediaId ? 'browser-download-url' : 'browser-receipt-no-media-id',
  };
}

function parseTaskOutputParams(output) {
  if (!output || typeof output !== 'object') return null;
  if (output.params && typeof output.params === 'object') return output.params;
  if (typeof output.params_json !== 'string') return null;
  try {
    const parsed = JSON.parse(output.params_json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Validate the product-owned completion read model.  This is deliberately
 * separate from validateRenderWorkerBinding: the paired verifier is not an
 * executor and may not claim an attempt of its own.
 */
export function validateAstridServeOwnedRenderEvidence({ browserReceipt, taskDetail, mediaContent }) {
  const task = taskDetail?.task;
  const taskId = typeof task?.task_id === 'string' ? task.task_id : task?.id;
  if (typeof taskId !== 'string' || taskId !== browserReceipt?.taskId) {
    fail(`serve-owned task id does not match browser admission: ${taskId ?? '<missing>'} != ${browserReceipt?.taskId ?? '<missing>'}`);
  }
  if (task?.capability !== PAIRED_RENDER_WORKER_CAPABILITY || task?.spec?.family !== 'render_export') {
    fail(`serve-owned task is not the admitted render_export capability: ${JSON.stringify({ capability: task?.capability, family: task?.spec?.family })}`);
  }
  if (task?.status !== 'succeeded') fail(`serve-owned render task did not succeed: ${String(task?.status)}`);
  const attempts = Array.isArray(task?.attempts) ? task.attempts : [];
  const winningAttemptId = task?.winning_attempt_id;
  if (typeof winningAttemptId !== 'string' || !winningAttemptId) fail('serve-owned succeeded task omitted a non-empty winning_attempt_id');
  const winningAttempts = attempts.filter((attempt) => (
    attempt?.status === 'succeeded'
    && (winningAttemptId ? (attempt.attempt_id ?? attempt.id) === winningAttemptId : true)
  ));
  if (winningAttempts.length !== 1) fail(`serve-owned task did not identify exactly one succeeded winning attempt: ${JSON.stringify({ winningAttemptId, attempts })}`);
  const attempt = winningAttempts[0];
  const attemptId = attempt.attempt_id ?? attempt.id;
  if (typeof attemptId !== 'string' || !attemptId || attemptId !== winningAttemptId) fail('serve-owned winning attempt identity is not exact and non-empty');
  const outputs = Array.isArray(task?.outputs) ? task.outputs : [];
  const primary = outputs.filter((output) => output?.is_primary === true || output?.is_primary === 1);
  if (primary.length !== 1) fail(`serve-owned render must expose exactly one primary output, got ${primary.length}`);
  const output = primary[0];
  const params = parseTaskOutputParams(output);
  const digest = params?.content_hash;
  const bytes = params?.byte_size;
  if (typeof output?.media_id !== 'string' || !output.media_id) fail('serve-owned primary output omitted media_id');
  if (!/^[0-9a-f]{64}$/.test(digest ?? '')) fail(`serve-owned primary output content_hash must be a bare sha256 digest: ${String(digest)}`);
  if (!Number.isInteger(bytes) || bytes <= 0) fail(`serve-owned primary output byte_size is invalid: ${String(bytes)}`);
  if (!mediaContent || mediaContent.status !== 200 || mediaContent.mimeType !== 'video/mp4') {
    fail(`serve-owned primary media is not a video/mp4 content response: ${JSON.stringify(mediaContent)}`);
  }
  if (mediaContent.bytes !== bytes || mediaContent.sha256 !== digest) {
    fail(`serve-owned media content does not match task output: ${JSON.stringify({ mediaBytes: mediaContent.bytes, outputBytes: bytes, mediaSha256: mediaContent.sha256, outputSha256: digest })}`);
  }
  const browserMediaId = typeof browserReceipt.mediaId === 'string' && browserReceipt.mediaId
    ? browserReceipt.mediaId
    : null;
  if (browserMediaId && browserMediaId !== output.media_id) fail(`browser media id does not match serve-owned primary output: ${browserMediaId} != ${output.media_id}`);
  if (browserReceipt.bytes !== bytes || browserReceipt.sha256 !== digest) fail('browser download does not match serve-owned primary output');
  return Object.freeze({
    schemaVersion: 1,
    authority: 'astrid-serve-owned',
    capability: PAIRED_RENDER_WORKER_CAPABILITY,
    projectSlug: task?.spec?.project_slug ?? null,
    taskId,
    attemptId,
    attemptNo: attempt.attempt_no,
    status: task.status,
    primaryMedia: {
      mediaId: output.media_id,
      mimeType: mediaContent.mimeType,
      contentHash: digest,
      bytes,
    },
    browserDownload: {
      taskId: browserReceipt.taskId,
      mediaId: browserMediaId,
      sha256: browserReceipt.sha256,
      bytes: browserReceipt.bytes,
    },
    binding: browserMediaId ? 'task+attempt+media_id+sha256+bytes' : 'task+attempt+sha256+bytes',
    mediaIdSource: browserMediaId ? 'browser-download-url' : 'server-task-output-only',
  });
}

async function readAstridTaskDetail({ bridgePort, projectSlug, taskId, token, timeoutMs = 10_000 }) {
  const url = `http://127.0.0.1:${bridgePort}/projects/${encodeURIComponent(projectSlug)}/tasks/${encodeURIComponent(taskId)}`;
  const response = await requestRawHttp(url, {
    timeoutMs,
    headers: { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v1' },
  });
  if (response.status !== 200) fail(`Astrid task detail returned HTTP ${response.status} for ${taskId}`);
  return response.json();
}

async function waitForAstridServeOwnedTask({ bridgePort, projectSlug, taskId, token, timeoutMs = PAIRED_RENDER_WORKER_DEADLINE_MS }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '<missing>';
  while (Date.now() < deadline) {
    const detail = await readAstridTaskDetail({
      bridgePort, projectSlug, taskId, token,
      timeoutMs: Math.max(100, Math.min(10_000, deadline - Date.now())),
    });
    lastStatus = String(detail?.task?.status ?? '<missing>');
    if (lastStatus === 'succeeded') return detail;
    if (['failed', 'cancelled', 'expired'].includes(lastStatus)) fail(`serve-owned render task reached terminal ${lastStatus}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  fail(`timed out waiting for serve-owned render task ${taskId} (last status ${lastStatus})`);
}

async function readAstridMediaContent({ bridgePort, projectSlug, mediaId, token }) {
  const url = `http://127.0.0.1:${bridgePort}/projects/${encodeURIComponent(projectSlug)}/media/${encodeURIComponent(mediaId)}/content`;
  const response = await requestRawHttp(url, {
    timeoutMs: 30_000,
    headers: { Authorization: `Bearer ${token}`, 'X-Astrid-Bridge-Version': 'v1' },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    mimeType: response.headers.get('content-type'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function captureAstridServeOwnedRenderEvidence(context, { bridgePort, token }) {
  const browserReceipt = JSON.parse(readFileSync(resolve(context.evidenceRoot, 'render-browser-receipt.json'), 'utf8'));
  if (browserReceipt.authority !== 'astrid-serve-owned' || typeof browserReceipt.taskId !== 'string') {
    fail('browser render receipt did not capture the authenticated Astrid render task id');
  }
  const taskDetail = await waitForAstridServeOwnedTask({
    bridgePort,
    projectSlug: DEMO_PROJECT,
    taskId: browserReceipt.taskId,
    token,
  });
  const output = (Array.isArray(taskDetail?.task?.outputs) ? taskDetail.task.outputs : []).find((entry) => entry?.is_primary === true || entry?.is_primary === 1);
  if (typeof output?.media_id !== 'string' || !output.media_id) fail('serve-owned task detail omitted primary media_id');
  const mediaContent = await readAstridMediaContent({
    bridgePort,
    projectSlug: DEMO_PROJECT,
    mediaId: output?.media_id,
    token,
  });
  const evidence = validateAstridServeOwnedRenderEvidence({ browserReceipt, taskDetail, mediaContent });
  writeFileSync(resolve(context.evidenceRoot, 'astrid-serve-owned-render-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return evidence;
}

export function pcmS16leStats(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buffer.length < 2 || buffer.length % 2 !== 0) fail('decoded audio probe is not non-empty signed 16-bit PCM');
  const sampleCount = buffer.length / 2;
  let sumSquares = 0;
  let peak = 0;
  let nonZeroSamples = 0;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset);
    const magnitude = Math.abs(sample);
    sumSquares += sample * sample;
    if (magnitude > peak) peak = magnitude;
    if (magnitude > 2) nonZeroSamples += 1;
  }
  return Object.freeze({
    sampleCount,
    rms: Math.sqrt(sumSquares / sampleCount) / 32_768,
    peak: peak / 32_768,
    nonZeroRatio: nonZeroSamples / sampleCount,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  });
}

export function validateRenderedStreamContract(probe, { expectedFps, expectedDuration } = {}) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
  const audio = audioStreams[0];
  const fps = parseRate(video?.avg_frame_rate);
  const duration = Number(video?.duration ?? probe?.format?.duration);
  const formatDuration = Number(probe?.format?.duration);
  const frames = Number(video?.nb_frames);
  if (
    video?.codec_name !== 'h264'
    || video?.width !== 1280
    || video?.height !== 720
    || fps !== expectedFps
    || !Number.isInteger(frames)
    || Math.abs(frames - Math.round(expectedDuration * expectedFps)) > 1
    || !Number.isFinite(duration)
    || Math.abs(duration - expectedDuration) > (1 / expectedFps)
    || !Number.isFinite(formatDuration)
    || Math.abs(formatDuration - expectedDuration) > (1 / expectedFps)
  ) {
    fail(`render stream contract mismatch: ${JSON.stringify({ video, formatDuration, expectedFps, expectedDuration })}`);
  }
  const audioDuration = Number(audio?.duration ?? probe?.format?.duration);
  if (audioStreams.length !== 1
    || !audio
    || audio.codec_name !== 'aac'
    || !Number.isInteger(Number(audio.channels)) || Number(audio.channels) < 1
    || !Number.isInteger(Number(audio.sample_rate)) || Number(audio.sample_rate) < 8_000
    || !Number.isFinite(audioDuration)
    || audioDuration < expectedDuration - (1 / expectedFps)
    || audioDuration > expectedDuration + (1 / expectedFps)) {
    fail(`render audio stream contract mismatch: ${JSON.stringify({ audioStreams, expectedDuration })}`);
  }
  return Object.freeze({ video, audio, fps, duration, formatDuration, frames, audioDuration });
}

function decodeAudioEvidence(context, inputPath, label, durationSeconds) {
  const outputPath = resolve(context.evidenceRoot, `${label}.s16le`);
  runLogged(context.nativeTools.ffmpeg.executable, [
    '-xerror', '-v', 'error', '-i', inputPath,
    '-t', String(durationSeconds), '-vn', '-ac', '1', '-ar', '8000',
    '-f', 's16le', '-y', outputPath,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, `${label}.log`),
    strictStderr: true,
  });
  return Object.freeze({
    path: relative(context.evidenceRoot, outputPath),
    ...pcmS16leStats(readFileSync(outputPath)),
  });
}

function verifyRenderedArtifact(context, { serveOwnedEvidence = null } = {}) {
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
  if (!serveOwnedEvidence || serveOwnedEvidence.authority !== 'astrid-serve-owned') fail('render verification requires strict Astrid serve-owned evidence');
  const workerBinding = serveOwnedEvidence;
  const ffprobeExecutable = context.nativeTools?.ffprobe?.executable;
  const ffmpegExecutable = context.nativeTools?.ffmpeg?.executable;
  const tesseractExecutable = context.nativeTools?.tesseract?.executable;
  const magickExecutable = context.nativeTools?.imageMagick?.executable;
  if (![ffprobeExecutable, ffmpegExecutable, tesseractExecutable, magickExecutable].every((path) => path && isAbsolute(path))) {
    fail('render verification requires all preflight-attested native executables');
  }
  const probe = runLogged(ffprobeExecutable, [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,codec_type,width,height,avg_frame_rate,nb_frames,duration,channels,sample_rate:format=duration',
    '-of', 'json',
    outputPath,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, 'render-ffprobe.json'),
    parseJson: true,
  }).payload;
  const expectedFps = Number(browserReceipt.expectedFps);
  const expectedDuration = Number(browserReceipt.expectedDuration);
  const { video, audio, fps, duration, frames, audioDuration } = validateRenderedStreamContract(
    probe,
    { expectedFps, expectedDuration },
  );
  const sourceAudio = decodeAudioEvidence(context, context.audioFixture.path, 'render-audio-source', expectedDuration);
  const renderedAudio = decodeAudioEvidence(context, outputPath, 'render-audio-output', expectedDuration);
  const rmsRatio = renderedAudio.rms / sourceAudio.rms;
  const peakRatio = renderedAudio.peak / sourceAudio.peak;
  const sampleCountRatio = renderedAudio.sampleCount / sourceAudio.sampleCount;
  if (sourceAudio.rms <= 0.001 || sourceAudio.peak <= 0.01
    || renderedAudio.rms <= 0.001 || renderedAudio.peak <= 0.01
    || renderedAudio.nonZeroRatio < 0.1
    || sampleCountRatio < 0.99 || sampleCountRatio > 1.01
    || rmsRatio < 0.5 || rmsRatio > 2
    || peakRatio < 0.5 || peakRatio > 2) {
    fail(`rendered audio does not preserve the seeded audible signal: ${JSON.stringify({ sourceAudio, renderedAudio, sampleCountRatio, rmsRatio, peakRatio })}`);
  }
  const audioEvidence = Object.freeze({
    codec: audio.codec_name,
    channels: Number(audio.channels),
    sampleRate: Number(audio.sample_rate),
    duration: audioDuration,
    source: sourceAudio,
    output: renderedAudio,
    sampleCountRatio,
    rmsRatio,
    peakRatio,
  });
  const fullDecodeResult = runLogged(ffmpegExecutable, [
    '-xerror', '-v', 'error', '-i', outputPath, '-f', 'null', '-',
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, 'render-full-decode.log'),
    strictStderr: true,
  });
  const fullDecode = fullDecodeResult.status === 0;
  if (!fullDecode) fail('full render decode did not exit successfully');
  const captions = captionExpectations(context.evidenceRoot);
  const expectedProbes = captionProbePlan(captions, expectedFps);
  const expectedMidpoints = expectedProbes
    .filter((probeEntry) => probeEntry.kind === 'midpoint')
    .map((probeEntry) => probeEntry.seconds);
  const receiptMidpoints = Array.isArray(browserReceipt.captionMidpoints)
    ? browserReceipt.captionMidpoints.map(Number)
    : [];
  if (
    receiptMidpoints.length !== expectedMidpoints.length
    || receiptMidpoints.some((value, index) => !Number.isFinite(value) || Math.abs(value - expectedMidpoints[index]) > (1 / expectedFps))
  ) {
    fail(`render receipt caption midpoint set mismatch: expected ${expectedMidpoints.join(', ')}, got ${receiptMidpoints.join(', ')}`);
  }
  const controlSeconds = noCaptionControlSeconds(captions, expectedDuration);
  if (!Number.isFinite(controlSeconds)) {
    fail('paired render has no no-caption control interval for caption semantics');
  }
  const controlPath = resolve(context.evidenceRoot, 'render-caption-control.png');
  runLogged(ffmpegExecutable, [
    '-v', 'error', '-ss', String(controlSeconds), '-i', outputPath, '-frames:v', '1', '-y', controlPath,
  ], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    logPath: resolve(context.evidenceRoot, 'render-caption-control.log'),
  });
  const mediaEvidence = validateRenderedMediaFrame(controlPath, context.mediaFixture);
  const controlFrameSha256 = sha256File(controlPath);
  const tesseractLanguages = capture(tesseractExecutable, ['--list-langs'], {
    cwd: context.reighSnapshot,
    env: safeBaseEnvironment(),
    allowFailure: true,
  });
  if (tesseractLanguages.status !== 0 || !/^eng$/m.test(tesseractLanguages.stdout ?? '')) {
    fail('deterministic caption OCR requires the Tesseract eng language data');
  }
  const controlOcrPath = resolve(context.evidenceRoot, 'render-caption-control-ocr.tsv');
  const controlTesseract = capture(tesseractExecutable, [
    controlPath, 'stdout', '--psm', '11', '-l', 'eng', 'tsv',
  ], { cwd: context.reighSnapshot, env: safeBaseEnvironment() });
  writeFileSync(controlOcrPath, controlTesseract.stdout, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const controlRecognized = recognizedCaption(parseTesseractTsv(controlTesseract.stdout));
  const controlRegions = captions.map((caption) => caption.region);
  const controlForegroundByRegion = controlRegions.map((region) => imageDifferenceMetric(
    controlPath,
    context.mediaFixture.path,
    region,
    'occupancy',
    magickExecutable,
  ));
  const controlContrastByRegion = controlRegions.map((region) => imageDifferenceMetric(
    controlPath,
    context.mediaFixture.path,
    region,
    'contrast',
    magickExecutable,
  ));
  const controlSemantics = assessNoCaptionControl({
    recognizedText: controlRecognized.text,
    recognizedBounds: controlRecognized.bounds,
    recognizedWords: parseTesseractTsv(controlTesseract.stdout),
    frameWidth: CAPTION_FRAME_WIDTH,
    frameHeight: CAPTION_FRAME_HEIGHT,
    codeOwnedRegions: controlRegions,
    foregroundByRegion: controlForegroundByRegion,
    contrastByRegion: controlContrastByRegion,
    expectedCleanFrameSha256: context.mediaFixture.sha256,
    controlFrameSha256,
  });
  if (!controlSemantics.pass) {
    fail(`no-caption control semantic proof failed at ${controlSeconds}s: ${controlSemantics.reasons.join('; ')}`);
  }
  const probeEvidence = expectedProbes.map((probeEntry, index) => {
    const caption = captions.find((candidate) => candidate.id === probeEntry.captionId);
    if (!caption) fail(`caption probe references missing persisted ID ${probeEntry.captionId}`);
    const fileStem = `render-caption-${probeEntry.kind}-${index}`;
    const framePath = resolve(context.evidenceRoot, `${fileStem}.png`);
    const logPath = resolve(context.evidenceRoot, `${fileStem}.log`);
    runLogged(ffmpegExecutable, [
      '-v', 'error', '-ss', String(probeEntry.seconds), '-i', outputPath, '-frames:v', '1', '-y', framePath,
    ], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment(),
      logPath,
    });
    const ocrPath = resolve(context.evidenceRoot, `${fileStem}-ocr.tsv`);
    const tesseract = capture(tesseractExecutable, [
      framePath, 'stdout', '--psm', '11', '-l', 'eng', 'tsv',
    ], { cwd: context.reighSnapshot, env: safeBaseEnvironment() });
    writeFileSync(ocrPath, tesseract.stdout, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const recognized = recognizedCaption(parseTesseractTsv(tesseract.stdout));
    // Caption foreground and contrast are measured from frame-vs-control
    // differencing. Absolute luminance is intentionally not evidence: a
    // dark-but-present caption and a bright omitted-media frame must remain
    // distinguishable from the no-caption control.
    const occupancy = imageDifferenceMetric(framePath, controlPath, caption.region, 'occupancy', magickExecutable);
    const contrast = imageDifferenceMetric(framePath, controlPath, caption.region, 'contrast', magickExecutable);
    const semantics = assessCaptionProbe({
      expectedText: caption.text,
      recognizedText: recognized.text,
      frameWidth: CAPTION_FRAME_WIDTH,
      frameHeight: CAPTION_FRAME_HEIGHT,
      expectedRegion: caption.region,
      recognizedBounds: recognized.bounds,
      occupancy,
      controlOccupancy: imageDifferenceMetric(controlPath, context.mediaFixture.path, caption.region, 'occupancy', magickExecutable),
      contrast,
      frameSha256: sha256File(framePath),
      controlFrameSha256,
    });
    if (!semantics.pass) {
      fail(`caption semantic proof failed for ${caption.id} ${probeEntry.kind} frame ${probeEntry.seconds}s: ${semantics.reasons.join('; ')}`);
    }
    return {
      kind: probeEntry.kind,
      frame: probeEntry.frame,
      seconds: probeEntry.seconds,
      captionId: caption.id,
      expectedText: caption.text,
      recognizedText: recognized.text,
      sha256: sha256File(framePath),
      path: relative(context.evidenceRoot, framePath),
      logPath: relative(context.evidenceRoot, logPath),
      ocrPath: relative(context.evidenceRoot, ocrPath),
      occupancy,
      controlOccupancy: semantics.controlOccupancy,
      contrast,
      recognizedBounds: recognized.bounds,
      expectedRegion: caption.region,
    };
  });
  const midpointEvidence = probeEvidence.filter((entry) => entry.kind === 'midpoint');
  if (new Set(midpointEvidence.map((entry) => entry.captionId)).size !== captions.length) {
    fail('caption midpoint probes did not cover every distinct persisted caption ID');
  }
  if (new Set(midpointEvidence.map((entry) => entry.sha256)).size !== midpointEvidence.length) {
    fail('caption midpoint frames are byte-identical; distinct persisted caption text was not demonstrated');
  }
  const verification = {
    schemaVersion: 2,
    persistedStateHash: browserReceipt.persistedStateHash,
    mp4Sha256: browserReceipt.sha256,
    bytes: browserReceipt.bytes,
    workerBinding,
    video: {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps,
      frames,
      duration,
    },
    audio: audioEvidence,
    fullDecode,
    mediaEvidence,
    captionSemantics: {
      method: 'tesseract-ocr+persisted-region-occupancy-contrast',
      expectedCaptionCount: captions.length,
      expectedCaptions: captions.map((caption) => ({
        id: caption.id,
        text: caption.text,
        at: caption.at,
        duration: caption.duration,
        region: caption.region,
      })),
      controlSeconds,
      controlFrameSha256,
      controlFramePath: relative(context.evidenceRoot, controlPath),
      controlOcrPath: relative(context.evidenceRoot, controlOcrPath),
      controlForegroundByRegion,
      controlContrastByRegion,
      boundaryFrames: probeEvidence.filter((entry) => entry.kind !== 'midpoint'),
      probes: probeEvidence,
    },
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
    nativeTools: pins.nativeToolchain?.tools,
    npmExecutable: pins.npmExecutable,
    npmCliJs: pins.npmCliJs,
    nodeExecutable: pins.nodeExecutable,
    bootstrapAstridPython: pins.astridPython,
    evidenceRoot,
    runtimeRoot,
    home: resolve(runtimeRoot, 'home'),
    projectsRoot: resolve(runtimeRoot, 'projects'),
    reighSnapshot: resolve(runtimeRoot, 'reigh'),
    astridSnapshot: resolve(runtimeRoot, 'astrid'),
    readinessIdentity: buildReadinessIdentity({
      nonce: randomBytes(4).toString('hex'),
      reighCommit: pins.reighCommit,
    }),
  };
  mkdirSync(context.home, { recursive: true, mode: 0o700 });
  mkdirSync(context.projectsRoot, { recursive: true, mode: 0o700 });
  const toolchainAttestationPath = resolve(evidenceRoot, 'toolchain-attestation.json');
  writeFileSync(
    toolchainAttestationPath,
    `${JSON.stringify(pins.nativeToolchain, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
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
    diskCapacity: pins.diskCapacity,
    toolchainAttestation: pins.nativeToolchain,
    toolchainAttestationPath: relative(evidenceRoot, toolchainAttestationPath),
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
    context.mediaFixture = validateMediaFixture({
      fixturePath: resolve(context.reighSnapshot, PAIRED_RELEASE_MEDIA_FIXTURE),
      metadataPath: resolve(context.reighSnapshot, PAIRED_RELEASE_MEDIA_METADATA),
    });
    context.audioFixture = validateAudioFixture({
      fixturePath: resolve(context.reighSnapshot, PAIRED_RELEASE_AUDIO_FIXTURE),
      expectedRoot: context.reighSnapshot,
      ffprobeExecutable: context.nativeTools?.ffprobe?.executable,
    });
    receipt.phases.push({ id: 'archives', status: 'pass' });

    const astridRemotionRuntime = installAstridRemotionRuntime(context, {
      npmUserConfig,
      npmGlobalConfig,
    });

    runPinnedNpm(context, ['ci', '--no-audit', '--no-fund'], {
      cwd: context.reighSnapshot,
      env: safeBaseEnvironment({ HOME: context.home, TMPDIR: runtimeRoot, NPM_CONFIG_USERCONFIG: npmUserConfig, NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig }),
      logPath: resolve(evidenceRoot, 'reigh-npm-ci.log'),
    });
    runPinnedNpm(context, ['run', 'build'], {
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
        EXTENSION_RELEASE_CONFIG_REVISION: context.readinessIdentity,
      }),
      logPath: resolve(evidenceRoot, 'reigh-runtime-config.log'),
    });
    receipt.phases.push({ id: 'reigh-build', status: 'pass', browser });

    const astridRuntime = installLockedAstridRuntime(context);
    receipt.phases.push({
      id: 'astrid-locked-runtime',
      status: 'pass',
      ...astridRuntime,
      remotion: astridRemotionRuntime,
    });

    const seededMedia = seedDemoProject(context);
    context.mediaId = seededMedia.mediaId;
    context.audioMediaId = seededMedia.audioMediaId;
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
    const bridgeImage = await verifyBridgeMediaContent({
      baseUrl: `http://127.0.0.1:${bridgePort}`,
      projectSlug: DEMO_PROJECT,
      mediaId: context.mediaId,
      fixture: context.mediaFixture,
      token,
    });
    const bridgeAudio = await verifyBridgeMediaContent({
      baseUrl: `http://127.0.0.1:${bridgePort}`,
      projectSlug: DEMO_PROJECT,
      mediaId: context.audioMediaId,
      fixture: context.audioFixture,
      token,
    });
    let reighPort = await allocatePort();
    reighHandle = await startReigh(context, 'preview', reighPort, bridgePort, token, 'preview');
    const preview = await smokeBuiltPreview(reighPort, context.readinessIdentity);
    receipt.phases.push({
      id: 'built-preview-auth-proxy',
      status: 'pass',
      ...preview,
      bridgeMedia: { image: bridgeImage, audio: bridgeAudio },
    });
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
    const serveOwnedEvidence = await captureAstridServeOwnedRenderEvidence(context, { bridgePort, token });
    const renderVerification = verifyRenderedArtifact(context, { serveOwnedEvidence });
    receipt.phases.push({
      id: 'restart-persistence-render',
      status: 'pass',
      persistedStateHash: renderVerification.persistedStateHash,
      mp4Sha256: renderVerification.mp4Sha256,
      videoFrames: renderVerification.video.frames,
      audio: renderVerification.audio,
      fullDecode: renderVerification.fullDecode,
      mediaEvidence: renderVerification.mediaEvidence,
      render: {
        authority: 'astrid-serve-owned',
        taskId: serveOwnedEvidence.taskId,
        attemptId: serveOwnedEvidence.attemptId,
        bytes: serveOwnedEvidence.primaryMedia.bytes,
        sha256: serveOwnedEvidence.primaryMedia.contentHash,
        mediaId: serveOwnedEvidence.primaryMedia.mediaId,
        workerBinding: renderVerification.workerBinding,
      },
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
      const summary = {
        ok: doctor?.ok === true,
        checks: Array.isArray(doctor?.checks)
          ? doctor.checks.map((check) => ({
              name: typeof check?.name === 'string' ? check.name : null,
              status: typeof check?.status === 'string' ? check.status : null,
              code: typeof check?.code === 'string' ? check.code : null,
            }))
          : [],
      };
      fail(`Astrid doctor failed after restore: ${JSON.stringify(summary)}`);
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
    const restoredBridgeAudio = await verifyBridgeMediaContent({
      baseUrl: `http://127.0.0.1:${bridgePort}`,
      projectSlug: DEMO_PROJECT,
      mediaId: context.audioMediaId,
      fixture: context.audioFixture,
      token,
    });
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
      restoredBridgeAudio,
      doctorChecks: doctor.checks.length,
    });

    receipt.status = 'pass';
  } catch (error) {
    receipt.error = error.message;
    if (error instanceof ReleaseCommandError) {
      receipt.commandDiagnostic = commandDiagnosticSummary(error);
    }
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
      receipt.toolchainAttestationSha256 = `sha256:${sha256File(toolchainAttestationPath)}`;
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
  let preflightPhase = 'exact-ref capability preflight';
  try {
    pins = preflightPinnedRepositories({ manifest, env });
    preflightPhase = 'disk-capacity preflight';
    const diskCapacity = assertPairedReleaseDiskCapacity({
      astridCheckout: pins.astridCheckout,
    });
    preflightPhase = 'native toolchain preflight';
    pins = Object.freeze({
      ...pins,
      diskCapacity,
      nativeToolchain: preflightNativeToolchain({ manifest, env, pins }),
    });
  } catch (error) {
    const receipt = {
      schemaVersion: 1,
      release: manifest.release,
      status: 'failed',
      phase: preflightPhase,
      reighRef: env.REIGH_REF || null,
      astridRef: env.ASTRID_REF || null,
      manifestAstridPin: manifest.astrid.commit,
      requiredCapability: RELEASE_BRIDGE_CAPABILITY,
      ...(pins?.nativeToolchain ? { toolchainAttestation: pins.nativeToolchain } : {}),
      error: error.message,
      ...(error instanceof ReleaseCommandError ? {
        commandDiagnostic: commandDiagnosticSummary(error),
      } : {}),
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
  if (process.argv[2] === SERVER_SUPERVISOR_ARG) {
    runServerSupervisor().catch(() => { process.exitCode = 1; });
  } else {
    main().catch((error) => {
      console.error(`${LABEL} FAIL: ${error.message}`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    });
  }
}
