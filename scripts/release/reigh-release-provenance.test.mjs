import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  RELEASE_LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
  inspectCandidateController,
  isAllowedReleaseEvidencePath,
  releaseEvidenceDirectory,
  resolveAnnotatedCandidateTag,
  validateManifestFreezeTransition,
} from './reigh-release-provenance.mjs';

const RELEASE = 'extension-ship-quality-rc1';
const TAG = RELEASE;

function git(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      LANG: 'C',
      LC_ALL: 'C',
      TZ: 'UTC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeJson(repoRoot, path, value) {
  const absolutePath = resolve(repoRoot, path);
  mkdirSync(resolve(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function commitAll(repoRoot, message) {
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-m', message]);
  return git(repoRoot, ['rev-parse', 'HEAD']);
}

function createCandidateRepo() {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'reigh-release-provenance-'));
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.name', 'Release Test']);
  git(repoRoot, ['config', 'user.email', 'release-test@example.invalid']);
  writeJson(repoRoot, RELEASE_MANIFEST_PATH, {
    schemaVersion: 1,
    release: RELEASE,
    status: 'integration',
    reigh: { releaseTag: TAG, branch: 'release', baseCommit: 'a'.repeat(40) },
    astrid: { commit: 'b'.repeat(40) },
    verification: { profile: 'test' },
  });
  writeJson(repoRoot, RELEASE_LEDGER_PATH, {
    schemaVersion: 1,
    release: RELEASE,
    status: 'integration',
    candidate: { reighCommit: null, astridCommit: null },
    workstreams: [{ id: 'one', title: 'One', status: 'in_progress', receipts: [] }],
  });
  mkdirSync(resolve(repoRoot, 'src'), { recursive: true });
  writeFileSync(resolve(repoRoot, 'src/app.js'), 'export const candidate = true;\n');
  const candidateCommit = commitAll(repoRoot, 'candidate');
  git(repoRoot, ['tag', '-a', TAG, '-m', 'candidate tag', candidateCommit]);
  return { candidateCommit, repoRoot };
}

function freezeEvidence(repoRoot, candidateCommit, { extraManifest = {}, evidencePath } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, RELEASE_MANIFEST_PATH), 'utf8'));
  writeJson(repoRoot, RELEASE_MANIFEST_PATH, {
    ...manifest,
    ...extraManifest,
    status: 'frozen',
  });
  const ledger = JSON.parse(readFileSync(resolve(repoRoot, RELEASE_LEDGER_PATH), 'utf8'));
  writeJson(repoRoot, RELEASE_LEDGER_PATH, {
    ...ledger,
    status: 'frozen',
    candidate: { reighCommit: candidateCommit, astridCommit: 'b'.repeat(40) },
    workstreams: ledger.workstreams.map((workstream) => ({
      ...workstream,
      status: 'pass',
      receipts: [{ id: 'receipt-one', commit: candidateCommit }],
    })),
  });
  const artifactPath = evidencePath ?? `${releaseEvidenceDirectory(RELEASE)}receipt.txt`;
  mkdirSync(resolve(repoRoot, artifactPath, '..'), { recursive: true });
  writeFileSync(resolve(repoRoot, artifactPath), 'immutable release evidence\n');
  return commitAll(repoRoot, 'freeze evidence');
}

function withCandidateRepo(callback) {
  const fixture = createCandidateRepo();
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
}

describe('Reigh release candidate provenance', () => {
  it('accepts an exact annotated candidate and strict evidence-only descendant', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const headCommit = freezeEvidence(repoRoot, candidateCommit);
      const tag = resolveAnnotatedCandidateTag({ repoRoot, releaseTag: TAG });
      assert.equal(tag.candidateCommit, candidateCommit);

      const result = inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      });
      assert.deepEqual(result.changedPaths, [
        RELEASE_LEDGER_PATH,
        RELEASE_MANIFEST_PATH,
        `${releaseEvidenceDirectory(RELEASE)}receipt.txt`,
      ].sort());
    });
  });

  it('rejects a lightweight candidate tag and a non-ancestor controller', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      git(repoRoot, ['tag', 'lightweight-candidate', candidateCommit]);
      assert.throws(() => resolveAnnotatedCandidateTag({
        repoRoot,
        releaseTag: 'lightweight-candidate',
      }), /must exist and be annotated/);

      const firstHead = freezeEvidence(repoRoot, candidateCommit);
      git(repoRoot, ['checkout', '-q', candidateCommit]);
      const siblingHead = freezeEvidence(repoRoot, candidateCommit, {
        evidencePath: `${releaseEvidenceDirectory(RELEASE)}sibling.txt`,
      });
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit: firstHead,
        headCommit: siblingHead,
        release: RELEASE,
      }), /is not descended from candidate/);
    });
  });

  it('rejects candidate equality, prefix lookalikes, and executable evidence blobs', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit: candidateCommit,
        release: RELEASE,
      }), /strict evidence-only descendant/);
      assert.equal(
        isAllowedReleaseEvidencePath(
          `docs/extensions/evidence/releases/${RELEASE}-lookalike/receipt.txt`,
          RELEASE,
        ),
        false,
      );

      const artifactPath = `${releaseEvidenceDirectory(RELEASE)}executable.txt`;
      freezeEvidence(repoRoot, candidateCommit, { evidencePath: artifactPath });
      chmodSync(resolve(repoRoot, artifactPath), 0o755);
      const headCommit = commitAll(repoRoot, 'make evidence executable');
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }), /non-executable regular blob/);
    });
  });

  it('rejects transient source drift even when a later commit restores the candidate bytes', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const sourcePath = resolve(repoRoot, 'src/app.js');
      const candidateSource = readFileSync(sourcePath, 'utf8');
      writeFileSync(sourcePath, 'export const candidate = false;\n');
      commitAll(repoRoot, 'forbidden source drift');
      writeFileSync(sourcePath, candidateSource);
      const headCommit = freezeEvidence(repoRoot, candidateCommit);

      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }), /src\/app\.js/);
    });
  });

  it('rejects an outside-to-allowlist rename and non-status manifest drift', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      writeFileSync(resolve(repoRoot, 'source-proof.txt'), 'not release evidence\n');
      commitAll(repoRoot, 'forbidden post-candidate file');
      const destination = `${releaseEvidenceDirectory(RELEASE)}renamed.txt`;
      mkdirSync(resolve(repoRoot, destination, '..'), { recursive: true });
      renameSync(resolve(repoRoot, 'source-proof.txt'), resolve(repoRoot, destination));
      const headCommit = freezeEvidence(repoRoot, candidateCommit);
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }), /source-proof\.txt/);
    });

    const candidate = { release: RELEASE, status: 'integration', pins: { node: '20.19.4' } };
    const controller = { release: RELEASE, status: 'frozen', pins: { node: '20.20.0' } };
    assert.match(
      validateManifestFreezeTransition(candidate, controller).join('\n'),
      /outside the exact status freeze/,
    );
  });
});
