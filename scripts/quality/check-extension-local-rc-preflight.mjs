#!/usr/bin/env node

/**
 * Cheap, read-only readiness probe for the local Reigh/Astrid RC pair.
 *
 * This is intentionally a preflight, not a second verifier: it does not
 * install dependencies, create worktrees, fetch/tag commits, or run gates.
 * It answers whether the expensive frozen verifier is likely to be admitted
 * and reports external/human evidence blockers separately.
 */

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildPreflight as buildExternalPreflight } from './check-extension-release-preflight.mjs';
import {
  ATTESTATION_TRUST_PATH,
  CHECKLIST_PATH,
  LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
} from './check-extension-ship-evidence.mjs';
import { assertPinnedPlatform, attestNativeTools, resolvePinnedExecutable } from '../release/native-tool-attestation.mjs';
import { resolvePinnedPythonExecutable } from '../release/pinned-python-runtime.mjs';
import { availableBytesAt } from '../release/verify-extension-ship.mjs';

const LABEL = '[extension-local-rc-preflight]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
const GIB = 1024n ** 3n;
export const DOCUMENTED_MIN_FREE_BYTES = 11n * GIB;
export const ASTRID_MIN_FREE_BYTES = 2n * GIB;
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const FULL_COMMIT = /^[0-9a-f]{40}$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

