import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import {
  buildLocalRcPreflight,
  checkTagState,
  computeVerifierReadiness,
  DOCUMENTED_MIN_FREE_BYTES,
  REPO_ROOT,
} from './check-extension-local-rc-preflight.mjs';
import {
  ATTESTATION_TRUST_PATH,
  CHECKLIST_PATH,
  LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
} from './check-extension-ship-evidence.mjs';

const manifest = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));
const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const trust = JSON.parse(readFileSync(ATTESTATION_TRUST_PATH, 'utf8'));
const checklistMarkdown = readFileSync(CHECKLIST_PATH, 'utf8');

describe('local RC readiness preflight', () => {
  it('emits parseable JSON and exits non-zero without an explicit Astrid checkout', () => {
    const result = spawnSync(
      'npm',
      ['--silent', 'run', 'check:extension-local-rc-preflight:json'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ASTRID_CHECKOUT: '' },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.error, undefined);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.ready, false);
    assert.equal(report.status, 'blocked');
    assert.ok(report.local.checks.some((check) => check.id === 'disk-floor'));
    assert.ok(report.local.checks.some((check) => check.id === 'astrid-branch-commit' && check.status === 'blocked'));
    assert.ok(Array.isArray(report.blockers.external));
    assert.ok(Array.isArray(report.blockers.human));
  });

  it('keeps machine-local, external, human, and phase blockers separate', () => {
    const report = buildLocalRcPreflight({
      manifest,
      ledger,
      trust: { ...trust, identities: [] },
      checklistMarkdown,
      repoRoot: REPO_ROOT,
      env: { ASTRID_CHECKOUT: '' },
      dependencies: {
        statfs: () => ({ bavail: DOCUMENTED_MIN_FREE_BYTES, bsize: 1n }),
        nativeAttest: () => ({ tools: {
          ffmpeg: { version: '7.1.1' },
          ffprobe: { version: '7.1.1' },
          tesseract: { version: '5.5.1' },
          imageMagick: { version: '7.1.2-18' },
        } }),
        pathValue: process.env.PATH,
      },
    });

    assert.equal(report.phase, 'integration');
    assert.ok(report.local.blockers.some((blocker) => blocker.startsWith('reigh-branch-commit:')));
    assert.ok(report.blockers.external.some((blocker) => blocker.startsWith('workstream-19:')));
    assert.ok(report.blockers.human.some((blocker) => blocker.startsWith('workstream-22:')));
    assert.ok(report.phaseBlockers.some((blocker) => blocker.startsWith('manifest-frozen:')));
    assert.ok(!report.blockers.external.some((blocker) => /workstream-(22|23)/.test(blocker)));
  });

  it('never claims verifier readiness during integration even when every local check passes', () => {
    const readiness = computeVerifierReadiness({
      localInfrastructureReady: true,
      phase: 'integration',
      phaseBlockers: [],
      evidenceReady: true,
    });
    assert.equal(readiness.localInfrastructureReady, true);
    assert.equal(readiness.frozenPhaseReady, false);
    assert.equal(readiness.readyForVerifier, false);
    assert.equal(readiness.status, 'local-infrastructure-ready');
  });

  it('fails closed when the documented 11 GiB disk floor is unavailable', () => {
    const report = buildLocalRcPreflight({
      manifest,
      ledger,
      trust,
      checklistMarkdown,
      repoRoot: REPO_ROOT,
      env: { ASTRID_CHECKOUT: '' },
      dependencies: { statfs: () => ({ bavail: 10n, bsize: 1n }) },
    });
    const disk = report.local.checks.find((check) => check.id === 'disk-floor');
    assert.deepEqual(disk.status, 'blocked');
    assert.match(disk.detail, /11 GiB/);
  });

  it('resolves the annotated tag to the frozen ledger candidate', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'reigh-local-rc-tag-'));
    try {
      execFileSync('git', ['init', '-q', fixture]);
      writeFileSync(join(fixture, 'fixture.txt'), 'fixture\n');
      execFileSync('git', ['-C', fixture, 'add', 'fixture.txt']);
      execFileSync('git', ['-C', fixture, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
      const candidate = execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      execFileSync('git', ['-C', fixture, 'tag', '-a', 'rc-test', '-m', 'rc-test', candidate]);
      const detail = checkTagState(
        { ...manifest, status: 'frozen', reigh: { ...manifest.reigh, releaseTag: 'rc-test' } },
        { candidate: { reighCommit: candidate } },
        fixture,
      );
      assert.match(detail, new RegExp(candidate));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
