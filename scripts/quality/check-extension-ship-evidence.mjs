#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertCleanReleaseCheckout,
  inspectCandidateController,
  releaseEvidenceDirectory,
  resolveAnnotatedCandidateTag,
} from '../release/reigh-release-provenance.mjs';

const LABEL = '[extension-ship-evidence]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
const GIT_ENV = Object.freeze({
  PATH: [
    dirname(realpathSync(process.execPath)),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].filter((entry, index, entries) => entries.indexOf(entry) === index).join(':'),
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
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const CHECKLIST_PATH = resolve(
  REPO_ROOT,
  'docs/extensions/extension-ship-quality-checklist.md',
);
export const LEDGER_PATH = resolve(
  REPO_ROOT,
  'config/releases/extension-ship-evidence.json',
);
export const RELEASE_MANIFEST_PATH = resolve(
  REPO_ROOT,
  'config/releases/extension-ship-quality.json',
);
export const ATTESTATION_TRUST_PATH = resolve(
  REPO_ROOT,
  'config/releases/extension-ship-attestation-trust.json',
);
export const ATTESTATION_NAMESPACE = 'reigh-extension-ship-evidence-v1';

const ALLOWED_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'pass']);
const ALLOWED_KINDS = new Set([
  'artifact',
  'browser',
  'command',
  'database',
  'deployment',
  'human',
  'observability',
  'performance',
  'recovery',
  'render',
  'review',
  'security',
  'visual',
]);

// These are intentionally code-owned. A prose or generic unit-test receipt may
// supplement, but cannot substitute for, the evidence class named here.
const REQUIRED_RECEIPT_KIND = new Map([
  [1, 'command'],
  [2, 'command'],
  [3, 'browser'],
  [4, 'database'],
  [5, 'render'],
  [6, 'performance'],
  [7, 'command'],
  [8, 'security'],
  [9, 'command'],
  [10, 'browser'],
  [11, 'browser'],
  [12, 'human'],
  [13, 'browser'],
  [14, 'performance'],
  [15, 'visual'],
  [16, 'recovery'],
  [17, 'security'],
  [18, 'database'],
  [19, 'deployment'],
  [20, 'observability'],
  [21, 'recovery'],
  [22, 'human'],
  [23, 'review'],
]);

const REQUIRED_HUMAN_PERSONAS = new Set([
  'video-editor',
  'accessibility-user',
  'transcript-specialist',
  'first-time-extension-author',
]);

const SSH_PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$/;
const SSH_ED25519_PUBLIC_KEY = /^ssh-ed25519 [A-Za-z0-9+/]+={0,3}$/;
const SSH_SIGNATURE = /^-----BEGIN SSH SIGNATURE-----\n[A-Za-z0-9+/=\n]+\n-----END SSH SIGNATURE-----\n?$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ed25519KeyFingerprint(publicKey) {
  if (!SSH_ED25519_PUBLIC_KEY.test(publicKey ?? '')) return null;
  const encoded = publicKey.slice('ssh-ed25519 '.length);
  const blob = Buffer.from(encoded, 'base64');
  const normalized = blob.toString('base64').replace(/=+$/, '');
  if (normalized !== encoded.replace(/=+$/, '') || blob.length !== 51) return null;
  if (blob.readUInt32BE(0) !== 11 || blob.subarray(4, 15).toString() !== 'ssh-ed25519') {
    return null;
  }
  if (blob.readUInt32BE(15) !== 32) return null;
  return createHash('sha256').update(blob).digest('base64');
}

function canonicalizeJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`
    )).join(',')}}`;
  }
  throw new TypeError('attestation payload contains a non-JSON value');
}

export function canonicalReceiptPayload({ release, candidate, workstream, receipt }) {
  if (!isPlainObject(receipt)) throw new TypeError('receipt must be an object');
  const { attestation: _attestation, ...unsignedReceipt } = receipt;
  return `${canonicalizeJson({
    schema: 'reigh-extension-ship-receipt-attestation/v1',
    release,
    candidate,
    workstream: {
      id: workstream?.id,
      title: workstream?.title,
    },
    receipt: unsignedReceipt,
  })}\n`;
}

