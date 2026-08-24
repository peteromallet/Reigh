import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

import { BoundedCommandError, runBoundedCommand } from './bounded-command.mjs';

export const RELEASE_LEDGER_PATH = 'config/releases/extension-ship-evidence.json';
export const RELEASE_MANIFEST_PATH = 'config/releases/extension-ship-quality.json';

const FULL_COMMIT = /^[0-9a-f]{40}$/;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
export const GIT_COMMAND_TIMEOUT_MS = 60_000;
export const GIT_COMMAND_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const GIT_PATH = [
  dirname(realpathSync(process.execPath)),
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
].filter((entry, index, entries) => entries.indexOf(entry) === index).join(':');

function fail(message) {
  throw new Error(message);
}

function gitEnvironment() {
  return {
    PATH: GIT_PATH,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_COUNT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const hardenedArgs = [
    '--no-replace-objects',
    '-c', 'core.fsmonitor=false',
    '-c', 'core.ignoreStat=false',
    '-c', `core.attributesFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    ...args,
  ];
  try {
    const result = runBoundedCommand('git', hardenedArgs, {
      cwd: repoRoot,
      env: gitEnvironment(),
      timeoutMs: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
      killSignal: 'SIGKILL',
      allowFailure,
      label: `git ${args.join(' ')}`,
    });
    if (!allowFailure && !result.ok) {
      const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
      fail(`git ${args.join(' ')} failed in ${repoRoot}: ${detail}`);
    }
    return result;
  } catch (error) {
    if (!(error instanceof BoundedCommandError)) throw error;
    const result = error.result;
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    fail(`git ${args.join(' ')} failed in ${repoRoot}: ${detail}`);
  }
}

export function assertCleanReleaseCheckout(repoRoot, label) {
  const status = runGit(
    repoRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ).stdout.trim();
  if (status !== '') {
    fail(`${label} worktree must be completely clean before release evidence is issued:\n${status}`);
  }

  const suspicious = new Set();
  for (const mode of ['-v', '-f']) {
    const records = runGit(repoRoot, ['ls-files', mode, '-z']).stdout.split('\0').filter(Boolean);
    for (const record of records) {
      if (!record.startsWith('H ')) suspicious.add(record.slice(2));
    }
  }
  if (suspicious.size > 0) {
    fail(
      `${label} index contains assume-unchanged, skip-worktree, fsmonitor-valid, or abnormal entries:\n`
      + [...suspicious].sort().map((path) => `- ${path}`).join('\n'),
    );
  }
}

function assertFullCommit(value, label) {
  if (!FULL_COMMIT.test(value ?? '')) {
    fail(`${label} must be a full 40-character lowercase commit`);
  }
}

function assertSafeRelease(release) {
  if (!SAFE_RELEASE.test(release ?? '')) {
    fail('release must be a safe path component containing only letters, digits, dot, underscore, or hyphen');
  }
}

function assertSafeTag(releaseTag) {
  if (
    !SAFE_TAG.test(releaseTag ?? '')
    || releaseTag.includes('..')
    || releaseTag.includes('//')
    || releaseTag.endsWith('/')
    || releaseTag.endsWith('.')
  ) {
    fail('release tag is not a safe annotated-tag name');
  }
}

export function releaseEvidenceDirectory(release) {
  assertSafeRelease(release);
  return `docs/extensions/evidence/releases/${release}/`;
}

export function isAllowedReleaseEvidencePath(path, release) {
  if (typeof path !== 'string' || path === '' || path.includes('\\') || path.includes('\0')) {
    return false;
  }
  if (path === RELEASE_LEDGER_PATH || path === RELEASE_MANIFEST_PATH) return true;
  const evidenceDirectory = releaseEvidenceDirectory(release);
  return path.startsWith(evidenceDirectory) && path.length > evidenceDirectory.length;
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]),
    );
  }
  return value;
}

function jsonEqual(left, right) {
  return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function readJsonAtCommit(repoRoot, commit, path) {
  return JSON.parse(runGit(repoRoot, ['show', `${commit}:${path}`]).stdout);
}

function validateManifestEdge(parentManifest, commitManifest) {
  if (jsonEqual(parentManifest, commitManifest)) return [];
  return validateManifestFreezeTransition(parentManifest, commitManifest);
}

function ledgerIdentity(ledger) {
  return Array.isArray(ledger?.workstreams)
    ? ledger.workstreams.map((workstream) => ({ id: workstream?.id, title: workstream?.title }))
    : [];
}

function validateLedgerEdge(parentLedger, commitLedger, candidateCommit) {
  const errors = [];
  if (
    parentLedger?.schemaVersion !== commitLedger?.schemaVersion
    || parentLedger?.release !== commitLedger?.release
  ) {
    errors.push('evidence ledger schemaVersion and release must not change after the candidate tag');
  }
  if (!jsonEqual(ledgerIdentity(parentLedger), ledgerIdentity(commitLedger))) {
    errors.push('evidence ledger workstream identity or ordering changed after the candidate tag');
  }
  const parentReigh = parentLedger?.candidate?.reighCommit;
  const commitReigh = commitLedger?.candidate?.reighCommit;
  if (![null, candidateCommit].includes(parentReigh) || ![null, candidateCommit].includes(commitReigh)) {
    errors.push(`evidence ledger candidate.reighCommit may only be null or ${candidateCommit}`);
  }
  if (parentReigh === candidateCommit && commitReigh === null) {
    errors.push('evidence ledger candidate.reighCommit must not revert to null once bound');
  }
  if (parentLedger?.status === 'frozen' && commitLedger?.status !== 'frozen') {
    errors.push('evidence ledger status must remain frozen once frozen');
  }
  if (!['integration', 'frozen'].includes(commitLedger?.status)) {
    errors.push('evidence ledger status after the candidate tag must be integration or frozen');
  }
  return errors;
}

/**
 * The manifest is executable release configuration, not evidence. After the
 * candidate tag it may only move from integration to frozen; pins, branches,
 * toolchains, and gate inventory must remain byte-semantically identical.
 */
export function validateManifestFreezeTransition(candidateManifest, controllerManifest) {
  const errors = [];
  if (candidateManifest?.status !== 'integration') {
    errors.push('candidate release manifest status must be integration');
  }
  if (controllerManifest?.status !== 'frozen') {
    errors.push('controller release manifest status must be frozen');
  }
  const candidateWithoutStatus = { ...candidateManifest };
  const controllerWithoutStatus = { ...controllerManifest };
  delete candidateWithoutStatus.status;
  delete controllerWithoutStatus.status;
  if (!jsonEqual(candidateWithoutStatus, controllerWithoutStatus)) {
    errors.push('release manifest changed after the candidate tag outside the exact status freeze');
  }
  return errors;
}

export function validateLedgerFreezeTransition(candidateLedger, controllerLedger, candidateCommit) {
  const errors = [];
  if (candidateLedger?.status !== 'integration') {
    errors.push('candidate evidence ledger status must be integration');
  }
  if (controllerLedger?.status !== 'frozen') {
    errors.push('controller evidence ledger status must be frozen');
  }
  if (candidateLedger?.candidate?.reighCommit !== null) {
    errors.push('candidate-commit ledger must leave candidate.reighCommit null');
  }
  if (controllerLedger?.candidate?.reighCommit !== candidateCommit) {
    errors.push(`controller ledger candidate.reighCommit must equal tagged candidate ${candidateCommit}`);
  }
  if (
    candidateLedger?.schemaVersion !== controllerLedger?.schemaVersion
    || candidateLedger?.release !== controllerLedger?.release
  ) {
    errors.push('evidence ledger schemaVersion and release must not change after the candidate tag');
  }
  if (!jsonEqual(ledgerIdentity(candidateLedger), ledgerIdentity(controllerLedger))) {
    errors.push('evidence ledger workstream identity or ordering changed after the candidate tag');
  }
  return errors;
}

export function resolveAnnotatedCandidateTag({ repoRoot, releaseTag }) {
  assertSafeTag(releaseTag);
  const tagRef = `refs/tags/${releaseTag}`;
  const tagObject = runGit(
    repoRoot,
    ['rev-parse', '--verify', '--end-of-options', `${tagRef}^{tag}`],
    { allowFailure: true },
  );
  if (tagObject.error || tagObject.status !== 0) {
    fail(`Reigh release tag must exist and be annotated: ${releaseTag}`);
  }
  const candidateCommit = runGit(
    repoRoot,
    ['rev-parse', '--verify', '--end-of-options', `${tagRef}^{commit}`],
  ).stdout.trim();
  assertFullCommit(candidateCommit, `release tag ${releaseTag}`);
  return Object.freeze({
    candidateCommit,
    releaseTag,
    tagObject: tagObject.stdout.trim(),
  });
}

function isAncestor(repoRoot, ancestor, descendant) {
  const result = runGit(
    repoRoot,
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { allowFailure: true },
  );
  return !result.error && result.status === 0;
}

function changedPathsOnEdge(repoRoot, parent, commit) {
  const output = runGit(
    repoRoot,
    ['diff', '--name-only', '--no-renames', '-z', parent, commit],
  ).stdout;
  return output.split('\0').filter(Boolean);
}

function treeEntries(repoRoot, commit, paths) {
  const output = runGit(
    repoRoot,
    ['ls-tree', '-r', '-z', '--full-tree', commit, '--', ...paths],
  ).stdout;
  const entries = new Map();
  for (const record of output.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    if (separator === -1) fail(`malformed Git tree entry at ${commit}`);
    const [mode, type, object] = record.slice(0, separator).split(' ');
    const path = record.slice(separator + 1);
    entries.set(path, Object.freeze({ mode, type, object, path }));
  }
  return entries;
}

function assertOrdinaryBlob(entry, commit, path) {
  if (!entry || entry.mode !== '100644' || entry.type !== 'blob') {
    fail(
      `allowed release evidence path must remain a committed non-executable regular blob: `
      + `${path} at ${commit}`,
    );
  }
}

function sameTreeEntry(left, right) {
  return left?.mode === right?.mode
    && left?.type === right?.type
    && left?.object === right?.object;
}

function isEvidenceArtifactPath(path, release) {
  const directory = releaseEvidenceDirectory(release);
  return path.startsWith(directory) && path.length > directory.length;
}

/**
 * Validate every edge in candidate..HEAD, including every parent of merges.
 * Looking only at the final tree would allow source drift that was later
 * reverted to disappear from the audit. Merge parents are also required to
 * descend from the candidate so unrelated history cannot enter the controller.
 */
export function inspectCandidateController({
  repoRoot,
  candidateCommit,
  headCommit,
  release,
}) {
  assertFullCommit(candidateCommit, 'candidate commit');
  assertFullCommit(headCommit, 'controller HEAD');
  assertSafeRelease(release);
  if (candidateCommit === headCommit) {
    fail('controller HEAD must be a strict evidence-only descendant of the candidate commit');
  }
  if (!isAncestor(repoRoot, candidateCommit, headCommit)) {
    fail(`controller HEAD ${headCommit} is not descended from candidate ${candidateCommit}`);
  }
  const shallow = runGit(repoRoot, ['rev-parse', '--is-shallow-repository']).stdout.trim();
  if (shallow !== 'false') {
    fail('release provenance requires a complete, non-shallow Git repository');
  }

  const revisions = runGit(
    repoRoot,
    ['rev-list', '--reverse', '--parents', `${candidateCommit}..${headCommit}`],
  ).stdout.trim().split('\n').filter(Boolean);
  if (revisions.length === 0) {
    fail('candidate..HEAD contains no evidence descendant commits');
  }

  const changedPaths = new Set();
  const candidateEvidenceEntries = treeEntries(repoRoot, candidateCommit, [releaseEvidenceDirectory(release)]);
  for (const [path, entry] of candidateEvidenceEntries) {
    assertOrdinaryBlob(entry, candidateCommit, path);
  }
  const everEvidencePaths = new Set(candidateEvidenceEntries.keys());
  for (const revision of revisions) {
    const [commit, ...parents] = revision.trim().split(/\s+/);
    if (parents.length === 0) fail(`release descendant ${commit} has no parent`);
    const commitChangedPaths = new Set();
    for (const parent of parents) {
      if (parent !== candidateCommit && !isAncestor(repoRoot, candidateCommit, parent)) {
        fail(`release descendant ${commit} merges parent ${parent} from outside the candidate history`);
      }
      const edgePaths = changedPathsOnEdge(repoRoot, parent, commit);
      for (const path of edgePaths) commitChangedPaths.add(path);
      for (const path of edgePaths) {
        changedPaths.add(path);
      }
      if (edgePaths.includes(RELEASE_MANIFEST_PATH)) {
        assertOrdinaryBlob(
          treeEntries(repoRoot, commit, [RELEASE_MANIFEST_PATH]).get(RELEASE_MANIFEST_PATH),
          commit,
          RELEASE_MANIFEST_PATH,
        );
        const manifestErrors = validateManifestEdge(
          readJsonAtCommit(repoRoot, parent, RELEASE_MANIFEST_PATH),
          readJsonAtCommit(repoRoot, commit, RELEASE_MANIFEST_PATH),
        );
        if (manifestErrors.length > 0) {
          fail(`invalid release manifest edge ${parent}..${commit}:\n${manifestErrors.join('\n')}`);
        }
      }
      if (edgePaths.includes(RELEASE_LEDGER_PATH)) {
        assertOrdinaryBlob(
          treeEntries(repoRoot, commit, [RELEASE_LEDGER_PATH]).get(RELEASE_LEDGER_PATH),
          commit,
          RELEASE_LEDGER_PATH,
        );
        const ledgerErrors = validateLedgerEdge(
          readJsonAtCommit(repoRoot, parent, RELEASE_LEDGER_PATH),
          readJsonAtCommit(repoRoot, commit, RELEASE_LEDGER_PATH),
          candidateCommit,
        );
        if (ledgerErrors.length > 0) {
          fail(`invalid evidence ledger edge ${parent}..${commit}:\n${ledgerErrors.join('\n')}`);
        }
      }
    }

    const evidencePathsChangedOnEdge = [...commitChangedPaths]
      .filter((path) => isEvidenceArtifactPath(path, release));
    if (evidencePathsChangedOnEdge.length > 0) {
      const commitEntries = treeEntries(repoRoot, commit, [releaseEvidenceDirectory(release)]);
      const parentEntries = new Map(
        parents.map((parent) => [
          parent,
          treeEntries(repoRoot, parent, [releaseEvidenceDirectory(release)]),
        ]),
      );
      for (const path of evidencePathsChangedOnEdge) {
        const commitEntry = commitEntries.get(path);
        const parentEntryList = parents.map((parent) => parentEntries.get(parent).get(path));
        const inheritedEntry = parentEntryList.find((entry) => sameTreeEntry(entry, commitEntry));
        const existingParentEntry = parentEntryList.find(Boolean);

        if (!commitEntry && parentEntryList.some(Boolean)) {
          for (const parentEntry of parentEntryList) {
            if (parentEntry) {
              fail(`release evidence path must never be deleted or renamed: ${path} at ${commit}`);
            }
          }
        } else if (commitEntry && existingParentEntry && !inheritedEntry) {
          assertOrdinaryBlob(commitEntry, commit, path);
          fail(`release evidence blob must never be modified after it is committed: ${path} at ${commit}`);
        } else if (commitEntry && inheritedEntry) {
          // A merge may carry an artifact from one parent while the other
          // parent has no copy. This is not a second addition, but every
          // parent that already has the path must still match byte-for-byte.
          assertOrdinaryBlob(commitEntry, commit, path);
          for (const parentEntry of parentEntryList) {
            if (parentEntry && !sameTreeEntry(parentEntry, commitEntry)) {
              fail(`release evidence blob must never be modified after it is committed: ${path} at ${commit}`);
            }
          }
          everEvidencePaths.add(path);
        } else if (commitEntry) {
          assertOrdinaryBlob(commitEntry, commit, path);
          if (everEvidencePaths.has(path)) {
            fail(`release evidence path was re-added after deletion: ${path} at ${commit}`);
          }
          everEvidencePaths.add(path);
        }
      }
    }
  }

  const disallowedPaths = [...changedPaths]
    .filter((path) => !isAllowedReleaseEvidencePath(path, release))
    .sort();
  if (disallowedPaths.length > 0) {
    fail(
      `candidate..HEAD contains non-evidence path changes:\n- ${disallowedPaths.join('\n- ')}\n`
      + `Allowed: ${RELEASE_LEDGER_PATH}, ${RELEASE_MANIFEST_PATH} (status-only), and `
      + releaseEvidenceDirectory(release),
    );
  }

  const candidateManifest = readJsonAtCommit(repoRoot, candidateCommit, RELEASE_MANIFEST_PATH);
  const controllerManifest = readJsonAtCommit(repoRoot, headCommit, RELEASE_MANIFEST_PATH);
  const manifestErrors = validateManifestFreezeTransition(candidateManifest, controllerManifest);
  if (manifestErrors.length > 0) fail(manifestErrors.join('\n'));

  const candidateLedger = readJsonAtCommit(repoRoot, candidateCommit, RELEASE_LEDGER_PATH);
  const controllerLedger = readJsonAtCommit(repoRoot, headCommit, RELEASE_LEDGER_PATH);
  const ledgerErrors = validateLedgerFreezeTransition(
    candidateLedger,
    controllerLedger,
    candidateCommit,
  );
  if (ledgerErrors.length > 0) fail(ledgerErrors.join('\n'));

  return Object.freeze({
    candidateCommit,
    changedPaths: Object.freeze([...changedPaths].sort()),
    evidenceDirectory: releaseEvidenceDirectory(release),
    headCommit,
  });
}
