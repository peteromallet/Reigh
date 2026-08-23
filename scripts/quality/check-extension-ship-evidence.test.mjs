import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  ATTESTATION_NAMESPACE,
  ATTESTATION_TRUST_PATH,
  CHECKLIST_PATH,
  LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
  REPO_ROOT,
  canonicalReceiptPayload,
  parseChecklistWorkstreams,
  validateLedger,
} from './check-extension-ship-evidence.mjs';
import {
  parseArgs as parseSignerArgs,
  signLedgerReceipt,
} from './sign-extension-ship-receipt.mjs';

const checklistMarkdown = readFileSync(CHECKLIST_PATH, 'utf8');
const expected = parseChecklistWorkstreams(checklistMarkdown);
const checkedInLedger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const checkedInManifest = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
const checkedInTrust = JSON.parse(readFileSync(ATTESTATION_TRUST_PATH, 'utf8'));
const release = 'extension-ship-quality-rc1';
const fixtureRepo = mkdtempSync(resolve(tmpdir(), 'extension-ship-evidence-'));
const signerDirectory = resolve(fixtureRepo, 'signers');
mkdirSync(signerDirectory, { recursive: true });
const evidencePath = `docs/extensions/evidence/releases/${release}/receipt.txt`;
const largeCommittedEvidencePath = `docs/extensions/evidence/releases/${release}/large.bin`;
mkdirSync(resolve(fixtureRepo, evidencePath, '..'), { recursive: true });
writeFileSync(resolve(fixtureRepo, evidencePath), 'immutable release receipt\n');
writeFileSync(resolve(fixtureRepo, largeCommittedEvidencePath), Buffer.alloc((2 * 1024 * 1024) + 1, 0x5a));
for (const args of [
  ['init', '-q'],
  ['config', 'user.name', 'Evidence Test'],
  ['config', 'user.email', 'evidence-test@example.invalid'],
  ['add', '-A'],
  ['commit', '-q', '-m', 'evidence fixtures'],
]) {
  execFileSync('git', args, { cwd: fixtureRepo, stdio: 'ignore' });
}
after(() => rmSync(fixtureRepo, { recursive: true, force: true }));

const evidenceHash = createHash('sha256')
  .update(readFileSync(resolve(fixtureRepo, evidencePath)))
  .digest('hex');
const largeCommittedEvidenceHash = createHash('sha256')
  .update(readFileSync(resolve(fixtureRepo, largeCommittedEvidencePath)))
  .digest('hex');
const reighCommit = 'a'.repeat(40);
const astridCommit = 'b'.repeat(40);
const controllerCommit = 'c'.repeat(40);

const identitySpecs = [
  { principal: 'human-video-editor', kind: 'human', persona: 'video-editor' },
  { principal: 'human-accessibility-user', kind: 'human', persona: 'accessibility-user' },
  { principal: 'human-transcript-specialist', kind: 'human', persona: 'transcript-specialist' },
  { principal: 'human-first-time-author', kind: 'human', persona: 'first-time-extension-author' },
  { principal: 'independent-reviewer-a', kind: 'review' },
  { principal: 'independent-reviewer-b', kind: 'review' },
];
const signerPathByPrincipal = new Map();
const testTrust = {
  schemaVersion: 1,
  release,
  namespace: ATTESTATION_NAMESPACE,
  identities: identitySpecs.map((spec) => {
    const privateKeyPath = resolve(signerDirectory, spec.principal);
    execFileSync(
      'ssh-keygen',
      ['-q', '-t', 'ed25519', '-N', '', '-C', 'fixture', '-f', privateKeyPath],
      { stdio: 'ignore' },
    );
    signerPathByPrincipal.set(spec.principal, privateKeyPath);
    const [type, key] = readFileSync(`${privateKeyPath}.pub`, 'utf8').trim().split(/\s+/);
    return { ...spec, publicKey: `${type} ${key}` };
  }),
};

