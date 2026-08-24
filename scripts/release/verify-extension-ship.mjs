#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve, win32 as pathWin32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertCleanReleaseCheckout,
  inspectCandidateController,
  resolveAnnotatedCandidateTag,
} from './reigh-release-provenance.mjs';

const LABEL = '[extension-ship]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const MANIFEST_PATH = resolve(
  REPO_ROOT,
  'config/releases/extension-ship-quality.json',
);

export const EXPECTED_REQUIRED_GATES = Object.freeze([
  'baseline',
  'durability',
  'scale-security',
  'e2e-render-acceptance',
  'release-freeze',
]);

/**
 * This list is deliberately code-owned and reviewable. Do not accept commands
 * from environment variables: a release verifier must not turn mutable input
 * into shell execution.
 */
export const REIGH_GATE_PROFILE = Object.freeze([
  { id: 'dependencies', label: 'install locked Reigh dependencies', command: 'npm', args: ['ci', '--no-audit', '--no-fund'] },
  { id: 'contract-recheck', label: 'release contract recheck', command: 'npm', args: ['run', 'check:contract-recheck:release'] },
  { id: 'deferred-claims', label: 'release deferred-claims gate', command: 'npm', args: ['run', 'check:deferred-claims:release'] },
  { id: 'docs-maturity', label: 'release documentation maturity gate', command: 'npm', args: ['run', 'check:docs-maturity-sync:release'] },
  { id: 'extension-drift', label: 'release extension drift gate', command: 'npm', args: ['run', 'check:extension-drift:release'] },
  { id: 'family-conformance', label: 'release family conformance gate', command: 'npm', args: ['run', 'check:extension-family-conformance:release'] },
  { id: 'sdk-exports', label: 'release SDK public-export gate', command: 'npm', args: ['run', 'check:sdk-public-exports:release'] },
  { id: 'sdk-imports', label: 'release SDK no-barrel-import gate', command: 'npm', args: ['run', 'check:sdk-no-barrel-imports:release'] },
  { id: 'frontend-closure', label: 'release frontend-closure gate', command: 'npm', args: ['run', 'check:frontend-closure:release'] },
  { id: 'example-readiness', label: 'release example-readiness gate', command: 'npm', args: ['run', 'check:example-readiness:release'] },
  { id: 'release-checklist', label: 'release evidence-checklist gate', command: 'npm', args: ['run', 'check:release-checklist:release'] },
  { id: 'ship-evidence', label: 'ship-quality immutable evidence gate', command: 'npm', args: ['run', 'check:extension-ship-evidence:release'] },
  { id: 'lint', label: 'Reigh lint', command: 'npm', args: ['run', 'lint'] },
  { id: 'typecheck', label: 'Reigh strict-island typecheck', command: 'npm', args: ['run', 'typecheck:strict-probe'] },
  { id: 'unit', label: 'complete Reigh unit suite', command: 'npm', args: ['test'] },
  { id: 'extension-tests', label: 'extension contract suite', command: 'npm', args: ['run', 'test:extensions'] },
  { id: 'creative-lab', label: 'Creative Lab extension suite', command: 'npm', args: ['run', 'test:creative-extension'] },
  { id: 'compatibility', label: 'extension compatibility matrix', command: 'npm', args: ['run', 'test:extension-compatibility'] },
  { id: 'production-smoke', label: 'production extension smoke suite', command: 'npm', args: ['run', 'test:extensions:production-smoke'] },
  { id: 'runtime-rollout', label: 'runtime extension rollout suite', command: 'npm', args: ['run', 'test:extensions:runtime-rollout'] },
  { id: 'container-runtime', label: 'production container smoke and rollback', command: 'npm', args: ['run', 'verify:extension-container'] },
  { id: 'paired-release-e2e', label: 'paired Reigh/Astrid production-like release acceptance', command: 'npm', args: ['run', 'verify:paired-release-e2e'] },
  { id: 'readiness', label: 'extension readiness suite', command: 'npm', args: ['run', 'test:readiness'] },
  { id: 'readiness-e2e', label: 'extension harness browser suite', command: 'npm', args: ['run', 'test:readiness:e2e'] },
  { id: 'cross-browser-e2e', label: 'Chrome Firefox WebKit extension suite', command: 'npm', args: ['run', 'test:e2e:extension-cross-browser'] },
  { id: 'accessibility-e2e', label: 'extension accessibility and responsive suite', command: 'npm', args: ['run', 'test:e2e:extension-accessibility'] },
  { id: 'timeline-e2e', label: 'timeline browser/device suite', command: 'npm', args: ['run', 'test:e2e:timeline'] },
  { id: 'build', label: 'reproducible Reigh production build', command: 'npm', args: ['run', 'build'] },
]);

export const ASTRID_GATE_PROFILE = Object.freeze([
  Object.freeze({
    id: 'astrid-remotion-dependencies',
    label: 'install locked Astrid Remotion dependencies',
    command: 'npm',
    args: ['ci'],
    cwdSuffix: 'remotion',
  }),
  Object.freeze({
    id: 'astrid-ci',
    label: 'pinned Astrid full CI mirror',
    command: 'make',
    args: ['ci'],
    cwdSuffix: '',
  }),
]);

