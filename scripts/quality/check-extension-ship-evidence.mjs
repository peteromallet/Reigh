#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LABEL = '[extension-ship-evidence]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function validateEvidenceArtifact(receipt, repoRoot, prefix, errors) {
  const artifact = isPlainObject(receipt.artifact) ? receipt.artifact : {};
  if (typeof artifact.path !== 'string' || artifact.path.trim() === '') {
    errors.push(`${prefix}.artifact.path must be a non-empty repository-relative path`);
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
    errors.push(`${prefix}.artifact.sha256 must be a full lowercase SHA-256`);
    return;
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
}

function validateReceipt({
  receipt,
  prefix,
  repoRoot,
  candidate,
  releaseMode,
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
    if (typeof receipt.reviewerId !== 'string' || receipt.reviewerId.trim() === '') {
      errors.push(`${prefix}.reviewerId must be non-empty`);
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

  validateEvidenceArtifact(receipt, repoRoot, prefix, errors);
}

export function validateLedger({
  ledger,
  checklistMarkdown,
  releaseManifest,
  repoRoot = REPO_ROOT,
  mode = 'audit',
  headCommit,
}) {
  const releaseMode = mode === 'release';
  const errors = [];
  const warnings = [];
  const expected = parseChecklistWorkstreams(checklistMarkdown);
  const candidate = isPlainObject(ledger?.candidate) ? ledger.candidate : {};
  const workstreams = Array.isArray(ledger?.workstreams) ? ledger.workstreams : [];

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
        repoRoot,
        candidate,
        releaseMode,
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
      const reviewers = new Set(
        receipts
          .filter((receipt) => receipt?.kind === 'review')
          .map((receipt) => receipt.reviewerId)
          .filter(Boolean),
      );
      if (reviewers.size < 2) {
        errors.push(`${prefix} requires two independent review receipts`);
      }
    }
  });

  if (releaseMode) {
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
    if (headCommit && candidate.reighCommit !== headCommit) {
      errors.push(`candidate.reighCommit does not match HEAD ${headCommit}`);
    }
    if (
      typeof releaseManifest?.astrid?.commit === 'string'
      && !candidate.astridCommit?.startsWith(releaseManifest.astrid.commit)
    ) {
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

  const result = validateLedger({
    ledger: readJson(LEDGER_PATH),
    checklistMarkdown: readFileSync(CHECKLIST_PATH, 'utf8'),
    releaseManifest: readJson(RELEASE_MANIFEST_PATH),
    repoRoot: REPO_ROOT,
    mode,
    headCommit: currentHead(REPO_ROOT),
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
