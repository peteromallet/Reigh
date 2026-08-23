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
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  { id: 'dependencies', label: 'install locked Reigh dependencies', command: 'npm', args: ['ci'] },
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
  { id: 'lint', label: 'Reigh lint', command: 'npm', args: ['run', 'lint'] },
  { id: 'typecheck', label: 'Reigh strict-island typecheck', command: 'npm', args: ['run', 'typecheck:strict-probe'] },
  { id: 'unit', label: 'complete Reigh unit suite', command: 'npm', args: ['test'] },
  { id: 'extension-tests', label: 'extension contract suite', command: 'npm', args: ['run', 'test:extensions'] },
  { id: 'creative-lab', label: 'Creative Lab extension suite', command: 'npm', args: ['run', 'test:creative-extension'] },
  { id: 'compatibility', label: 'extension compatibility matrix', command: 'npm', args: ['run', 'test:extension-compatibility'] },
  { id: 'production-smoke', label: 'production extension smoke suite', command: 'npm', args: ['run', 'test:extensions:production-smoke'] },
  { id: 'readiness', label: 'extension readiness suite', command: 'npm', args: ['run', 'test:readiness'] },
  { id: 'readiness-e2e', label: 'extension harness browser suite', command: 'npm', args: ['run', 'test:readiness:e2e'] },
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

const RELEASE_TMPDIR = '/tmp';
const RELEASE_HOME = resolve(
  RELEASE_TMPDIR,
  `reigh-extension-ship-home-${process.pid}`,
);
const RELEASE_PATH = [
  dirname(realpathSync(process.execPath)),
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
].filter((entry, index, entries) => entries.indexOf(entry) === index).join(':');
const ALLOWED_STEP_ENV = new Set(['PY', 'PYTHON_BIN']);

export const isMakeRecipeSafeExecutablePath = (value) => (
  typeof value === 'string' && /^\/[A-Za-z0-9._/+:-]+$/.test(value)
);

class UsageError extends Error {}