function signReceipt(ledger, workstream, receipt, principal, privateKeyPath) {
  receipt.attestation = { namespace: ATTESTATION_NAMESPACE, principal, signature: '' };
  const payloadPath = resolve(signerDirectory, `${receipt.id}.payload`);
  writeFileSync(payloadPath, canonicalReceiptPayload({
    release: ledger.release,
    candidate: ledger.candidate,
    workstream,
    receipt,
  }));
  rmSync(`${payloadPath}.sig`, { force: true });
  execFileSync(
    'ssh-keygen',
    ['-Y', 'sign', '-f', privateKeyPath, '-n', ATTESTATION_NAMESPACE, payloadPath],
    { stdio: 'ignore' },
  );
  receipt.attestation.signature = readFileSync(`${payloadPath}.sig`, 'utf8');
}

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
      ? { decision: 'approve' }
      : { exitCode: 0 }),
    ...extra,
  };
}

function makeFrozenLedger() {
  const ledger = {
    schemaVersion: 1,
    release,
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
          { persona },
        ));
      } else if (workstream.number === 23) {
        receipts = [
          makeReceipt('review', 'review-a'),
          makeReceipt('review', 'review-b'),
        ];
      } else {
        receipts = [makeReceipt(
          requiredKind.get(workstream.number),
          `workstream-${workstream.number}`,
          workstream.number === 12
            ? { persona: 'accessibility-user' }
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
  for (const workstream of ledger.workstreams) {
    for (const receipt of workstream.receipts) {
      if (receipt.kind !== 'human' && receipt.kind !== 'review') continue;
      const principal = receipt.kind === 'human'
        ? testTrust.identities.find((identity) => identity.persona === receipt.persona).principal
        : `independent-reviewer-${receipt.id.endsWith('a') ? 'a' : 'b'}`;
      signReceipt(
        ledger,
        workstream,
        receipt,
        principal,
        signerPathByPrincipal.get(principal),
      );
    }
  }
  return ledger;
}

const frozenManifest = {
  ...checkedInManifest,
  status: 'frozen',
  astrid: { ...checkedInManifest.astrid, commit: astridCommit },
};

describe('extension ship evidence gate', () => {
  it('requires an explicit signer target and refuses unknown signer options', () => {
    assert.deepEqual(parseSignerArgs(['--help']), { help: true });
    assert.throws(() => parseSignerArgs([]), /--workstream is required/);
    assert.throws(() => parseSignerArgs(['--replace']), /unknown option/);
  });

  it('signs an unsigned receipt only with its configured persona key', () => {
    const ledger = makeFrozenLedger();
    const workstream = ledger.workstreams[11];
    const receipt = workstream.receipts[0];
    delete receipt.attestation;
    const principal = 'human-video-editor';
    assert.throws(() => signLedgerReceipt({
      ledger,
      trust: testTrust,
      workstreamId: workstream.id,
      receiptId: receipt.id,
      principal,
      privateKeyPath: signerPathByPrincipal.get(principal),
    }), /not authorized for persona accessibility-user/);

    const correctPrincipal = 'human-accessibility-user';
    signLedgerReceipt({
      ledger,
      trust: testTrust,
      workstreamId: workstream.id,
      receiptId: receipt.id,
      principal: correctPrincipal,
      privateKeyPath: signerPathByPrincipal.get(correctPrincipal),
    });
    assert.match(receipt.attestation.signature, /BEGIN SSH SIGNATURE/);
    assert.throws(() => signLedgerReceipt({
      ledger,
      trust: testTrust,
      workstreamId: workstream.id,
      receiptId: receipt.id,
      principal: correctPrincipal,
      privateKeyPath: signerPathByPrincipal.get(correctPrincipal),
    }), /refusing to overwrite/);
  });

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
      attestationTrust: checkedInTrust,
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
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.pass, 23);
  });

  it('fails release mode until all four personas and two reviewers are trusted', () => {
    const result = validateLedger({
      ledger: makeFrozenLedger(),
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: checkedInTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /missing the video-editor human principal/);
    assert.match(result.errors.join('\n'), /missing the accessibility-user human principal/);
    assert.match(result.errors.join('\n'), /missing the transcript-specialist human principal/);
    assert.match(result.errors.join('\n'), /missing the first-time-extension-author human principal/);
    assert.match(result.errors.join('\n'), /at least two independent reviewer principals/);
  });

  it('verifies committed evidence bytes, including artifacts larger than the default child-process buffer', () => {
    const ledger = makeFrozenLedger();
    const receipts = ledger.workstreams.flatMap((workstream) => workstream.receipts);
    for (const receipt of receipts) {
      receipt.artifact = { path: evidencePath, sha256: evidenceHash };
    }
    receipts[0].artifact = {
      path: largeCommittedEvidencePath,
      sha256: largeCommittedEvidenceHash,
    };

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
      verifyCommittedArtifacts: true,
    });
    assert.deepEqual(result.errors, []);
  });

  it('rejects altered evidence, incomplete human acceptance, and duplicate reviews', () => {
    const ledger = makeFrozenLedger();
    ledger.workstreams[0].receipts[0].artifact.sha256 = '0'.repeat(64);
    ledger.workstreams[21].receipts.pop();
    ledger.workstreams[22].receipts[1].attestation = structuredClone(
      ledger.workstreams[22].receipts[0].attestation,
    );

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /sha256 mismatch/);
    assert.match(result.errors.join('\n'), /first-time-extension-author/);
    assert.match(result.errors.join('\n'), /two independently keyed trusted review receipts/);
  });

  it('rejects a forged principal even when reviewerId self-asserts independence', () => {
    const ledger = makeFrozenLedger();
    const receipt = ledger.workstreams[22].receipts[1];
    receipt.attestation.principal = 'independent-reviewer-a';
    receipt.reviewerId = 'independent-reviewer-b';

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /SSH signature verification failed/);
    assert.match(result.errors.join('\n'), /reviewerId.*trusted attestation principal/);
    assert.match(result.errors.join('\n'), /two independently keyed trusted review receipts/);
  });

  it('rejects a signed receipt whose canonical payload was modified', () => {
    const ledger = makeFrozenLedger();
    ledger.workstreams[21].receipts[0].action = 'Claimed a different acceptance protocol';

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /SSH signature verification failed/);
  });

  it('rejects a valid SSH signature made by an untrusted key', () => {
    const ledger = makeFrozenLedger();
    const rogueKeyPath = resolve(signerDirectory, 'rogue-reviewer');
    execFileSync(
      'ssh-keygen',
      ['-q', '-t', 'ed25519', '-N', '', '-C', 'rogue', '-f', rogueKeyPath],
      { stdio: 'ignore' },
    );
    const workstream = ledger.workstreams[22];
    signReceipt(ledger, workstream, workstream.receipts[0], 'rogue-reviewer', rogueKeyPath);

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /attestation principal is not trusted: rogue-reviewer/);
  });

  it('rejects replay of signed receipts into a different release', () => {
    const ledger = makeFrozenLedger();
    ledger.release = 'extension-ship-quality-rc2';
    const replayManifest = { ...frozenManifest, release: ledger.release };
    const replayTrust = { ...testTrust, release: ledger.release };

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: replayManifest,
      attestationTrust: replayTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /SSH signature verification failed/);
  });

  it('binds receipts to the tagged candidate, not the evidence controller HEAD', () => {
    const ledger = makeFrozenLedger();
    ledger.workstreams[0].receipts[0].commit = controllerCommit;

    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /commit does not match the frozen Reigh candidate/);
  });

  it('rejects the impossible same-commit controller and propagated provenance failures', () => {
    const result = validateLedger({
      ledger: makeFrozenLedger(),
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: reighCommit,
      provenanceErrors: ['candidate..HEAD contains non-evidence path changes: src/app.ts'],
      provenanceChangedPaths: [evidencePath, largeCommittedEvidencePath],
    });
    assert.match(result.errors.join('\n'), /strict evidence-only descendant/);
    assert.match(result.errors.join('\n'), /src\/app\.ts/);
  });

  it('rejects receipts outside or absent from the controller evidence closure', () => {
    const outside = makeFrozenLedger();
    outside.workstreams[0].receipts[0].artifact.path = '.nvmrc';
    let result = validateLedger({
      ledger: outside,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [evidencePath],
    });
    assert.match(result.errors.join('\n'), /must be under docs\/extensions\/evidence\/releases/);

    result = validateLedger({
      ledger: makeFrozenLedger(),
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: [],
    });
    assert.match(result.errors.join('\n'), /was not committed in the candidate-to-controller evidence history/);
  });
});
