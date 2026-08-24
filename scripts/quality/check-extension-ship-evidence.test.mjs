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
// Keep the synthetic release fixture aligned with the checked-in integration
// manifest so the test remains valid when an immutable candidate rolls from
// one RC tag to the next. Historical RC1 evidence is tested separately by its
// committed artifact and is never replayed here.
const release = checkedInManifest.release;
const fixtureRepo = mkdtempSync(resolve(tmpdir(), 'extension-ship-evidence-'));
const signerDirectory = resolve(fixtureRepo, 'signers');
mkdirSync(signerDirectory, { recursive: true });
const evidencePath = `docs/extensions/evidence/releases/${release}/receipt.txt`;
const largeCommittedEvidencePath = `docs/extensions/evidence/releases/${release}/large.bin`;
const reighCommit = 'a'.repeat(40);
const astridCommit = 'b'.repeat(40);
const controllerCommit = 'c'.repeat(40);
mkdirSync(resolve(fixtureRepo, evidencePath, '..'), { recursive: true });
writeFileSync(resolve(fixtureRepo, evidencePath), 'immutable release receipt\n');
writeFileSync(resolve(fixtureRepo, largeCommittedEvidencePath), Buffer.alloc((2 * 1024 * 1024) + 1, 0x5a));
after(() => rmSync(fixtureRepo, { recursive: true, force: true }));

const evidenceHash = createHash('sha256')
  .update(readFileSync(resolve(fixtureRepo, evidencePath)))
  .digest('hex');
const largeCommittedEvidenceHash = createHash('sha256')
  .update(readFileSync(resolve(fixtureRepo, largeCommittedEvidencePath)))
  .digest('hex');

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
    const publicKey = `${type} ${key}`;
    const encoded = Buffer.from(key, 'base64');
    const fingerprint = `SHA256:${createHash('sha256').update(encoded).digest('base64')}`;
    return { ...spec, publicKey, fingerprint };
  }),
};

const capturedAt = '2026-08-23T12:00:00.000Z';
const environment = { id: 'hermetic-test-fixture', toolVersions: { node: '20.19.4' } };
const typedEvidence = new Map();

function commonDocument(evidenceType, record) {
  return {
    schemaVersion: 1,
    evidenceType,
    release,
    candidate: { reighCommit, astridCommit },
    capturedAt,
    environment,
    record,
  };
}

function writeTypedEvidence(name, document) {
  const path = `docs/extensions/evidence/releases/${release}/typed/${name}.json`;
  mkdirSync(resolve(fixtureRepo, path, '..'), { recursive: true });
  writeFileSync(resolve(fixtureRepo, path), `${JSON.stringify(document, null, 2)}\n`);
  const artifact = {
    path,
    sha256: createHash('sha256').update(readFileSync(resolve(fixtureRepo, path))).digest('hex'),
  };
  typedEvidence.set(name, { document, artifact });
  return artifact;
}