const GIT_ENV = Object.freeze({
  PATH: [dirname(realpathSync(process.execPath)), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    .filter((entry, index, entries) => entries.indexOf(entry) === index).join(delimiter),
  LANG: 'C',
  LC_ALL: 'C',
  TZ: 'UTC',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_COUNT: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeTag(tag) {
  return typeof tag === 'string'
    && SAFE_TAG.test(tag)
    && !tag.includes('..')
    && !tag.includes('//')
    && !tag.endsWith('/')
    && !tag.endsWith('.');
}

function formatBytes(bytes) {
  return `${(Number(bytes) / Number(GIB)).toFixed(2)} GiB`;
}

function resultDetail(result) {
  if (result?.error) return result.error.message;
  if (result?.status !== 0) return result?.stderr?.trim() || `exit ${result?.status ?? 'unknown'}`;
  return '';
}

function runCommand(command, args, cwd, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${command} ${args.join(' ')} failed: ${resultDetail(result)}`);
  }
  return result;
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  return runCommand('git', ['--no-replace-objects', ...args], repoRoot, { allowFailure });
}

function gitOutput(repoRoot, args, options = {}) {
  return git(repoRoot, args, options).stdout.trim();
}

function resolveCommit(repoRoot, value, label) {
  if (!FULL_COMMIT.test(value ?? '')) throw new Error(`${label} must be a full 40-character lowercase commit`);
  const commit = gitOutput(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`]);
  if (!FULL_COMMIT.test(commit)) throw new Error(`${label} does not resolve to a full commit`);
  return commit;
}

function checkWorktree(repoRoot, label) {
  const status = gitOutput(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error(`${label} worktree is not clean:\n${status}`);
  const suspicious = new Set();
  for (const mode of ['-v', '-f']) {
    for (const entry of gitOutput(repoRoot, ['ls-files', mode, '-z']).split('\0').filter(Boolean)) {
      if (!entry.startsWith('H ')) suspicious.add(entry.slice(2));
    }
  }
  if (suspicious.size) throw new Error(`${label} index has non-normal entries: ${[...suspicious].sort().join(', ')}`);
}

function checkDisk({ statfs = statfsSync, diskPath = realpathSync(tmpdir()) } = {}) {
  const probe = availableBytesAt(diskPath, { statfs });
  if (probe.availableBytes < DOCUMENTED_MIN_FREE_BYTES) {
    throw new Error(`requires at least 11 GiB free at ${probe.target}; available ${formatBytes(probe.availableBytes)}`);
  }
  return `11 GiB floor satisfied at ${probe.target} (${formatBytes(probe.availableBytes)} free)`;
}

function checkAstridVolume({ astridCheckout, statfs = statfsSync } = {}) {
  if (typeof astridCheckout !== 'string' || astridCheckout === '') {
    throw new Error('ASTRID_CHECKOUT is required before measuring Astrid volume capacity');
  }
  if (!isAbsolute(astridCheckout)) throw new Error(`ASTRID_CHECKOUT must be absolute; got ${astridCheckout}`);
  const target = realpathSync(astridCheckout);
  const stats = statfs(target, { bigint: true });
  if (typeof stats?.bavail !== 'bigint' || typeof stats?.bsize !== 'bigint' || stats.bavail < 0n || stats.bsize <= 0n) {
    throw new Error(`filesystem capacity probe returned invalid fields for ${target}`);
  }
  const availableBytes = stats.bavail * stats.bsize;
  if (availableBytes < ASTRID_MIN_FREE_BYTES) {
    throw new Error(`requires at least 2 GiB free on Astrid volume; available ${formatBytes(availableBytes)}`);
  }
  return `Astrid volume floor satisfied at ${target} (${formatBytes(availableBytes)} free)`;
}

function checkReigh(manifest, ledger, repoRoot) {
  const branch = gitOutput(repoRoot, ['branch', '--show-current']);
  if (branch !== manifest?.reigh?.branch) throw new Error(`expected branch ${manifest?.reigh?.branch}, got ${branch || '<detached>'}`);
  const head = resolveCommit(repoRoot, gitOutput(repoRoot, ['rev-parse', 'HEAD']), 'Reigh HEAD');
  const base = resolveCommit(repoRoot, manifest?.reigh?.baseCommit, 'manifest reigh.baseCommit');
  const ancestry = git(repoRoot, ['merge-base', '--is-ancestor', base, head], { allowFailure: true });
  if (ancestry.error || ancestry.status !== 0) throw new Error(`HEAD ${head} is not descended from manifest base ${base}`);
  const candidate = ledger?.candidate?.reighCommit;
  if (manifest.status === 'frozen') {
    if (!FULL_COMMIT.test(candidate ?? '')) throw new Error('frozen ledger candidate.reighCommit must be a full commit');
    const resolvedCandidate = resolveCommit(repoRoot, candidate, 'ledger candidate.reighCommit');
    if (resolvedCandidate !== candidate) throw new Error('ledger candidate.reighCommit is not canonical');
    const candidateAncestor = git(repoRoot, ['merge-base', '--is-ancestor', candidate, head], { allowFailure: true });
    if (candidateAncestor.error || candidateAncestor.status !== 0) throw new Error(`frozen candidate ${candidate} is not an ancestor of HEAD ${head}`);
  } else if (candidate !== null) {
    throw new Error('integration ledger candidate.reighCommit must remain null until the candidate is frozen');
  }
  return `branch ${branch}; HEAD ${head}; base ${base}`;
}

function checkAstrid(manifest, astridCheckout) {
  if (!astridCheckout) throw new Error('ASTRID_CHECKOUT is required; the preflight never guesses a sibling checkout');
  if (!isAbsolute(astridCheckout)) throw new Error(`ASTRID_CHECKOUT must be absolute; got ${astridCheckout}`);
  if (!existsSync(astridCheckout) || !statSync(astridCheckout).isDirectory()) throw new Error(`ASTRID_CHECKOUT is not a directory: ${astridCheckout}`);
  const checkout = realpathSync(astridCheckout);
  const branch = gitOutput(checkout, ['branch', '--show-current']);
  if (branch !== manifest?.astrid?.branch) throw new Error(`expected branch ${manifest?.astrid?.branch}, got ${branch || '<detached>'}`);
  const head = resolveCommit(checkout, gitOutput(checkout, ['rev-parse', 'HEAD']), 'Astrid HEAD');
  const pin = resolveCommit(checkout, manifest?.astrid?.commit, 'manifest astrid.commit');
  if (head !== pin) throw new Error(`Astrid HEAD ${head} does not equal manifest pin ${pin}`);
  if (!existsSync(resolve(checkout, 'Makefile')) || !existsSync(resolve(checkout, 'remotion/package-lock.json'))) {
    throw new Error('Astrid checkout must contain Makefile and remotion/package-lock.json');
  }
  return `branch ${branch}; HEAD ${head} matches manifest pin`;
}

function checkManifestLedgerPins(manifest, ledger) {
  if (manifest?.release !== ledger?.release) throw new Error(`release mismatch: manifest ${manifest?.release ?? '<missing>'}, ledger ${ledger?.release ?? '<missing>'}`);
  if (!['integration', 'frozen'].includes(manifest?.status) || manifest.status !== ledger?.status) {
    throw new Error(`manifest/ledger phase must agree as integration or frozen (manifest=${manifest?.status ?? '<missing>'}, ledger=${ledger?.status ?? '<missing>'})`);
  }
  if (ledger?.candidate?.astridCommit !== manifest?.astrid?.commit) {
    throw new Error(`Astrid pin mismatch: manifest ${manifest?.astrid?.commit ?? '<missing>'}, ledger ${ledger?.candidate?.astridCommit ?? '<missing>'}`);
  }
  if (manifest.status === 'integration' && ledger?.candidate?.reighCommit !== null) {
    throw new Error('integration ledger must not claim a Reigh candidate commit');
  }
  return `release ${manifest.release}; phase ${manifest.status}; Astrid pin agrees`;
}

export function checkTagState(manifest, ledger, repoRoot) {
  const tag = manifest?.reigh?.releaseTag;
  if (!safeTag(tag)) throw new Error('manifest reigh.releaseTag is not a safe tag name');
  const ref = `refs/tags/${tag}`;
  const tagProbe = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{tag}`], { allowFailure: true });
  const anyProbe = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', ref], { allowFailure: true });
  if (manifest.status === 'integration') {
    if (!tagProbe.error && tagProbe.status === 0) throw new Error(`integration release tag ${tag} already exists as an annotated tag`);
    if (!anyProbe.error && anyProbe.status === 0) throw new Error(`integration release tag ${tag} already exists; remove/rename it before freezing`);
    return `integration phase: release tag ${tag} is absent`;
  }
  if (tagProbe.error || tagProbe.status !== 0) throw new Error(`frozen phase requires annotated tag ${tag}`);
  const taggedCommit = gitOutput(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!FULL_COMMIT.test(taggedCommit)) throw new Error(`release tag ${tag} does not resolve to a full commit`);
  if (taggedCommit !== ledger?.candidate?.reighCommit) throw new Error(`tag ${tag} resolves to ${taggedCommit}, not ledger candidate ${ledger?.candidate?.reighCommit ?? '<missing>'}`);
  return `frozen phase: annotated tag ${tag} resolves to ${taggedCommit}`;
}

function checkNodeNpm(manifest, { nodeVersion = process.version.replace(/^v/, ''), pathValue = process.env.PATH } = {}) {
  if (nodeVersion !== manifest?.verification?.node) throw new Error(`Node ${nodeVersion} does not match pinned ${manifest?.verification?.node}`);
  const npm = resolvePinnedExecutable('npm', { pathValue });
  const result = spawnSync(npm, ['--version'], { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024, env: GIT_ENV });
  if (result.error || result.status !== 0) throw new Error(`npm probe failed: ${resultDetail(result)}`);
  const version = result.stdout.trim();
  if (version !== manifest?.verification?.npm) throw new Error(`npm ${version} does not match pinned ${manifest?.verification?.npm}`);
  return `Node ${nodeVersion}; npm ${version}`;
}

function checkPython(manifest, { pythonPath = process.env.ASTRID_PYTHON, pathValue = process.env.PATH } = {}) {
  const python = resolvePinnedPythonExecutable({ requested: pythonPath, pathValue });
  return `Python ${manifest?.verification?.astridPython} available at ${python}`;
}

function checkNative(manifest, { pathValue = GIT_ENV.PATH, nativeAttest = attestNativeTools } = {}) {
  const attestation = nativeAttest({
    manifest,
    pathValue,
    run(executable, args) {
      return spawnSync(executable, args, { encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER_BYTES, env: GIT_ENV });
    },
  });
  assertPinnedPlatform(manifest, attestation.platform);
  return `platform ${attestation.platform.os}/${attestation.platform.arch}/${attestation.platform.release}; FFmpeg ${attestation.tools.ffmpeg.version}; FFprobe ${attestation.tools.ffprobe.version}; Tesseract ${attestation.tools.tesseract.version}; ImageMagick ${attestation.tools.imageMagick.version}`;
}

function localChecks({ manifest, ledger, repoRoot = REPO_ROOT, astridCheckout, env = process.env, dependencies = {} }) {
  const checks = [];
  const blockers = [];
  const add = (id, fn) => {
    try {
      const detail = fn();
      checks.push({ id, status: 'pass', detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      checks.push({ id, status: 'blocked', detail });
      blockers.push(`${id}: ${detail}`);
    }
  };

  add('disk-floor', () => checkDisk(dependencies));
  add('manifest-ledger-pins', () => checkManifestLedgerPins(manifest, ledger));
  add('reigh-branch-commit', () => checkReigh(manifest, ledger, repoRoot));
  add('reigh-worktree-clean', () => checkWorktree(repoRoot, 'Reigh'));
  add('astrid-branch-commit', () => checkAstrid(manifest, astridCheckout ?? env.ASTRID_CHECKOUT));
  add('astrid-worktree-clean', () => {
    const checkout = realpathSync(astridCheckout ?? env.ASTRID_CHECKOUT);
    checkWorktree(checkout, 'Astrid');
    return `clean worktree ${checkout}`;
  });
  add('astrid-volume-floor', () => checkAstridVolume({ ...dependencies, astridCheckout: astridCheckout ?? env.ASTRID_CHECKOUT }));
  add('tag-state', () => checkTagState(manifest, ledger, repoRoot));
  add('node-npm', () => checkNodeNpm(manifest, dependencies));
  add('astrid-python', () => checkPython(manifest, { pythonPath: env.ASTRID_PYTHON, pathValue: dependencies.pathValue ?? env.PATH }));
  add('native-tools', () => checkNative(manifest, dependencies));
  return { ready: blockers.length === 0, blockers, checks };
}

function splitExternalBlockers(blockers = []) {
  const human = blockers.filter((blocker) => /(?:workstream-22|workstream-23|attestation-trust)/.test(blocker));
  const phase = blockers.filter((blocker) => /^(?:manifest-frozen|ledger-frozen):/.test(blocker));
  const external = blockers.filter((blocker) => !human.includes(blocker) && !phase.includes(blocker));
  return { external, human, phase };
}

export function buildLocalRcPreflight({
  manifest,
  ledger,
  trust,
  checklistMarkdown,
  repoRoot = REPO_ROOT,
  astridCheckout,
  env = process.env,
  dependencies = {},
} = {}) {
  const local = localChecks({ manifest, ledger, repoRoot, astridCheckout, env, dependencies });
  let externalResult;
  try {
    externalResult = buildExternalPreflight({ ledger, manifest, trust, checklistMarkdown });
  } catch (error) {
    externalResult = { ready: false, status: 'blocked', blockers: [`external-preflight: ${error.message}`], checks: [] };
  }
  const split = splitExternalBlockers(externalResult.blockers);
  return {
    schemaVersion: 1,
    release: manifest?.release ?? ledger?.release ?? null,
    phase: manifest?.status ?? null,
    status: local.ready ? 'ready-for-local-verifier' : 'blocked',
    ready: local.ready,
    local,
    external: { ready: externalResult.ready, status: externalResult.status, checks: externalResult.checks, blockers: split.external },
    human: { blockers: split.human },
    phaseBlockers: split.phase,
    blockers: { local: local.blockers, external: split.external, human: split.human, phase: split.phase },
    disclaimer: 'Read-only local preflight. It never fetches, tags, freezes, cleans, installs, creates worktrees, runs release gates, or changes external state.',
  };
}

function formatReport(result) {
  const lines = [
    `${LABEL} ${result.status.toUpperCase()}`,
    `${LABEL} release: ${result.release ?? '<unknown>'} (${result.phase ?? '<unknown phase>'})`,
    `${LABEL} ${result.disclaimer}`,
    `${LABEL} local checks:`,
    ...result.local.checks.map((check) => `- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`),
    `${LABEL} external blockers:`,
    ...(result.blockers.external.length ? result.blockers.external.map((blocker) => `- ${blocker}`) : ['- none']),
    `${LABEL} human blockers:`,
    ...(result.blockers.human.length ? result.blockers.human.map((blocker) => `- ${blocker}`) : ['- none']),
  ];
  return `${lines.join('\n')}\n`;
}

export function runCli(argv = process.argv.slice(2), env = process.env) {
  const json = argv.includes('--json');
  const help = argv.includes('--help') || argv.includes('-h');
  const unknown = argv.filter((arg) => !['--json', '--help', '-h'].includes(arg));
  if (unknown.length) {
    console.error(`${LABEL} unknown option(s): ${unknown.join(', ')}`);
    return 2;
  }
  if (help) {
    process.stdout.write(`Usage: npm run check:extension-local-rc-preflight -- [--json]\n\nRead-only, phase-aware local readiness probe. ASTRID_CHECKOUT must be an absolute path to the intended Astrid checkout; no sibling path is inferred.\n`);
    return 0;
  }
  try {
    const result = buildLocalRcPreflight({
      manifest: readJson(RELEASE_MANIFEST_PATH),
      ledger: readJson(LEDGER_PATH),
      trust: readJson(ATTESTATION_TRUST_PATH),
      checklistMarkdown: readFileSync(CHECKLIST_PATH, 'utf8'),
      env,
    });
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(`${LABEL} FAIL: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runCli();
}