export function validateAttestationTrust({ trust, release, releaseMode = false }) {
  const errors = [];
  const warnings = [];
  const identities = Array.isArray(trust?.identities) ? trust.identities : [];
  const identityByPrincipal = new Map();
  const keyOwners = new Map();
  const personaOwners = new Map();
  const reviewPrincipals = [];

  if (trust?.schemaVersion !== 1) errors.push('attestation trust schemaVersion must be 1');
  if (trust?.release !== release) errors.push('attestation trust release must match the evidence ledger');
  if (trust?.namespace !== ATTESTATION_NAMESPACE) {
    errors.push(`attestation trust namespace must be ${ATTESTATION_NAMESPACE}`);
  }
  if (!Array.isArray(trust?.identities)) errors.push('attestation trust identities must be an array');

  identities.forEach((identity, index) => {
    const prefix = `attestation trust identities[${index}]`;
    if (!isPlainObject(identity)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!SSH_PRINCIPAL.test(identity.principal ?? '')) {
      errors.push(`${prefix}.principal must be a safe SSH principal`);
    } else if (identityByPrincipal.has(identity.principal)) {
      errors.push(`${prefix}.principal duplicates ${identity.principal}`);
    } else {
      identityByPrincipal.set(identity.principal, identity);
    }
    const fingerprint = ed25519KeyFingerprint(identity.publicKey);
    if (!fingerprint) {
      errors.push(`${prefix}.publicKey must be a valid comment-free ssh-ed25519 public key`);
    } else if (keyOwners.has(fingerprint)) {
      errors.push(`${prefix}.publicKey is already assigned to ${keyOwners.get(fingerprint)}`);
    } else {
      keyOwners.set(fingerprint, identity.principal);
    }
    if (identity.kind === 'human') {
      if (!REQUIRED_HUMAN_PERSONAS.has(identity.persona)) {
        errors.push(`${prefix}.persona must name one required human acceptance persona`);
      } else if (personaOwners.has(identity.persona)) {
        errors.push(`${prefix}.persona duplicates the assignment for ${identity.persona}`);
      } else {
        personaOwners.set(identity.persona, identity.principal);
      }
    } else if (identity.kind === 'review') {
      if (Object.hasOwn(identity, 'persona')) errors.push(`${prefix}.persona is not valid for a reviewer`);
      reviewPrincipals.push(identity.principal);
    } else {
      errors.push(`${prefix}.kind must be human or review`);
    }
  });

  const missingPersonas = [...REQUIRED_HUMAN_PERSONAS]
    .filter((persona) => !personaOwners.has(persona));
  if (releaseMode) {
    for (const persona of missingPersonas) {
      errors.push(`attestation trust is missing the ${persona} human principal`);
    }
    if (reviewPrincipals.length < 2) {
      errors.push('attestation trust requires at least two independent reviewer principals');
    }
  } else {
    for (const persona of missingPersonas) {
      warnings.push(`attestation trust has no ${persona} human principal yet`);
    }
    if (reviewPrincipals.length < 2) {
      warnings.push('attestation trust has fewer than two independent reviewer principals');
    }
  }

  return { errors, warnings, identityByPrincipal };
}