const allPassTests = Object.fromEntries([
  'regenerate', 'preserve', 'accept', 'split', 'merge', 'deletion', 'retiming',
  'overlapping-speakers', 'empty-text', 'unicode',
].map((name) => [name, 'pass']));
const transcriptBinding = {
  handoffId: 'handoff-1', ownerId: 'source-owner-1', sourceRevision: 'source-r1',
  returnedRevision: 'source-r2', handoffFingerprint: '1'.repeat(64),
  appliedSourceFingerprint: '2'.repeat(64),
};
writeTypedEvidence('transcript', commonDocument('transcript-owner-acknowledgement', {
  handoff: { ...transcriptBinding, evidence: { path: evidencePath, sha256: evidenceHash } },
  acknowledgement: {
    ...transcriptBinding,
    status: 'acknowledged-by-source-owner',
    acknowledgedAt: capturedAt,
    evidence: { path: evidencePath, sha256: evidenceHash },
  },
  tests: allPassTests,
}));
writeTypedEvidence('rollout', commonDocument('rollout-stage', {
  stage: 0,
  changedFlag: 'host',
  reads: ['deployment-api', 'served-runtime-document'].map((source) => ({
    source,
    capturedAt,
    configRevision: 'config-r1',
    flags: { host: false, 'transcript-foundry': false, runaway: false },
    route: { routeId: 'route-dark', cohort: 'none', percentage: 0 },
    evidence: { path: evidencePath, sha256: evidenceHash },
  })),
  drill: {
    kind: 'emergency-disable', startedAt: capturedAt, completedAt: capturedAt,
    expected: 'all flags off', observed: 'all flags off', outcome: 'pass',
    evidence: { path: evidencePath, sha256: evidenceHash },
  },
  owners: ['release-dri', 'reigh-on-call', 'astrid-on-call', 'observability-on-call'],
  outcome: 'pass',
}));
writeTypedEvidence('observability', commonDocument('production-observability', {
  deployment: 'production',
  releaseRevision: reighCommit,
  syntheticProbe: {
    id: 'probe-1', capturedAt,
    eventFamilies: [
      'host-activation', 'extension-lifecycle', 'command-outcome', 'bridge-request',
      'persistence-conflict', 'migration-outcome', 'render-export', 'lane-density',
    ],
    outcome: 'pass', evidence: { path: evidencePath, sha256: evidenceHash },
  },
  dashboard: {
    id: 'extension-health', revisionFilter: reighCommit, inspectedAt: capturedAt,
    targetRevisionStatus: 'healthy', evidence: { path: evidencePath, sha256: evidenceHash },
  },
  rateLimit: {
    distributed: true, enforcementPoint: 'edge', allowedCount: 10, rejectedCount: 2,
    testedAt: capturedAt, outcome: 'pass', evidence: { path: evidencePath, sha256: evidenceHash },
  },
  alertDrills: [
    'missing-revision-telemetry', 'unknown-error-class', 'rejection-spike', 'broken-dashboard',
  ].map((kind) => ({
    kind, firedAt: capturedAt, acknowledgedBy: 'observability-on-call',
    acknowledgedAt: capturedAt, runbookLinked: true, outcome: 'pass',
    evidence: { path: evidencePath, sha256: evidenceHash },
  })),
  privacyAudit: {
    inspectedAt: capturedAt, inspectedBy: 'privacy-reviewer',
    forbiddenFieldsFound: 0, outcome: 'pass', evidence: { path: evidencePath, sha256: evidenceHash },
  },
  outcome: 'pass',
}));
for (const drillType of ['rapid-disable-rollback', 'corrupt-data', 'failed-migration']) {
  writeTypedEvidence(`recovery-${drillType}`, commonDocument('recovery-drill', {
    drillType,
    incidentId: `drill-${drillType}`,
    backup: { id: 'backup-1', createdAt: capturedAt, toolVersion: '1.0.0', sha256: evidenceHash, readVerified: true },
    hashes: { preState: '3'.repeat(64), backup: evidenceHash, restoredState: '3'.repeat(64), postState: '3'.repeat(64) },
    timeline: ['disable', 'backup', 'restore', 'verify'].map((action) => ({
      at: capturedAt, actor: 'operator', action, outcome: action === 'disable' ? 'contained' : 'pass',
    })),
    approvals: [
      ['incident-commander', 'incident-owner'], ['release-dri', 'release-owner'],
      ['data-or-service-owner', 'data-owner'],
    ].map(([role, principal]) => ({ role, principal, approvedAt: capturedAt, decision: 'approve' })),
    checks: {
      flagsOff: true, writersStopped: true, restoreVerified: true, restartVerified: true,
      renderExportVerified: true, secondRunIdempotent: true, zeroDuplicates: true,
    },
    outcome: 'pass',
  }));
}
for (const spec of identitySpecs.filter((entry) => entry.kind === 'human')) {
  writeTypedEvidence(`human-${spec.persona}`, commonDocument('human-persona-session', {
    sessionId: `session-${spec.persona}`,
    persona: spec.persona,
    participant: { principal: spec.principal, consentRecordId: `consent-${spec.persona}` },
    projectFixtureId: 'fixture-safe-1',
    browserDevice: { browser: 'Chrome', version: '128.0.0', device: 'test workstation' },
    assistiveTechnologies: spec.persona === 'accessibility-user' ? ['VoiceOver'] : [],
    inputMethods: ['keyboard', 'pointer'],
    taskGoals: ['complete extension journey'],
    tasks: ({
      'video-editor': ['extension-journey', 'dense-lane-edit', 'reload-restart-persistence', 'safe-failure-recovery', 'render-export'],
      'accessibility-user': ['keyboard-only', 'focus-retention', 'names-state-announcements', 'zoom-200', 'reduced-motion', 'error-recovery'],
      'transcript-specialist': ['regenerate', 'preserve', 'accept', 'split', 'merge', 'delete', 'retime', 'overlapping-speakers', 'empty-text', 'unicode', 'source-correction-boundary'],
      'first-time-extension-author': ['public-sdk-only', 'build-extension', 'diagnose-failure', 'enable-invoke', 'render-export'],
    })[spec.persona].map((id) => ({
      id, outcome: 'pass', durationSeconds: 120, observations: [],
      evidenceRefs: [{ path: evidencePath, sha256: evidenceHash }],
    })),
    persistedState: { beforeSha256: '4'.repeat(64), afterRestartSha256: '5'.repeat(64), matchesExpected: true },
    renderExport: { renderSha256: '6'.repeat(64), exportSha256: '7'.repeat(64), matchesExpected: true },
    privacy: { capturesReviewed: true, prohibitedContentCollected: false },
    findings: [],
    decision: 'approve',
  }));
}
for (const slot of ['A', 'B']) {
  const principal = `independent-reviewer-${slot.toLowerCase()}`;
  writeTypedEvidence(`review-${slot}`, commonDocument('independent-review', {
    slot,
    reviewer: { principal, team: `independent-team-${slot}` },
    independence: { statement: 'No authorship or disqualifying conflict.', authoredScopes: [], conflicts: [], disqualifyingConflict: false },
    scope: slot === 'A'
      ? ['release-gates', 'clean-machine-reproduction', 'rollout', 'production-observability', 'rollback']
      : ['persistence', 'recovery-migration', 'transcript-policy', 'accessibility', 'render-export', 'human-acceptance'],
    findings: [],
    disposition: 'approve',
    evidenceIndex: { path: evidencePath, sha256: evidenceHash },
    verifiedArtifacts: [{ path: evidencePath, sha256: evidenceHash }],
    verification: { freshCheckout: true, rawEvidenceInspected: true, hashesVerified: true, rollbackVerified: true },
  }));
}

