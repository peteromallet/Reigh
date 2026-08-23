import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CHECKLIST_PATH,
  LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
  REPO_ROOT,
  parseChecklistWorkstreams,
  validateLedger,
} from './check-extension-ship-evidence.mjs';

const checklistMarkdown = readFileSync(CHECKLIST_PATH, 'utf8');
const expected = parseChecklistWorkstreams(checklistMarkdown);
const checkedInLedger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const checkedInManifest = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
const evidencePath = 'scripts/quality/check-extension-ship-evidence.mjs';
const evidenceHash = createHash('sha256')
  .update(readFileSync(`${REPO_ROOT}/${evidencePath}`))
  .digest('hex');
const reighCommit = 'a'.repeat(40);
const astridCommit = 'b'.repeat(40);

const requiredKind = new Map([
  [1, 'command'], [2, 'command'], [3, 'browser'], [4, 'database'],
  [5, 'render'], [6, 'performance'], [7, 'command'], [8, 'security'],
  [9, 'command'], [10, 'browser'], [11, 'browser'], [12, 'human'],
  [13, 'browser'], [14, 'performance'], [15, 'visual'], [16, 'recovery'],
  [17, 'security'], [18, 'database'], [19, 'deployment'],
  [20, 'observability'], [21, 'recovery'], [22, 'human'], [23, 'review'],
]);

function makeReceipt(kind, id, extra = {}) {
  const manual = kind === 'human' || kind === 'review';
  return {
    id,
    kind,
    repository: 'reigh',
    commit: reighCommit,
    capturedAt: '2026-08-23T12:00:00.000Z',
    action: manual ? 'Signed manual acceptance protocol' : 'npm run release:test',
    environment: {
      id: 'hermetic-test-fixture',
      toolVersions: { node: '20.19.4' },
    },
    artifact: { path: evidencePath, sha256: evidenceHash },
    ...(manual
      ? { decision: 'approve', reviewerId: `reviewer-${id}` }
      : { exitCode: 0 }),
    ...extra,
  };
}

function makeFrozenLedger() {
  return {
    schemaVersion: 1,
    release: 'extension-ship-quality-rc1',
    status: 'frozen',
    candidate: { reighCommit, astridCommit },
    workstreams: expected.map((workstream) => {
      let receipts;
      if (workstream.number === 22) {
        receipts = [
          'video-editor',
          'accessibility-user',
          'transcript-specialist',
          'first-time-extension-author',
        ].map((persona, index) => makeReceipt(
          'human',
          `human-${index}`,
          { persona, reviewerId: `human-${index}` },
        ));
      } else if (workstream.number === 23) {
        receipts = [
          makeReceipt('review', 'review-a', { reviewerId: 'independent-a' }),
          makeReceipt('review', 'review-b', { reviewerId: 'independent-b' }),
        ];
      } else {
        receipts = [makeReceipt(
          requiredKind.get(workstream.number),
          `workstream-${workstream.number}`,
          workstream.number === 12
            ? { reviewerId: 'accessibility-gate-human' }
            : {},
        )];
      }
      return {
        id: workstream.id,
        title: workstream.title,
        status: 'pass',
        receipts,
      };
    }),
  };
}

const frozenManifest = {
  ...checkedInManifest,
  status: 'frozen',
  astrid: { ...checkedInManifest.astrid, commit: astridCommit.slice(0, 12) },
};

describe('extension ship evidence gate', () => {
  it('derives the exact 23 workstreams from the canonical checklist', () => {
    assert.equal(expected.length, 23);
    assert.deepEqual(expected[0], {
      number: 1,
      title: 'Clean integration branch',
      id: '1-clean-integration-branch',
    });
    assert.equal(expected.at(-1).id, '23-frozen-release-candidate');
  });

  it('keeps the checked-in integration ledger structurally honest', () => {
    const result = validateLedger({
      ledger: checkedInLedger,
      checklistMarkdown,
      releaseManifest: checkedInManifest,
      repoRoot: REPO_ROOT,
      mode: 'audit',
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.counts, {
      pending: 0,
      in_progress: 21,
      blocked: 2,
      pass: 0,
    });
  });

  it('accepts only a fully receipted frozen paired candidate', () => {
    const result = validateLedger({
      ledger: makeFrozenLedger(),
      checklistMarkdown,
      releaseManifest: frozenManifest,
      repoRoot: REPO_ROOT,
      mode: 'release',
      headCommit: reighCommit,
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.pass, 23);
  });

  it('rejects altered evidence, incomplete human acceptance, and duplicate reviews', () => {
    const ledger = makeFrozenLedger();
    ledger.workstreams[0].receipts[0].artifact.sha256 = '0'.repeat(64);
    ledger.workstreams[21].receipts.pop();
    ledger.workstreams[22].receipts[1].reviewerId = 'independent-a';

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      repoRoot: REPO_ROOT,
      mode: 'release',
      headCommit: reighCommit,
    });
    assert.match(result.errors.join('\n'), /sha256 mismatch/);
    assert.match(result.errors.join('\n'), /first-time-extension-author/);
    assert.match(result.errors.join('\n'), /two independent review receipts/);
  });
});