export function verifyReceiptAttestation({
  attestation,
  identity,
  payload,
  execFile = execFileSync,
}) {
  if (!isPlainObject(attestation)) return 'attestation must be an object';
  if (attestation.namespace !== ATTESTATION_NAMESPACE) {
    return `attestation.namespace must be ${ATTESTATION_NAMESPACE}`;
  }
  if (!SSH_PRINCIPAL.test(attestation.principal ?? '')) {
    return 'attestation.principal must be a safe SSH principal';
  }
  if (!identity) return `attestation principal is not trusted: ${attestation.principal}`;
  if (typeof attestation.signature !== 'string' || attestation.signature.length > 16 * 1024
      || !SSH_SIGNATURE.test(attestation.signature)) {
    return 'attestation.signature must be an armored SSH signature';
  }

  const directory = mkdtempSync(resolve(tmpdir(), 'reigh-extension-attestation-'));
  const allowedSignersPath = resolve(directory, 'allowed_signers');
  const signaturePath = resolve(directory, 'receipt.sig');
  try {
    writeFileSync(
      allowedSignersPath,
      `${identity.principal} namespaces="${ATTESTATION_NAMESPACE}" ${identity.publicKey}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    writeFileSync(signaturePath, attestation.signature, { encoding: 'utf8', mode: 0o600 });
    execFile(
      'ssh-keygen',
      [
        '-Y', 'verify',
        '-f', allowedSignersPath,
        '-I', identity.principal,
        '-n', ATTESTATION_NAMESPACE,
        '-s', signaturePath,
      ],
      {
        encoding: 'utf8',
        env: GIT_ENV,
        input: payload,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return null;
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error.message;
    return `SSH signature verification failed: ${detail}`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseChecklistWorkstreams(markdown) {
  const workstreams = [];
  const heading = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
  let match;
  while ((match = heading.exec(markdown)) !== null) {
    const number = Number.parseInt(match[1], 10);
    const title = match[2].trim();
    workstreams.push({
      number,
      title,
      id: `${number}-${slugify(title)}`,
    });
  }
  return workstreams;
}

function isUtcTimestamp(value) {
  if (typeof value !== 'string' || !value.endsWith('Z')) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateEvidenceArtifact(
  receipt,
  repoRoot,
  prefix,
  errors,
  releaseMode,
  verifyCommittedArtifact,
  release,
  provenanceChangedPaths,
) {
  const artifact = isPlainObject(receipt.artifact) ? receipt.artifact : {};
  if (typeof artifact.path !== 'string' || artifact.path.trim() === '') {
    errors.push(`${prefix}.artifact.path must be a non-empty repository-relative path`);
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
    errors.push(`${prefix}.artifact.sha256 must be a full lowercase SHA-256`);
    return;
  }

  if (releaseMode) {
    const evidenceDirectory = releaseEvidenceDirectory(release);
    if (!artifact.path.startsWith(evidenceDirectory) || artifact.path.length <= evidenceDirectory.length) {
      errors.push(`${prefix}.artifact.path must be under ${evidenceDirectory} in release mode`);
      return;
    }
    if (!provenanceChangedPaths.has(artifact.path)) {
      errors.push(
        `${prefix}.artifact.path was not committed in the candidate-to-controller evidence history`,
      );
      return;
    }
  }

  const candidatePath = resolve(repoRoot, artifact.path);
  const lexicalRelative = relative(repoRoot, candidatePath);
  if (
    lexicalRelative === ''
    || lexicalRelative.startsWith('..')
    || lexicalRelative.includes('/node_modules/')
    || lexicalRelative === 'node_modules'
  ) {
    errors.push(`${prefix}.artifact.path escapes the repository or targets node_modules`);
    return;
  }
  if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
    errors.push(`${prefix}.artifact.path does not resolve to a regular file: ${artifact.path}`);
    return;
  }

  const realRoot = realpathSync(repoRoot);
  const realArtifact = realpathSync(candidatePath);
  const canonicalRelative = relative(realRoot, realArtifact);
  if (canonicalRelative.startsWith('..') || canonicalRelative === '') {
    errors.push(`${prefix}.artifact.path resolves outside the repository`);
    return;
  }

  const actualHash = sha256File(realArtifact);
  if (actualHash !== artifact.sha256) {
    errors.push(
      `${prefix}.artifact.sha256 mismatch for ${artifact.path}: expected ${artifact.sha256}, got ${actualHash}`,
    );
  }

  if (verifyCommittedArtifact) {
    try {
      const treeEntry = execFileSync(
        'git',
        ['ls-tree', '-z', 'HEAD', '--', artifact.path],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: GIT_ENV,
          maxBuffer: 256 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const headerEnd = treeEntry.indexOf('\t');
      const committedPath = treeEntry.slice(headerEnd + 1).replace(/\0$/, '');
      if (
        headerEnd === -1
        || !treeEntry.startsWith('100644 blob ')
        || committedPath !== artifact.path
      ) {
        errors.push(
          `${prefix}.artifact.path must be a committed non-executable regular blob in release mode`,
        );
        return;
      }
      const committedBytes = execFileSync(
        'git',
        ['show', `HEAD:${artifact.path}`],
        {
          cwd: repoRoot,
          encoding: null,
          env: GIT_ENV,
          maxBuffer: 256 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const committedHash = createHash('sha256').update(committedBytes).digest('hex');
      if (committedHash !== artifact.sha256) {
        errors.push(
          `${prefix}.artifact.sha256 does not match committed HEAD blob for ${artifact.path}`,
        );
      }
    } catch (error) {
      errors.push(`${prefix}.artifact.path is not readable from committed HEAD: ${error.message}`);
    }
  }
}

function validateReceipt({
  receipt,
  prefix,
  ledger,
  workstream,
  repoRoot,
  candidate,
  identityByPrincipal,
  releaseMode,
  verifyCommittedArtifacts,
  release,
  provenanceChangedPaths,
  errors,
}) {
  if (!isPlainObject(receipt)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  if (typeof receipt.id !== 'string' || receipt.id.trim() === '') {
    errors.push(`${prefix}.id must be non-empty`);
  }
  if (!ALLOWED_KINDS.has(receipt.kind)) {
    errors.push(`${prefix}.kind must be one of ${[...ALLOWED_KINDS].join(', ')}`);
  }
  if (receipt.repository !== 'reigh' && receipt.repository !== 'astrid') {
    errors.push(`${prefix}.repository must be reigh or astrid`);
  }
  if (!/^[0-9a-f]{40}$/.test(receipt.commit ?? '')) {
    errors.push(`${prefix}.commit must be a full 40-character lowercase commit`);
  }
  if (!isUtcTimestamp(receipt.capturedAt)) {
    errors.push(`${prefix}.capturedAt must be an exact UTC ISO timestamp`);
  }
  if (typeof receipt.action !== 'string' || receipt.action.trim() === '') {
    errors.push(`${prefix}.action must describe the command or human action`);
  }
  const environment = isPlainObject(receipt.environment) ? receipt.environment : {};
  if (typeof environment.id !== 'string' || environment.id.trim() === '') {
    errors.push(`${prefix}.environment.id must be non-empty`);
  }
  if (!isPlainObject(environment.toolVersions) || Object.keys(environment.toolVersions).length === 0) {
    errors.push(`${prefix}.environment.toolVersions must record at least one exact tool version`);
  }

  if (receipt.kind === 'human' || receipt.kind === 'review') {
    if (receipt.decision !== 'approve') {
      errors.push(`${prefix}.decision must be approve`);
    }
    const identity = identityByPrincipal.get(receipt.attestation?.principal);
    let attestationError;
    try {
      attestationError = verifyReceiptAttestation({
        attestation: receipt.attestation,
        identity,
        payload: canonicalReceiptPayload({
          release: ledger.release,
          candidate,
          workstream,
          receipt,
        }),
      });
    } catch (error) {
      attestationError = `attestation payload is invalid: ${error.message}`;
    }
    if (attestationError) errors.push(`${prefix}.${attestationError}`);
    if (identity && identity.kind !== receipt.kind) {
      errors.push(`${prefix}.attestation principal is not authorized for ${receipt.kind} evidence`);
    }
    if (receipt.kind === 'human') {
      if (!REQUIRED_HUMAN_PERSONAS.has(receipt.persona)) {
        errors.push(`${prefix}.persona must name one required human acceptance persona`);
      } else if (identity && identity.persona !== receipt.persona) {
        errors.push(`${prefix}.attestation principal is not authorized for persona ${receipt.persona}`);
      }
    }
    if (Object.hasOwn(receipt, 'reviewerId')
        && receipt.reviewerId !== receipt.attestation?.principal) {
      errors.push(`${prefix}.reviewerId, when present, must equal the trusted attestation principal`);
    }
  } else if (receipt.exitCode !== 0) {
    errors.push(`${prefix}.exitCode must be 0`);
  }

  if (releaseMode && receipt.repository === 'reigh' && receipt.commit !== candidate.reighCommit) {
    errors.push(`${prefix}.commit does not match the frozen Reigh candidate`);
  }
  if (releaseMode && receipt.repository === 'astrid' && receipt.commit !== candidate.astridCommit) {
    errors.push(`${prefix}.commit does not match the frozen Astrid candidate`);
  }

  validateEvidenceArtifact(
    receipt,
    repoRoot,
    prefix,
    errors,
    releaseMode,
    releaseMode && verifyCommittedArtifacts,
    release,
    provenanceChangedPaths,
  );
}

export function validateLedger({
  ledger,
  checklistMarkdown,
  releaseManifest,
  attestationTrust = {},
  repoRoot = REPO_ROOT,
  mode = 'audit',
  candidateCommit,
  headCommit,
  provenanceErrors = [],
  provenanceChangedPaths = [],
  verifyCommittedArtifacts = false,
}) {
  const releaseMode = mode === 'release';
  const errors = [];
  const warnings = [];
  const expected = parseChecklistWorkstreams(checklistMarkdown);
  const candidate = isPlainObject(ledger?.candidate) ? ledger.candidate : {};
  const changedEvidencePaths = new Set(provenanceChangedPaths);
  const workstreams = Array.isArray(ledger?.workstreams) ? ledger.workstreams : [];
  const trustResult = validateAttestationTrust({
    trust: attestationTrust,
    release: ledger?.release,
    releaseMode,
  });
  errors.push(...trustResult.errors);
  warnings.push(...trustResult.warnings);

  if (ledger?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (ledger?.release !== releaseManifest?.release) {
    errors.push('release must exactly match config/releases/extension-ship-quality.json');
  }
  if (ledger?.status !== 'integration' && ledger?.status !== 'frozen') {
    errors.push('status must be integration or frozen');
  }
  if (expected.length !== 23 || expected.some((item, index) => item.number !== index + 1)) {
    errors.push(`canonical checklist must contain consecutive workstreams 1-23; found ${expected.length}`);
  }
  if (workstreams.length !== expected.length) {
    errors.push(`workstreams must contain exactly ${expected.length} entries; found ${workstreams.length}`);
  }

  const seenReceiptIds = new Set();
  const counts = { pending: 0, in_progress: 0, blocked: 0, pass: 0 };

  expected.forEach((expectedWorkstream, index) => {
    const workstream = isPlainObject(workstreams[index]) ? workstreams[index] : {};
    const prefix = `workstreams[${index}]`;
    if (workstream.id !== expectedWorkstream.id) {
      errors.push(`${prefix}.id must be ${expectedWorkstream.id}`);
    }
    if (workstream.title !== expectedWorkstream.title) {
      errors.push(`${prefix}.title must exactly match checklist heading ${expectedWorkstream.title}`);
    }
    if (!ALLOWED_STATUSES.has(workstream.status)) {
      errors.push(`${prefix}.status must be pending, in_progress, blocked, or pass`);
    } else {
      counts[workstream.status] += 1;
    }
    if (workstream.status === 'blocked' && (
      typeof workstream.blocker !== 'string' || workstream.blocker.trim() === ''
    )) {
      errors.push(`${prefix}.blocker must explain a blocked disposition`);
    }

    const receipts = Array.isArray(workstream.receipts) ? workstream.receipts : [];
    receipts.forEach((receipt, receiptIndex) => {
      const receiptPrefix = `${prefix}.receipts[${receiptIndex}]`;
      validateReceipt({
        receipt,
        prefix: receiptPrefix,
        ledger,
        workstream,
        repoRoot,
        candidate,
        identityByPrincipal: trustResult.identityByPrincipal,
        releaseMode,
        verifyCommittedArtifacts,
        release: ledger?.release,
        provenanceChangedPaths: changedEvidencePaths,
        errors,
      });
      if (typeof receipt?.id === 'string') {
        if (seenReceiptIds.has(receipt.id)) {
          errors.push(`${receiptPrefix}.id duplicates ${receipt.id}`);
        }
        seenReceiptIds.add(receipt.id);
      }
    });

    if (workstream.status === 'pass') {
      if (receipts.length === 0) {
        errors.push(`${prefix} is pass but has no immutable receipts`);
      }
      const requiredKind = REQUIRED_RECEIPT_KIND.get(expectedWorkstream.number);
      if (requiredKind && !receipts.some((receipt) => receipt?.kind === requiredKind)) {
        errors.push(`${prefix} requires at least one ${requiredKind} receipt`);
      }
    } else {
      warnings.push(`${expectedWorkstream.id}: ${workstream.status ?? 'invalid'}`);
    }

    if (expectedWorkstream.number === 22 && workstream.status === 'pass') {
      const personas = new Set(
        receipts
          .filter((receipt) => receipt?.kind === 'human')
          .map((receipt) => receipt.persona),
      );
      for (const persona of REQUIRED_HUMAN_PERSONAS) {
        if (!personas.has(persona)) {
          errors.push(`${prefix} is missing human acceptance persona ${persona}`);
        }
      }
    }

    if (expectedWorkstream.number === 23 && workstream.status === 'pass') {
      const reviewerPrincipals = new Set(
        receipts
          .filter((receipt) => receipt?.kind === 'review')
          .map((receipt) => receipt.attestation?.principal)
          .filter(Boolean),
      );
      const reviewerKeys = new Set(
        [...reviewerPrincipals]
          .map((principal) => trustResult.identityByPrincipal.get(principal))
          .filter((identity) => identity?.kind === 'review')
          .map((identity) => ed25519KeyFingerprint(identity.publicKey))
          .filter(Boolean),
      );
      if (reviewerPrincipals.size < 2 || reviewerKeys.size < 2) {
        errors.push(`${prefix} requires two independently keyed trusted review receipts`);
      }
    }
  });

  if (releaseMode) {
    errors.push(...provenanceErrors);
    if (ledger?.status !== 'frozen') errors.push('release mode requires ledger status frozen');
    if (releaseManifest?.status !== 'frozen') {
      errors.push('release mode requires release manifest status frozen');
    }
    if (!/^[0-9a-f]{40}$/.test(candidate.reighCommit ?? '')) {
      errors.push('candidate.reighCommit must be a full 40-character commit');
    }
    if (!/^[0-9a-f]{40}$/.test(candidate.astridCommit ?? '')) {
      errors.push('candidate.astridCommit must be a full 40-character commit');
    }
    if (!/^[0-9a-f]{40}$/.test(candidateCommit ?? '')) {
      errors.push('release mode requires a resolved annotated Reigh candidate commit');
    }
    if (!/^[0-9a-f]{40}$/.test(headCommit ?? '')) {
      errors.push('release mode requires the full controller HEAD commit');
    }
    if (candidateCommit && candidate.reighCommit !== candidateCommit) {
      errors.push(`candidate.reighCommit does not match annotated candidate ${candidateCommit}`);
    }
    if (candidateCommit && headCommit && candidateCommit === headCommit) {
      errors.push('controller HEAD must be a strict evidence-only descendant of the candidate');
    }
    if (!/^[0-9a-f]{40}$/.test(releaseManifest?.astrid?.commit ?? '')) {
      errors.push('release manifest astrid.commit must be a full 40-character commit');
    } else if (candidate.astridCommit !== releaseManifest.astrid.commit) {
      errors.push('candidate.astridCommit does not match the release manifest pin');
    }
    if (counts.pass !== expected.length) {
      errors.push(`release mode requires 23/23 pass; found ${counts.pass}/23`);
    }
  }

  return { counts, errors, warnings, expected };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function currentHead(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: GIT_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function runCli(argv = process.argv.slice(2)) {
  const mode = argv.includes('--release') ? 'release' : 'audit';
  const unknown = argv.filter((arg) => arg !== '--audit' && arg !== '--release');
  if (unknown.length > 0) {
    console.error(`${LABEL} unknown option(s): ${unknown.join(', ')}`);
    return 2;
  }

  if (mode === 'release') {
    try {
      assertCleanReleaseCheckout(REPO_ROOT, 'Reigh evidence controller');
    } catch (error) {
      console.error(`${LABEL} failed:\n- ${error.message}`);
      return 1;
    }
  }

  const ledger = readJson(LEDGER_PATH);
  const releaseManifest = readJson(RELEASE_MANIFEST_PATH);
  const attestationTrust = readJson(ATTESTATION_TRUST_PATH);
  const headCommit = currentHead(REPO_ROOT);
  let candidateCommit;
  let provenanceChangedPaths = [];
  const provenanceErrors = [];
  if (mode === 'release') {
    try {
      const tag = resolveAnnotatedCandidateTag({
        repoRoot: REPO_ROOT,
        releaseTag: releaseManifest.reigh.releaseTag,
      });
      candidateCommit = tag.candidateCommit;
      const provenance = inspectCandidateController({
        repoRoot: REPO_ROOT,
        candidateCommit,
        headCommit,
        release: releaseManifest.release,
      });
      provenanceChangedPaths = provenance.changedPaths;
    } catch (error) {
      provenanceErrors.push(`Reigh release provenance is invalid: ${error.message}`);
    }
  }

  const result = validateLedger({
    ledger,
    checklistMarkdown: readFileSync(CHECKLIST_PATH, 'utf8'),
    releaseManifest,
    attestationTrust,
    repoRoot: REPO_ROOT,
    mode,
    candidateCommit,
    headCommit,
    provenanceErrors,
    provenanceChangedPaths,
    verifyCommittedArtifacts: mode === 'release',
  });

  console.log(
    `${LABEL} ${result.counts.pass}/23 pass, ${result.counts.in_progress} in progress, `
    + `${result.counts.pending} pending, ${result.counts.blocked} blocked.`,
  );
  if (result.warnings.length > 0) {
    console.log(`${LABEL} open workstreams:\n- ${result.warnings.join('\n- ')}`);
  }
  if (result.errors.length > 0) {
    console.error(`${LABEL} failed:\n- ${result.errors.join('\n- ')}`);
    return 1;
  }
  if (mode === 'audit') {
    console.log(`${LABEL} audit structure and any claimed PASS receipts are valid.`);
  } else {
    console.log(`${LABEL} release evidence is complete and cryptographically bound to the frozen pair.`);
  }
  return 0;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = runCli();