const GIB = 1024n ** 3n;
const TREE_ALLOCATION_BLOCK_BYTES = 4096n;
export const RELEASE_OPERATIONAL_ALLOWANCE_BYTES = 8n * GIB;
export const ASTRID_SEPARATE_VOLUME_MIN_BYTES = 2n * GIB;
export const DISK_BUDGET_OVERRIDE_ENV = 'EXTENSION_SHIP_MIN_FREE_BYTES';
const MAX_DISK_BUDGET_OVERRIDE_BYTES = 1024n ** 5n;
const POSIX_DISK_PLATFORMS = new Set([
  'aix',
  'darwin',
  'freebsd',
  'linux',
  'openbsd',
  'sunos',
]);
export const HEAVY_STEP_MIN_FREE_BYTES = Object.freeze({
  dependencies: 8n * GIB,
  'container-runtime': 6n * GIB,
  'paired-release-e2e': 5n * GIB,
  'astrid-remotion-dependencies': 3n * GIB,
  'astrid-ci': 2n * GIB,
});

const RELEASE_TMPDIR = realpathSync(tmpdir());
const RELEASE_HOME = resolve(
  RELEASE_TMPDIR,
  `reigh-extension-ship-home-${process.pid}`,
);
const RELEASE_REIGH_WORKTREE = resolve(RELEASE_HOME, 'reigh-controller');
const RELEASE_PATH = [
  dirname(realpathSync(process.execPath)),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
].filter((entry, index, entries) => entries.indexOf(entry) === index).join(':');
const ALLOWED_STEP_ENV = new Set([
  'ASTRID_CHECKOUT',
  'ASTRID_PYTHON',
  'ASTRID_REF',
  'PY',
  'PYTHON_BIN',
  'PYTHONPATH',
  'REIGH_REF',
]);

export const isMakeRecipeSafeExecutablePath = (value) => (
  typeof value === 'string' && /^\/[A-Za-z0-9._/+:-]+$/.test(value)
);

class UsageError extends Error {}

function fail(message) {
  throw new Error(message);
}

function formatBytes(bytes) {
  const whole = bytes / GIB;
  const tenths = ((bytes % GIB) * 10n) / GIB;
  return `${whole}.${tenths} GiB (${bytes} bytes)`;
}

function roundUp(value, unit) {
  if (value < 0n || unit <= 0n) fail('disk budget values must be non-negative');
  return value === 0n ? 0n : ((value + unit - 1n) / unit) * unit;
}

export function parseDiskBudgetOverride(env = process.env) {
  const raw = env[DISK_BUDGET_OVERRIDE_ENV];
  if (raw === undefined || raw === '') return null;
  if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) {
    fail(`${DISK_BUDGET_OVERRIDE_ENV} must be an unsigned base-10 byte count`);
  }
  const bytes = BigInt(raw);
  if (bytes > MAX_DISK_BUDGET_OVERRIDE_BYTES) {
    fail(`${DISK_BUDGET_OVERRIDE_ENV} exceeds the 1 PiB safety bound`);
  }
  return bytes;
}

export function parseLsTreeAllocatedBytes(output, blockBytes = TREE_ALLOCATION_BLOCK_BYTES) {
  if (typeof output !== 'string' || blockBytes <= 0n) {
    fail('invalid git tree sizing input');
  }
  let total = 0n;
  for (const record of output.split('\0')) {
    if (!record) continue;
    const separator = record.indexOf('\t');
    if (separator < 0) fail(`git ls-tree sizing record has no path separator: ${record.slice(0, 120)}`);
    const header = record.slice(0, separator);
    const match = header.match(/^[0-7]{6} blob [0-9a-f]{40,64} +([0-9]+)$/);
    if (!match) {
      if (/^[0-7]{6} commit [0-9a-f]{40,64} +-$/.test(header)) continue;
      fail(`could not parse git ls-tree sizing record: ${header.slice(0, 120)}`);
    }
    const logicalBytes = BigInt(match[1]);
    // Include at least one allocation block for empty files and directory-entry
    // overhead rather than assuming logical bytes equal filesystem consumption.
    total += roundUp(logicalBytes > 0n ? logicalBytes : 1n, blockBytes);
  }
  return total;
}

