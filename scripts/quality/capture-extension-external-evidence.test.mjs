import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  parseArgs,
  runCli,
} from './capture-extension-external-evidence.mjs';
import {
  EXTERNAL_EVIDENCE_TYPES,
  validateExternalEvidence,
} from './lib/extension-external-evidence.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const templateRoot = resolve(
  repoRoot,
  'config/releases/extension-external-evidence/v1/templates',
);
const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'extension-external-evidence-cli-'));
after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

function template(type) {
  return JSON.parse(readFileSync(resolve(templateRoot, `${type}.json`), 'utf8'));
}

describe('typed extension external evidence', () => {
  it('commits one deliberately incomplete operator template for every evidence type', () => {
    for (const type of EXTERNAL_EVIDENCE_TYPES) {
      const draft = template(type);
      assert.equal(draft.evidenceType, type);
      assert.ok(validateExternalEvidence(draft).errors.length > 0);
    }
  });

  it('rejects mismatched transcript acknowledgement bindings', () => {
    const draft = template('transcript-owner-acknowledgement');
    draft.record.handoff.handoffId = 'handoff-one';
    draft.record.acknowledgement.handoffId = 'handoff-two';
    assert.match(
      validateExternalEvidence(draft).errors.join('\n'),
      /acknowledgement\.handoffId must exactly match handoff\.handoffId/,
    );
  });

  it('rejects rollout evidence whose two reads are not independent', () => {
    const draft = template('rollout-stage');
    draft.record.reads[0].source = 'same-api';
    draft.record.reads[1].source = 'same-api';
    assert.match(
      validateExternalEvidence(draft).errors.join('\n'),
      /must use two independent sources/,
    );
  });

  it('rejects observability evidence missing required probe and alert families', () => {
    const errors = validateExternalEvidence(template('production-observability')).errors.join('\n');
    assert.match(errors, /eventFamilies is missing host-activation/);
    assert.match(errors, /alertDrills is missing broken-dashboard/);
  });

  it('rejects recovery evidence when the backup hash is not internally bound', () => {
    const draft = template('recovery-drill');
    draft.record.backup.sha256 = '1'.repeat(64);
    draft.record.hashes.backup = '2'.repeat(64);
    assert.match(
      validateExternalEvidence(draft).errors.join('\n'),
      /hashes\.backup must match backup\.sha256/,
    );
  });

  it('rejects accepted release blockers and reviewer-authored scope', () => {
    const human = template('human-persona-session');
    human.record.findings = [{
      id: 'finding-1', severity: 'sev1', summary: 'Core task failed', owner: 'owner',
      dueAt: '2026-08-24T00:00:00.000Z', disposition: 'accepted',
      evidenceRefs: [{ path: 'evidence.txt', sha256: '1'.repeat(64) }],
    }];
    assert.match(validateExternalEvidence(human).errors.join('\n'), /release-blocking findings must be fixed/);

    const review = template('independent-review');
    review.record.independence.authoredScopes = ['rollout implementation'];
    assert.match(validateExternalEvidence(review).errors.join('\n'), /authoredScopes must be empty/);
  });

  it('fails closed on unknown fields', () => {
    const draft = template('rollout-stage');
    draft.record.unreviewedClaim = true;
    assert.match(validateExternalEvidence(draft).errors.join('\n'), /unreviewedClaim is not allowed/);
  });
});

describe('external evidence operator CLI', () => {
  it('parses repeatable tool pins and has no private-key option', () => {
    const parsed = parseArgs([
      'init', '--type', 'rollout-stage', '--output', 'draft.json', '--release', 'rc1',
      '--reigh-commit', 'a'.repeat(40), '--astrid-commit', 'b'.repeat(40),
      '--environment', 'prod', '--tool', 'node=20.19.4', '--tool', 'npm=10.8.2',
    ]);
    assert.deepEqual(parsed.tool, ['node=20.19.4', 'npm=10.8.2']);
    assert.throws(
      () => parseArgs(['register-key', '--key', '/tmp/private']),
      /unknown register-key option/,
    );
  });

  it('initializes a candidate-bound invalid draft without inventing observations', () => {
    const output = resolve(temporaryDirectory, 'rollout-draft.json');
    const exitCode = runCli([
      'init', '--type', 'rollout-stage', '--output', output,
      '--release', 'extension-ship-quality-rc1',
      '--reigh-commit', 'a'.repeat(40), '--astrid-commit', 'b'.repeat(40),
      '--environment', 'production-stage-0', '--tool', 'node=20.19.4',
    ]);
    assert.equal(exitCode, 0);
    const draft = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(draft.candidate.reighCommit, 'a'.repeat(40));
    assert.equal(draft.record.outcome, '');
    assert.ok(validateExternalEvidence(draft).errors.length > 0);
    assert.equal(runCli([
      'init', '--type', 'rollout-stage', '--output', output,
      '--release', 'extension-ship-quality-rc1',
      '--reigh-commit', 'a'.repeat(40), '--astrid-commit', 'b'.repeat(40),
      '--environment', 'production-stage-0', '--tool', 'node=20.19.4',
    ]), 1);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), draft);
  });

  it('computes and verifies an Ed25519 public-key fingerprint without reading a private key', () => {
    const keyPath = resolve(temporaryDirectory, 'operator-key');
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath]);
    assert.equal(runCli(['fingerprint', '--public-key', `${keyPath}.pub`]), 0);
    assert.equal(runCli(['verify-keys']), 0);
  });
});
