import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  RELEASE_LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
  assertCleanReleaseCheckout,
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

function createCandidateRepo({ candidateEvidencePath } = {}) {
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
  if (candidateEvidencePath) {
    mkdirSync(resolve(repoRoot, candidateEvidencePath, '..'), { recursive: true });
    writeFileSync(resolve(repoRoot, candidateEvidencePath), 'candidate-bound evidence\n');
  }
  const candidateCommit = commitAll(repoRoot, 'candidate');
  git(repoRoot, ['tag', '-a', TAG, '-m', 'candidate tag', candidateCommit]);
  return { candidateCommit, repoRoot };
}

function freezeEvidence(repoRoot, candidateCommit, {
  extraManifest = {},
  evidencePath,
  evidenceKind = 'file',
} = {}) {
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
  if (evidenceKind === 'symlink') {
    writeFileSync(resolve(repoRoot, `${artifactPath}.target`), 'symlink target\n');
    symlinkSync(`${artifactPath.split('/').at(-1)}.target`, resolve(repoRoot, artifactPath));
  } else {
    writeFileSync(resolve(repoRoot, artifactPath), 'immutable release evidence\n');
  }
  return commitAll(repoRoot, 'freeze evidence');
}

function withCandidateRepo(callback) {
  return withRepo({}, callback);
}

function withRepo(options, callback) {
  const fixture = createCandidateRepo(options);
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.repoRoot, { recursive: true, force: true });
  }
}