export function measureCommitTreeBytes(checkout, commit) {
  const result = runCaptured(
    'git',
    ['ls-tree', '-r', '-l', '-z', commit],
    checkout,
    { allowFailure: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    fail(`could not size release tree ${commit} in ${checkout}: ${formatFailure(result)}`);
  }
  return parseLsTreeAllocatedBytes(result.stdout);
}

export function calculateReleaseRequiredBytes({
  reighTreeBytes,
  astridTreeBytes,
  operationalAllowanceBytes = RELEASE_OPERATIONAL_ALLOWANCE_BYTES,
}) {
  for (const [name, value] of Object.entries({
    reighTreeBytes,
    astridTreeBytes,
    operationalAllowanceBytes,
  })) {
    if (typeof value !== 'bigint' || value < 0n) fail(`${name} must be a non-negative bigint`);
  }
  // At peak the outer Reigh worktree overlaps with the paired gate's tar and
  // extracted snapshot. The Astrid archive has the same tar/extract overlap.
  const archivePeak = 3n * reighTreeBytes;
  const mixedPeak = 2n * reighTreeBytes + 2n * astridTreeBytes;
  const treePeak = archivePeak > mixedPeak ? archivePeak : mixedPeak;
  return roundUp(treePeak + operationalAllowanceBytes, GIB);
}

export function nearestExistingAncestor(path, exists = existsSync) {
  let candidate = resolve(path);
  while (!exists(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) fail(`disk-capacity target has no existing ancestor: ${path}`);
    candidate = parent;
  }
  return candidate;
}

export function availableBytesAt(path, {
  exists = existsSync,
  statfs = statfsSync,
} = {}) {
  const target = nearestExistingAncestor(path, exists);
  let stats;
  try {
    stats = statfs(target, { bigint: true });
  } catch (error) {
    fail(`cannot measure release disk capacity at ${target}: ${error.code ?? error.message}`);
  }
  if (
    typeof stats?.bavail !== 'bigint'
    || typeof stats?.bsize !== 'bigint'
    || stats.bavail < 0n
    || stats.bsize <= 0n
  ) {
    fail(`filesystem capacity probe returned invalid bigint fields for ${target}`);
  }
  return { availableBytes: stats.bavail * stats.bsize, target };
}

export function volumeKeyForPath(path, {
  exists = existsSync,
  ancestor = (candidate) => nearestExistingAncestor(candidate, exists),
  platform = process.platform,
  realpath = realpathSync,
  stat = statSync,
} = {}) {
  const target = realpath(ancestor(path));
  if (platform === 'win32') {
    const root = pathWin32.parse(target).root;
    if (!root) fail(`cannot identify Windows volume for ${target}`);
    return `win32:${root.toLowerCase()}`;
  }
  if (!POSIX_DISK_PLATFORMS.has(platform)) {
    fail(`release disk-capacity preflight does not support platform ${platform}`);
  }
  const dev = stat(target, { bigint: true })?.dev;
  if (typeof dev !== 'bigint' || dev < 0n) {
    fail(`cannot identify filesystem volume for ${target}`);
  }
  return `dev:${dev}`;
}

export function assertDiskRequirements(requirements, dependencies = {}) {
  const grouped = new Map();
  for (const requirement of requirements) {
    if (typeof requirement.requiredBytes !== 'bigint' || requirement.requiredBytes < 0n) {
      fail('disk requirement must be a non-negative bigint');
    }
    const key = volumeKeyForPath(requirement.path, dependencies);
    const prior = grouped.get(key);
    if (!prior || requirement.requiredBytes > prior.requiredBytes) {
      grouped.set(key, requirement);
    }
  }
  const results = [];
  for (const [volume, requirement] of grouped) {
    const probe = availableBytesAt(requirement.path, dependencies);
    if (probe.availableBytes < requirement.requiredBytes) {
      fail(
        `insufficient release disk capacity at ${probe.target}: requires at least `
        + `${formatBytes(requirement.requiredBytes)}, available ${formatBytes(probe.availableBytes)}`,
      );
    }
    results.push({ ...probe, requiredBytes: requirement.requiredBytes, volume });
  }
  return results;
}

export function assertReleaseDiskCapacity({
  reighTreeBytes,
  astridTreeBytes,
  astridCheckout,
  env = process.env,
  tempPath = RELEASE_TMPDIR,
}, dependencies = {}) {
  const calculatedBytes = calculateReleaseRequiredBytes({ reighTreeBytes, astridTreeBytes });
  const overrideBytes = parseDiskBudgetOverride(env);
  const requiredBytes = overrideBytes !== null && overrideBytes > calculatedBytes
    ? overrideBytes
    : calculatedBytes;
  const volumes = assertDiskRequirements([
    { path: tempPath, requiredBytes },
    { path: astridCheckout, requiredBytes: ASTRID_SEPARATE_VOLUME_MIN_BYTES },
  ], dependencies);
  return { calculatedBytes, overrideBytes, requiredBytes, volumes };
}

export function assertHeavyStepDiskCapacity(step, {
  astridCheckout,
  tempPath = RELEASE_TMPDIR,
}, dependencies = {}) {
  const requiredBytes = HEAVY_STEP_MIN_FREE_BYTES[step.id];
  if (requiredBytes === undefined) return [];
  return assertDiskRequirements([
    { path: tempPath, requiredBytes },
    { path: astridCheckout, requiredBytes: ASTRID_SEPARATE_VOLUME_MIN_BYTES },
  ], dependencies);
}

export function parseCliArgs(argv) {
  let mode = 'run';
  let help = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--plan' || arg === '--dry-run') {
      mode = 'plan';
    } else {
      throw new UsageError(`unknown option: ${arg}`);
    }
  }

  return { help, mode };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateReleaseManifest(manifest) {
  const errors = [];
  const reigh = isPlainObject(manifest?.reigh) ? manifest.reigh : {};
  const astrid = isPlainObject(manifest?.astrid) ? manifest.astrid : {};
  const verification = isPlainObject(manifest?.verification)
    ? manifest.verification
    : {};

  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof manifest?.release !== 'string' || manifest.release.trim() === '') {
    errors.push('release must be a non-empty string');
  }
  if (manifest?.status !== 'integration' && manifest?.status !== 'frozen') {
    errors.push('status must be integration or frozen');
  }
  if (typeof reigh.branch !== 'string' || reigh.branch.trim() === '') {
    errors.push('reigh.branch must be a non-empty string');
  }
  if (
    typeof reigh.releaseTag !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(reigh.releaseTag)
    || reigh.releaseTag.includes('..')
    || reigh.releaseTag.includes('//')
    || reigh.releaseTag.endsWith('/')
    || reigh.releaseTag.endsWith('.')
  ) {
    errors.push('reigh.releaseTag must be a safe annotated-tag name');
  }
  if (!/^[0-9a-f]{40}$/.test(reigh.baseCommit ?? '')) {
    errors.push('reigh.baseCommit must be a full 40-character lowercase commit');
  }
  if (typeof astrid.branch !== 'string' || astrid.branch.trim() === '') {
    errors.push('astrid.branch must be a non-empty string');
  }
  if (!/^[0-9a-f]{40}$/.test(astrid.commit ?? '')) {
    errors.push('astrid.commit must be a full 40-character lowercase commit pin');
  }
  if (verification.profile !== 'extension-ship-quality-v1') {
    errors.push('verification.profile must be extension-ship-quality-v1');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.node ?? '')) {
    errors.push('verification.node must be an exact semantic version');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(verification.nodeImageDigest ?? '')) {
    errors.push('verification.nodeImageDigest must be a full sha256 OCI digest');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.npm ?? '')) {
    errors.push('verification.npm must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.astridPython ?? '')) {
    errors.push('verification.astridPython must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.ffmpeg ?? '')) {
    errors.push('verification.ffmpeg must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.ffprobe ?? '')) {
    errors.push('verification.ffprobe must be an exact semantic version');
  }

  const requiredGates = Array.isArray(manifest?.requiredGates)
    ? manifest.requiredGates
    : [];
  if (
    requiredGates.length !== EXPECTED_REQUIRED_GATES.length
    || requiredGates.some((gate, index) => gate !== EXPECTED_REQUIRED_GATES[index])
  ) {
    errors.push(
      `requiredGates must exactly equal ${EXPECTED_REQUIRED_GATES.join(', ')}`,
    );
  }

  if (errors.length > 0) {
    fail(`invalid release manifest:\n- ${errors.join('\n- ')}`);
  }

  return manifest;
}

export function validatePackageJson(packageJson, manifest) {
  const errors = [];
  const expectedPackageManager = `npm@${manifest.verification.npm}`;

  if (packageJson.packageManager !== expectedPackageManager) {
    errors.push(`packageManager must be ${expectedPackageManager}`);
  }

  const scripts = isPlainObject(packageJson.scripts) ? packageJson.scripts : {};
  for (const gate of REIGH_GATE_PROFILE) {
    if (gate.command !== 'npm' || gate.args[0] !== 'run') continue;
    const scriptName = gate.args[1];
    if (typeof scripts[scriptName] !== 'string' || scripts[scriptName].trim() === '') {
      errors.push(`missing package.json script: ${scriptName}`);
    }
  }
  if (typeof scripts.test !== 'string' || scripts.test.trim() === '') {
    errors.push('missing package.json script: test');
  }
  for (const lifecycleName of [
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
  ]) {
    const lifecycle = scripts[lifecycleName];
    if (
      typeof lifecycle === 'string'
      && /(?:^|\s|[;&|])(?:npx|pnpx|bunx|npm\s+exec)(?:\s|$)/.test(lifecycle)
    ) {
      errors.push(`${lifecycleName} must not execute packages outside the lockfile`);
    }
  }

  if (errors.length > 0) {
    fail(`invalid release package configuration:\n- ${errors.join('\n- ')}`);
  }
}

export function buildExecutionPlan({
  repoRoot,
  astridCheckout,
  astridPython,
  astridRef,
  reighRef,
}) {
  const astridCwd = astridCheckout || '<ASTRID_CHECKOUT required for execution>';
  const python = astridPython || '<ASTRID_PYTHON required for execution>';
  return [
    ...REIGH_GATE_PROFILE.map((gate) => ({
      ...gate,
      cwd: repoRoot,
      env: gate.id === 'paired-release-e2e'
        ? {
            ASTRID_CHECKOUT: astridCheckout || '<ASTRID_CHECKOUT required for execution>',
            ASTRID_PYTHON: astridPython || '<ASTRID_PYTHON required for execution>',
            ASTRID_REF: astridRef || '<ASTRID_REF required for execution>',
            REIGH_REF: reighRef || '<REIGH_REF required for execution>',
          }
        : undefined,
    })),
    ...ASTRID_GATE_PROFILE.map(({ cwdSuffix, ...gate }) => ({
      ...gate,
      env: gate.id === 'astrid-ci'
        ? {
            PY: python,
            PYTHON_BIN: python,
            PYTHONPATH: resolve(repoRoot, 'vendor/timeline-schema/python'),
          }
        : undefined,
      cwd: cwdSuffix && astridCheckout
        ? resolve(astridCheckout, cwdSuffix)
        : cwdSuffix
          ? `${astridCwd}/${cwdSuffix}`
          : astridCwd,
    })),
  ];
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:@=+,-]+$/.test(value) ? value : JSON.stringify(value);
}

export function formatCommand(step) {
  const envPrefix = Object.entries(step.env ?? {})
    .map(([key, value]) => `${key}=${quoteForDisplay(value)}`);
  const command = [step.command, ...step.args].map(quoteForDisplay);
  return [...envPrefix, ...command].join(' ');
}

/**
 * Release gates intentionally get an allowlisted environment rather than a
 * filtered copy of process.env. This keeps newly introduced skip flags, test
 * overrides, credentials, language hooks, and package-manager configuration
 * from silently crossing the release boundary.
 */
export function buildSanitizedEnvironment(stepEnv = {}) {
  for (const key of Object.keys(stepEnv)) {
    if (!ALLOWED_STEP_ENV.has(key)) {
      fail(`release step environment key is not allowed: ${key}`);
    }
  }

  return {
    PATH: RELEASE_PATH,
    HOME: RELEASE_HOME,
    TMPDIR: RELEASE_TMPDIR,
    // Never consult user- or machine-owned npm configuration. A poisoned
    // script-shell or lifecycle setting can otherwise turn an npm gate into a
    // successful no-op even with a private HOME.
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_GLOBALCONFIG: '/dev/null',
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
    ...stepEnv,
  };
}

function formatFailure(result) {
  const details = [];
  if (result.error) details.push(result.error.message);
  if (result.signal) details.push(`terminated by ${result.signal}`);
  if (typeof result.status === 'number') details.push(`exit ${result.status}`);
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  if (stderr) details.push(stderr);
  return details.join(': ') || 'process did not report an exit status';
}

function runCaptured(command, args, cwd, {
  allowFailure = false,
  maxBuffer = 1024 * 1024,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: buildSanitizedEnvironment(),
    maxBuffer,
    shell: false,
    stdio: 'pipe',
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail(`${formatCommand({ command, args })} failed in ${cwd}: ${formatFailure(result)}`);
  }
  return result;
}

function outputOf(command, args, cwd) {
  return runCaptured(command, args, cwd).stdout.trim();
}

function assertClean(checkout, name) {
  assertCleanReleaseCheckout(checkout, name);
}

function resolveCommit(checkout, ref, name) {
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    fail(`${name} must be a full 40-character lowercase commit pin; got ${ref}`);
  }
  return outputOf(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    checkout,
  );
}