function fail(message) {
  throw new Error(message);
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
  if (!/^[0-9a-f]{12,40}$/.test(astrid.commit ?? '')) {
    errors.push('astrid.commit must be a 12-40 character lowercase commit pin');
  }
  if (verification.profile !== 'extension-ship-quality-v1') {
    errors.push('verification.profile must be extension-ship-quality-v1');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.node ?? '')) {
    errors.push('verification.node must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.npm ?? '')) {
    errors.push('verification.npm must be an exact semantic version');
  }
  if (!/^\d+\.\d+\.\d+$/.test(verification.astridPython ?? '')) {
    errors.push('verification.astridPython must be an exact semantic version');
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

  if (errors.length > 0) {
    fail(`invalid release package configuration:\n- ${errors.join('\n- ')}`);
  }
}

export function buildExecutionPlan({ repoRoot, astridCheckout, astridPython }) {
  const astridCwd = astridCheckout || '<ASTRID_CHECKOUT required for execution>';
  const python = astridPython || '<ASTRID_PYTHON required for execution>';
  return [
    ...REIGH_GATE_PROFILE.map((gate) => ({ ...gate, cwd: repoRoot })),
    ...ASTRID_GATE_PROFILE.map(({ cwdSuffix, ...gate }) => ({
      ...gate,
      env: gate.id === 'astrid-ci'
        ? { PY: python, PYTHON_BIN: python }
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

function runCaptured(command, args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: buildSanitizedEnvironment(),
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
  const status = outputOf(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    checkout,
  );
  if (status !== '') {
    const preview = status.split('\n').slice(0, 20).join('\n');
    fail(
      `${name} checkout is not clean (${checkout}). `
      + `The verifier will not reset or clean it:\n${preview}`,
    );
  }
}

function resolveCommit(checkout, ref, name) {
  if (!/^[0-9a-f]{12,40}$/.test(ref)) {
    fail(`${name} must be a 12-40 character lowercase commit pin; got ${ref}`);
  }
  return outputOf(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    checkout,
  );
}

function assertReighCheckout(manifest, env) {
  const branch = outputOf('git', ['branch', '--show-current'], REPO_ROOT);
  if (branch !== manifest.reigh.branch) {
    fail(`Reigh branch mismatch: expected ${manifest.reigh.branch}, got ${branch || '<detached>'}`);
  }

  const baseCommit = resolveCommit(
    REPO_ROOT,
    manifest.reigh.baseCommit,
    'manifest reigh.baseCommit',
  );
  const ancestry = runCaptured(
    'git',
    ['merge-base', '--is-ancestor', baseCommit, 'HEAD'],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (ancestry.error || ancestry.status !== 0) {
    fail(`Reigh HEAD is not descended from pinned base ${manifest.reigh.baseCommit}`);
  }
  if (!/^[0-9a-f]{40}$/.test(env.REIGH_REF ?? '')) {
    fail('REIGH_REF is required and must be a full 40-character lowercase commit');
  }
  const expectedHead = resolveCommit(
    REPO_ROOT,
    env.REIGH_REF,
    'REIGH_REF',
  );
  const head = outputOf('git', ['rev-parse', 'HEAD'], REPO_ROOT);
  if (head !== expectedHead) {
    fail(`Reigh HEAD mismatch: expected ${expectedHead}, got ${head}`);
  }
  const tagRef = `refs/tags/${manifest.reigh.releaseTag}`;
  const tagObject = runCaptured(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${tagRef}^{tag}`],
    REPO_ROOT,
    { allowFailure: true },
  );
  if (tagObject.error || tagObject.status !== 0) {
    fail(`Reigh release tag must exist and be annotated: ${manifest.reigh.releaseTag}`);
  }
  const tagCommit = outputOf(
    'git',
    ['rev-parse', '--verify', '--end-of-options', `${tagRef}^{commit}`],
    REPO_ROOT,
  );
  if (tagCommit !== head) {
    fail(
      `Reigh release tag ${manifest.reigh.releaseTag} resolves to ${tagCommit}, not HEAD ${head}`,
    );
  }
  assertClean(REPO_ROOT, 'Reigh');
  return {
    baseCommit,
    branch,
    head,
    releaseTag: manifest.reigh.releaseTag,
    tagObject: tagObject.stdout.trim(),
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
  return resolveAstridPython(manifest, env);
}

export function executeSteps(steps, spawn = spawnSync) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
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
  2. requires clean Reigh and Astrid worktrees at the configured refs and an
     annotated Reigh release tag resolving to the exact candidate commit;
  3. runs the code-owned Reigh release gate profile; and
  4. runs \`make ci\` in the pinned Astrid checkout.

Options:
  --plan, --dry-run  Print every gate and precondition without executing commands.
  -h, --help         Show this help.

Required environment for run mode:
  REIGH_REF         Full 40-character commit equal to the candidate checkout HEAD.
  ASTRID_CHECKOUT    Absolute path to the clean Astrid checkout.
  ASTRID_REF         12-40 character commit resolving to the manifest Astrid pin.
  ASTRID_PYTHON      Absolute executable matching the manifest Python pin.

The verifier never fetches, checks out, resets, cleans, migrates production data,
or rolls back a repository. It stops at the first mismatch or failed gate.`);
}

function printPlan(manifest, packageJson, env) {
  validatePackageJson(packageJson, manifest);
  const steps = buildExecutionPlan({
    repoRoot: REPO_ROOT,
    astridCheckout: env.ASTRID_CHECKOUT,
    astridPython: env.ASTRID_PYTHON,
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
    + `npm ${manifest.verification.npm}, Astrid Python ${manifest.verification.astridPython}`,
  );
  console.log(`${LABEL} preflight: exact toolchain; clean worktrees; branch/ref/ancestry checks`);

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
  prepareReleaseHome();
  try {
    const astridPython = assertToolchain(manifest, env);
    const reigh = assertReighCheckout(manifest, env);
    const astrid = resolveAstridCheckout(manifest, env);
    console.log(`${LABEL} Reigh HEAD: ${reigh.head}`);
    console.log(`${LABEL} Reigh annotated tag object: ${reigh.tagObject}`);
    console.log(`${LABEL} Astrid HEAD: ${astrid.commit}`);

    const steps = buildExecutionPlan({
      repoRoot: REPO_ROOT,
      astridCheckout: astrid.checkout,
      astridPython,
    });
    executeSteps(steps);

    // Gates must not leave tracked or untracked release inputs behind.
    const finalReigh = assertReighCheckout(manifest, env);
    if (finalReigh.head !== reigh.head || finalReigh.tagObject !== reigh.tagObject) {
      fail('Reigh commit or annotated tag changed during verification');
    }
    const finalAstrid = resolveAstridCheckout(manifest, env);
    if (finalAstrid.commit !== astrid.commit) {
      fail('Astrid commit changed during verification');
    }

    console.log(`\n${LABEL} PASS: ${manifest.release} passed all ${steps.length} pinned gates`);
  } finally {
    cleanupReleaseHome();
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