for (const args of [
  ['init', '-q'],
  ['config', 'user.name', 'Evidence Test'],
  ['config', 'user.email', 'evidence-test@example.invalid'],
  ['add', 'docs'],
  ['commit', '-q', '-m', 'evidence fixtures'],
]) {
  execFileSync('git', args, { cwd: fixtureRepo, stdio: 'ignore' });
}
const allEvidencePaths = [
  evidencePath,
  largeCommittedEvidencePath,
  ...[...typedEvidence.values()].map(({ artifact }) => artifact.path),
];

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
    capturedAt,
    action: manual ? 'Signed manual acceptance protocol' : 'npm run release:test',
    environment,
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
      if (workstream.number === 10) {
        receipts = [makeReceipt('browser', 'transcript-owner-ack', {
          artifact: typedEvidence.get('transcript').artifact,
        })];
      } else if (workstream.number === 19) {
        receipts = [makeReceipt('deployment', 'rollout-stage-0', {
          artifact: typedEvidence.get('rollout').artifact,
        })];
      } else if (workstream.number === 20) {
        receipts = [makeReceipt('observability', 'production-observability', {
          artifact: typedEvidence.get('observability').artifact,
        })];
      } else if (workstream.number === 21) {
        receipts = ['rapid-disable-rollback', 'corrupt-data', 'failed-migration'].map(
          (drillType) => makeReceipt('recovery', `recovery-${drillType}`, {
            artifact: typedEvidence.get(`recovery-${drillType}`).artifact,
          }),
        );
      } else if (workstream.number === 22) {
        receipts = [
          'video-editor',
          'accessibility-user',
          'transcript-specialist',
          'first-time-extension-author',
        ].map((persona, index) => makeReceipt(
          'human',
          `human-${index}`,
          { persona, artifact: typedEvidence.get(`human-${persona}`).artifact },
        ));
      } else if (workstream.number === 23) {
        receipts = [
          makeReceipt('review', 'review-a', { artifact: typedEvidence.get('review-A').artifact }),
          makeReceipt('review', 'review-b', { artifact: typedEvidence.get('review-B').artifact }),
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
    });
    assert.match(result.errors.join('\n'), /sha256 mismatch/);
    assert.match(result.errors.join('\n'), /first-time-extension-author/);
    assert.match(result.errors.join('\n'), /two independently keyed trusted review receipts/);
  });

  it('rejects generic artifact reuse across external-evidence workstreams', () => {
    const ledger = makeFrozenLedger();
    for (const index of [9, 18]) {
      ledger.workstreams[index].receipts[0].artifact = {
        path: evidencePath,
        sha256: evidenceHash,
      };
    }
    const result = validateLedger({
      ledger,
      checklistMarkdown,
      releaseManifest: frozenManifest,
      attestationTrust: testTrust,
      repoRoot: fixtureRepo,
      mode: 'release',
      candidateCommit: reighCommit,
      headCommit: controllerCommit,
      provenanceChangedPaths: allEvidencePaths,
    });
    const errors = result.errors.join('\n');
    assert.match(errors, /must be a JSON external-evidence document/);
    assert.match(errors, /reuses external evidence already owned by/);
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
    });
    assert.match(result.errors.join('\n'), /attestation principal is not trusted: rogue-reviewer/);
  });

  it('rejects replay of signed receipts into a different release', () => {
    const ledger = makeFrozenLedger();
    ledger.release = 'extension-ship-quality-rc3';
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
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
      provenanceChangedPaths: allEvidencePaths,
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