export function assertReighCheckout(manifest, env) {
  const branch = outputOf('git', ['branch', '--show-current'], REPO_ROOT);
  if (branch !== manifest.reigh.branch) {
    fail(`Reigh branch mismatch: expected ${manifest.reigh.branch}, got ${branch || '<detached>'}`);
  }

  const baseCommit = resolveCommit(
    REPO_ROOT,
    manifest.reigh.baseCommit,
    'manifest reigh.baseCommit',
  );
  if (!/^[0-9a-f]{40}$/.test(env.REIGH_REF ?? '')) {
    fail('REIGH_REF is required and must be a full 40-character lowercase commit');
  }
  const candidateCommit = resolveCommit(
    REPO_ROOT,
    env.REIGH_REF,
    'REIGH_REF',
  );
  const head = outputOf('git', ['rev-parse', 'HEAD'], REPO_ROOT);
  const candidateAncestry = runCaptured(
    'git',
    ['merge-base', '--is-ancestor', baseCommit, candidateCommit],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (candidateAncestry.error || candidateAncestry.status !== 0) {
    fail(`Reigh candidate is not descended from pinned base ${manifest.reigh.baseCommit}`);
  }
  const tag = resolveAnnotatedCandidateTag({
    repoRoot: REPO_ROOT,
    releaseTag: manifest.reigh.releaseTag,
  });
  if (tag.candidateCommit !== candidateCommit) {
    fail(
      `Reigh release tag ${manifest.reigh.releaseTag} resolves to ${tag.candidateCommit}, `
      + `not REIGH_REF candidate ${candidateCommit}`,
    );
  }
  const provenance = inspectCandidateController({
    repoRoot: REPO_ROOT,
    candidateCommit,
    headCommit: head,
    release: manifest.release,
  });
  assertClean(REPO_ROOT, 'Reigh');
  return {
    baseCommit,
    branch,
    candidateCommit,
    head,
    provenance,
    releaseTag: manifest.reigh.releaseTag,
    tagObject: tag.tagObject,
  };
}

function resolveAstridCheckout(manifest, env) {
  const requestedPath = env.ASTRID_CHECKOUT;
  const requestedRef = env.ASTRID_REF;

  if (!requestedPath) {
    fail('ASTRID_CHECKOUT is required and must point to a clean pinned Astrid checkout');
  }
  if (!isAbsolute(requestedPath)) {
    fail(`ASTRID_CHECKOUT must be absolute; got ${requestedPath}`);
  }
  if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
    fail(`ASTRID_CHECKOUT is not a directory: ${requestedPath}`);
  }
  if (!requestedRef) {
    fail(`ASTRID_REF is required and must resolve to manifest pin ${manifest.astrid.commit}`);
  }

  const checkout = realpathSync(requestedPath);
  const branch = outputOf('git', ['branch', '--show-current'], checkout);
  if (branch !== manifest.astrid.branch) {
    fail(
      `Astrid branch mismatch: expected ${manifest.astrid.branch}, got ${branch || '<detached>'}`,
    );
  }
  const manifestCommit = resolveCommit(
    checkout,
    manifest.astrid.commit,
    'manifest astrid.commit',
  );
  const requestedCommit = resolveCommit(checkout, requestedRef, 'ASTRID_REF');
  const head = outputOf('git', ['rev-parse', 'HEAD'], checkout);

  if (requestedCommit !== manifestCommit) {
    fail(
      `ASTRID_REF resolves to ${requestedCommit}, not manifest pin ${manifestCommit}`,
    );
  }
  if (head !== manifestCommit) {
    fail(`Astrid HEAD mismatch: expected ${manifestCommit}, got ${head}`);
  }
  if (!existsSync(resolve(checkout, 'Makefile'))) {
    fail(`pinned Astrid checkout has no Makefile: ${checkout}`);
  }
  if (!existsSync(resolve(checkout, 'remotion/package-lock.json'))) {
    fail(`pinned Astrid checkout has no Remotion lockfile: ${checkout}`);
  }

  assertClean(checkout, 'Astrid');
  return { branch, checkout, commit: manifestCommit };
}