describe('Reigh release candidate provenance', () => {
  it('rejects hidden index flags that can conceal modified worktree bytes', () => {
    withCandidateRepo(({ repoRoot }) => {
      assert.doesNotThrow(() => assertCleanReleaseCheckout(repoRoot, 'fixture'));
      git(repoRoot, ['update-index', '--assume-unchanged', 'src/app.js']);
      writeFileSync(resolve(repoRoot, 'src/app.js'), 'export const concealed = true;\n');
      assert.throws(
        () => assertCleanReleaseCheckout(repoRoot, 'fixture'),
        /index contains assume-unchanged.*src\/app\.js/s,
      );
    });

    withCandidateRepo(({ repoRoot }) => {
      git(repoRoot, ['update-index', '--skip-worktree', 'src/app.js']);
      assert.throws(
        () => assertCleanReleaseCheckout(repoRoot, 'fixture'),
        /index contains assume-unchanged.*src\/app\.js/s,
      );
    });
  });

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

  it('rejects mutation of evidence that already existed at the candidate commit', () => {
    const evidencePath = `${releaseEvidenceDirectory(RELEASE)}candidate-proof.txt`;
    withRepo({ candidateEvidencePath: evidencePath }, ({ repoRoot, candidateCommit }) => {
      freezeEvidence(repoRoot, candidateCommit);
      writeFileSync(resolve(repoRoot, evidencePath), 'candidate-proof rewritten\n');
      const headCommit = commitAll(repoRoot, 'mutate candidate evidence');
      assert.throws(
        () => inspectCandidateController({ repoRoot, candidateCommit, headCommit, release: RELEASE }),
        /release evidence blob must never be modified.*candidate-proof\.txt/,
      );
    });
  });

  it('rejects an added receipt edited, deleted, re-added, or renamed later', () => {
    for (const operation of ['edit', 'delete', 'readd', 'rename']) {
      withCandidateRepo(({ repoRoot, candidateCommit }) => {
        const receipt = `${releaseEvidenceDirectory(RELEASE)}receipt.txt`;
        const headAfterFreeze = freezeEvidence(repoRoot, candidateCommit);
        let headCommit;
        if (operation === 'edit') {
          writeFileSync(resolve(repoRoot, receipt), 'edited receipt\n');
          headCommit = commitAll(repoRoot, 'edit receipt');
        } else if (operation === 'rename') {
          const renamed = `${releaseEvidenceDirectory(RELEASE)}renamed-receipt.txt`;
          renameSync(resolve(repoRoot, receipt), resolve(repoRoot, renamed));
          headCommit = commitAll(repoRoot, 'rename receipt');
        } else {
          rmSync(resolve(repoRoot, receipt));
          headCommit = commitAll(repoRoot, 'delete receipt');
          if (operation === 'readd') {
            writeFileSync(resolve(repoRoot, receipt), 're-added receipt\n');
            headCommit = commitAll(repoRoot, 're-add receipt');
          }
        }
        assert.notEqual(headCommit, headAfterFreeze);
        assert.throws(
          () => inspectCandidateController({ repoRoot, candidateCommit, headCommit, release: RELEASE }),
          /release evidence (blob must never be modified|path must never be deleted or renamed|path was re-added)/,
        );
      });
    }
  });

  it('rejects symlink evidence and accepts distinct add-once evidence files', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const headCommit = freezeEvidence(repoRoot, candidateCommit, {
        evidencePath: `${releaseEvidenceDirectory(RELEASE)}symlink.txt`,
        evidenceKind: 'symlink',
      });
      assert.throws(
        () => inspectCandidateController({ repoRoot, candidateCommit, headCommit, release: RELEASE }),
        /non-executable regular blob/,
      );
    });

    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      freezeEvidence(repoRoot, candidateCommit);
      const extra = `${releaseEvidenceDirectory(RELEASE)}second-receipt.txt`;
      writeFileSync(resolve(repoRoot, extra), 'second immutable receipt\n');
      const headCommit = commitAll(repoRoot, 'add distinct receipt');
      assert.doesNotThrow(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }));
    });

    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const receipt = `${releaseEvidenceDirectory(RELEASE)}receipt.txt`;
      freezeEvidence(repoRoot, candidateCommit);
      const copy = `${releaseEvidenceDirectory(RELEASE)}copied-receipt.txt`;
      copyFileSync(resolve(repoRoot, receipt), resolve(repoRoot, copy));
      const headCommit = commitAll(repoRoot, 'copy receipt into distinct artifact');
      assert.doesNotThrow(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }));
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

  it('rejects transient manifest and ledger identity drift even when later restored', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, RELEASE_MANIFEST_PATH), 'utf8'));
      writeJson(repoRoot, RELEASE_MANIFEST_PATH, {
        ...manifest,
        astrid: { commit: 'c'.repeat(40) },
      });
      commitAll(repoRoot, 'transient manifest pin drift');
      writeJson(repoRoot, RELEASE_MANIFEST_PATH, manifest);
      const headCommit = freezeEvidence(repoRoot, candidateCommit);
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }), /invalid release manifest edge.*outside the exact status freeze/s);
    });

    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const ledger = JSON.parse(readFileSync(resolve(repoRoot, RELEASE_LEDGER_PATH), 'utf8'));
      writeJson(repoRoot, RELEASE_LEDGER_PATH, {
        ...ledger,
        workstreams: [{ ...ledger.workstreams[0], title: 'Temporarily Rewritten' }],
      });
      commitAll(repoRoot, 'transient ledger identity drift');
      writeJson(repoRoot, RELEASE_LEDGER_PATH, ledger);
      const headCommit = freezeEvidence(repoRoot, candidateCommit);
      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit,
        release: RELEASE,
      }), /invalid evidence ledger edge.*identity or ordering changed/s);
    });
  });

  it('ignores malicious local replacement refs while inspecting release history', () => {
    withCandidateRepo(({ repoRoot, candidateCommit }) => {
      const safeHead = freezeEvidence(repoRoot, candidateCommit);
      git(repoRoot, ['reset', '--hard', candidateCommit]);
      writeFileSync(resolve(repoRoot, 'src/app.js'), 'export const candidate = false;\n');
      commitAll(repoRoot, 'malicious source drift');
      const maliciousHead = freezeEvidence(repoRoot, candidateCommit);
      git(repoRoot, ['replace', maliciousHead, safeHead]);

      assert.throws(() => inspectCandidateController({
        repoRoot,
        candidateCommit,
        headCommit: maliciousHead,
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