function prepareReleaseHome() {
  if (existsSync(RELEASE_HOME)) {
    fail(`isolated release HOME already exists; refusing reuse: ${RELEASE_HOME}`);
  }
  mkdirSync(RELEASE_HOME, { mode: 0o700 });
}

function createReleaseReighWorktree(headCommit) {
  const result = runCaptured(
    'git',
    ['worktree', 'add', '--detach', RELEASE_REIGH_WORKTREE, headCommit],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (result.error || result.status !== 0) {
    fail(`could not create isolated Reigh release worktree: ${formatFailure(result)}`);
  }
  const isolatedHead = outputOf('git', ['rev-parse', 'HEAD'], RELEASE_REIGH_WORKTREE);
  if (isolatedHead !== headCommit) {
    fail(`isolated Reigh worktree resolved to ${isolatedHead}, expected ${headCommit}`);
  }
  assertClean(RELEASE_REIGH_WORKTREE, 'isolated Reigh evidence controller');
  return RELEASE_REIGH_WORKTREE;
}

function removeReleaseReighWorktree() {
  if (!existsSync(RELEASE_REIGH_WORKTREE)) return;
  const result = runCaptured(
    'git',
    ['worktree', 'remove', '--force', RELEASE_REIGH_WORKTREE],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (result.error || result.status !== 0) {
    fail(`could not remove isolated Reigh release worktree: ${formatFailure(result)}`);
  }
}

function cleanupReleaseHome() {
  if (existsSync(RELEASE_HOME)) {
    rmSync(RELEASE_HOME, { force: false, recursive: true });
  }
}

export function resolveAstridPython(manifest, env) {
  const requestedPath = env.ASTRID_PYTHON;
  if (!requestedPath) {
    fail('ASTRID_PYTHON is required and must name the pinned absolute Python executable');
  }
  if (!isAbsolute(requestedPath)) {
    fail(`ASTRID_PYTHON must be absolute; got ${requestedPath}`);
  }
  if (/[\0\r\n]/.test(requestedPath)) {
    fail('ASTRID_PYTHON contains unsafe control characters');
  }
  if (!existsSync(requestedPath)) {
    fail(`ASTRID_PYTHON does not exist: ${requestedPath}`);
  }
  const python = realpathSync(requestedPath);
  // GNU Make expands PY/PYTHON_BIN inside shell recipes. Shell-free spawning
  // at the Node boundary is not sufficient, so accept only path characters
  // that remain one inert shell word at the nested Make boundary.
  if (!isMakeRecipeSafeExecutablePath(python)) {
    fail('ASTRID_PYTHON canonical path contains characters unsafe for Make recipes');
  }
  if (!statSync(python).isFile()) {
    fail(`ASTRID_PYTHON is not a file: ${python}`);
  }
  try {
    accessSync(python, constants.X_OK);
  } catch {
    fail(`ASTRID_PYTHON is not executable: ${python}`);
  }
  const probe = runCaptured(
    python,
    [
      '-c',
      'import json, os, platform, sys; print(json.dumps({'
        + '"executable": os.path.realpath(sys.executable), '
        + '"implementation": platform.python_implementation(), '
        + '"version": ".".join(map(str, sys.version_info[:3]))}))',
    ],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (probe.error || probe.status !== 0) {
    fail(`ASTRID_PYTHON is not a usable Python interpreter: ${formatFailure(probe)}`);
  }

  let identity;
  try {
    identity = JSON.parse(probe.stdout.trim());
  } catch {
    fail('ASTRID_PYTHON is not a Python interpreter (identity probe was invalid)');
  }
  if (
    !isPlainObject(identity)
    || typeof identity.implementation !== 'string'
    || identity.implementation.trim() === ''
    || identity.executable !== python
  ) {
    fail(
      `ASTRID_PYTHON interpreter identity mismatch: expected executable ${python}, `
      + `got ${identity?.executable ?? '<invalid>'}`,
    );
  }
  if (identity.version !== manifest.verification.astridPython) {
    fail(
      `Astrid Python version mismatch: expected ${manifest.verification.astridPython}, `
      + `got ${identity.version ?? '<invalid>'} from ${python}`,
    );
  }
  return python;
}

function assertToolchain(manifest, env) {
  const nodeVersion = process.version.replace(/^v/, '');
  if (nodeVersion !== manifest.verification.node) {
    fail(
      `Node version mismatch: expected ${manifest.verification.node}, got ${nodeVersion}`,
    );
  }
  const npmVersion = outputOf('npm', ['--version'], REPO_ROOT);
  if (npmVersion !== manifest.verification.npm) {
    fail(
      `npm version mismatch: expected ${manifest.verification.npm}, got ${npmVersion}`,
    );
  }
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const firstLine = outputOf(tool, ['-version'], REPO_ROOT).split('\n')[0];
    const match = firstLine.match(new RegExp(`^${tool} version ([0-9]+\\.[0-9]+\\.[0-9]+)(?:[ -]|$)`));
    const version = match?.[1];
    if (version !== manifest.verification[tool]) {
      fail(
        `${tool} version mismatch: expected ${manifest.verification[tool]}, `
        + `got ${version ?? '<invalid>'}`,
      );
    }
  }
  return resolveAstridPython(manifest, env);
}

export function executeSteps(steps, spawn = spawnSync, { diskRecheck } = {}) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (diskRecheck) diskRecheck(step);
    console.log(`\n${LABEL} [${index + 1}/${steps.length}] ${step.label}`);
    console.log(`${LABEL} cwd: ${step.cwd}`);
    console.log(`${LABEL} $ ${formatCommand(step)}`);

    const result = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: buildSanitizedEnvironment(step.env),
      shell: false,
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0) {
      fail(`gate ${step.id} failed: ${formatFailure(result)}`);
    }
  }
}

function printHelp() {
  console.log(`Usage: npm run verify:extension-ship -- [--plan | --dry-run]

Verify the frozen extension ship-quality release candidate. The run mode:
  1. requires a frozen release manifest and pinned Node/npm toolchain;
  2. requires an annotated Reigh tag and REIGH_REF resolving to the exact code
     candidate, plus a clean evidence-only controller descendant;
  3. fails before creating its isolated HOME unless commit-sized disk capacity
     is available, and rechecks capacity before every allocation-heavy gate;
  4. runs the code-owned Reigh release gate profile from a fresh detached
     worktree at the verified controller commit; and
  5. runs \`make ci\` in the pinned Astrid checkout.

Options:
  --plan, --dry-run  Print every gate and precondition without executing commands.
  -h, --help         Show this help.

Required environment for run mode:
  REIGH_REF         Full 40-character commit equal to the annotated candidate tag.
  ASTRID_CHECKOUT    Absolute path to the clean Astrid checkout.
  ASTRID_REF         Full 40-character commit equal to the manifest Astrid pin.
  ASTRID_PYTHON      Absolute executable matching the manifest Python pin.

Optional environment for run mode:
  ${DISK_BUDGET_OVERRIDE_ENV}  Unsigned byte count that may raise, never lower,
                               the code-calculated disk requirement.

The verifier never fetches, checks out, resets, cleans, migrates production data,
or rolls back a repository. Reigh HEAD must be a strict descendant whose entire
candidate..HEAD history changes only the ledger, the manifest status, and the
manifest release's evidence-directory artifacts. It stops at the first mismatch
or failed gate.`);
}

function printPlan(manifest, packageJson, env) {
  validatePackageJson(packageJson, manifest);
  const steps = buildExecutionPlan({
    repoRoot: RELEASE_REIGH_WORKTREE,
    astridCheckout: env.ASTRID_CHECKOUT,
    astridPython: env.ASTRID_PYTHON,
    astridRef: env.ASTRID_REF,
    reighRef: env.REIGH_REF,
  });

  console.log(`${LABEL} PLAN ONLY — no commands will execute`);
  console.log(`${LABEL} release: ${manifest.release}`);
  console.log(`${LABEL} manifest status: ${manifest.status}`);
  console.log(`${LABEL} Reigh branch: ${manifest.reigh.branch}`);
  console.log(`${LABEL} Reigh annotated release tag: ${manifest.reigh.releaseTag}`);
  console.log(`${LABEL} Reigh base: ${manifest.reigh.baseCommit}`);
  console.log(`${LABEL} Reigh env ref: ${env.REIGH_REF || '<required for execution>'}`);
  console.log(`${LABEL} Astrid manifest pin: ${manifest.astrid.commit}`);
  console.log(`${LABEL} Astrid checkout: ${env.ASTRID_CHECKOUT || '<required for execution>'}`);
  console.log(`${LABEL} Astrid env ref: ${env.ASTRID_REF || '<required for execution>'}`);
  console.log(`${LABEL} Astrid Python: ${env.ASTRID_PYTHON || '<required for execution>'}`);
  console.log(
    `${LABEL} toolchain: node ${manifest.verification.node}, `
    + `npm ${manifest.verification.npm}, Astrid Python ${manifest.verification.astridPython}, `
    + `FFmpeg ${manifest.verification.ffmpeg}, FFprobe ${manifest.verification.ffprobe}`,
  );
  console.log(`${LABEL} preflight: exact toolchain; clean worktrees; candidate tag; evidence-only ancestry`);
  console.log(
    `${LABEL} disk preflight: commit-tree archive peak + ${RELEASE_OPERATIONAL_ALLOWANCE_BYTES / GIB} GiB `
    + `operational allowance; ${DISK_BUDGET_OVERRIDE_ENV} may only raise it`,
  );
  console.log(`${LABEL} Reigh execution root: fresh detached worktree ${RELEASE_REIGH_WORKTREE}`);

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    console.log(
      `${LABEL} ${String(index + 1).padStart(2, '0')}. ${step.label}: `
      + `(cwd ${step.cwd}) ${formatCommand(step)}`,
    );
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCliArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = validateReleaseManifest(
    JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
  );

  if (options.mode === 'plan') {
    printPlan(manifest, packageJson, env);
    return;
  }

  validatePackageJson(packageJson, manifest);
  console.log(`${LABEL} preflight for ${manifest.release}`);
  if (manifest.status !== 'frozen') {
    fail(
      `release manifest status is ${manifest.status}; `
      + 'run mode requires status=frozen (use --plan during integration)',
    );
  }
  let releaseHomePrepared = false;
  let releaseReighWorktree;
  try {
    const astridPython = assertToolchain(manifest, env);
    const reigh = assertReighCheckout(manifest, env);
    const astrid = resolveAstridCheckout(manifest, env);
    console.log(`${LABEL} Reigh candidate: ${reigh.candidateCommit}`);
    console.log(`${LABEL} Reigh HEAD: ${reigh.head}`);
    console.log(`${LABEL} Reigh annotated tag object: ${reigh.tagObject}`);
    console.log(`${LABEL} Reigh evidence directory: ${reigh.provenance.evidenceDirectory}`);
    console.log(`${LABEL} Astrid HEAD: ${astrid.commit}`);
    const reighTreeBytes = measureCommitTreeBytes(REPO_ROOT, reigh.head);
    const astridTreeBytes = measureCommitTreeBytes(astrid.checkout, astrid.commit);
    const diskBudget = assertReleaseDiskCapacity({
      reighTreeBytes,
      astridTreeBytes,
      astridCheckout: astrid.checkout,
      env,
    });
    console.log(
      `${LABEL} disk capacity: requires ${formatBytes(diskBudget.requiredBytes)}; `
      + `Reigh tree ${formatBytes(reighTreeBytes)}; Astrid tree ${formatBytes(astridTreeBytes)}`,
    );
    prepareReleaseHome();
    releaseHomePrepared = true;
    releaseReighWorktree = RELEASE_REIGH_WORKTREE;
    createReleaseReighWorktree(reigh.head);
    console.log(`${LABEL} isolated Reigh controller: ${releaseReighWorktree}`);

    const steps = buildExecutionPlan({
      repoRoot: releaseReighWorktree,
      astridCheckout: astrid.checkout,
      astridPython,
      astridRef: env.ASTRID_REF,
      reighRef: env.REIGH_REF,
    });
    executeSteps(steps, spawnSync, {
      diskRecheck: (step) => assertHeavyStepDiskCapacity(step, {
        astridCheckout: astrid.checkout,
      }),
    });
    assertClean(releaseReighWorktree, 'isolated Reigh evidence controller after gates');

    // Gates must not leave tracked or untracked release inputs behind.
    const finalReigh = assertReighCheckout(manifest, env);
    if (
      finalReigh.head !== reigh.head
      || finalReigh.candidateCommit !== reigh.candidateCommit
      || finalReigh.tagObject !== reigh.tagObject
    ) {
      fail('Reigh controller HEAD, candidate commit, or annotated tag changed during verification');
    }
    const finalAstrid = resolveAstridCheckout(manifest, env);
    if (finalAstrid.commit !== astrid.commit) {
      fail('Astrid commit changed during verification');
    }

    console.log(`\n${LABEL} PASS: ${manifest.release} passed all ${steps.length} pinned gates`);
  } finally {
    try {
      if (releaseReighWorktree) removeReleaseReighWorktree();
    } finally {
      if (releaseHomePrepared) cleanupReleaseHome();
    }
  }
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    console.error(`${LABEL} FAIL: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
