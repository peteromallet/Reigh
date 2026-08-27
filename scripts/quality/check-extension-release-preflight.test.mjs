import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  CHECKLIST_PATH,
  RELEASE_MANIFEST_PATH,
} from './check-extension-ship-evidence.mjs';
import {
  buildOperatorCommands,
  buildPreflight,
  formatReport,
} from './check-extension-release-preflight.mjs';

const checklistMarkdown = readFileSync(CHECKLIST_PATH, 'utf8');
const manifest = JSON.parse(readFileSync(RELEASE_MANIFEST_PATH, 'utf8'));

function fixtureLedger(overrides = {}) {
  return {
    schemaVersion: 1,
    release: manifest.release,
    status: 'integration',
    candidate: { reighCommit: null, astridCommit: manifest.astrid.commit },
    workstreams: Array.from({ length: 23 }, (_, index) => ({
      id: `${index + 1}-fixture`,
      title: `Fixture ${index + 1}`,
      status: 'in_progress',
      receipts: [],
    })),
    ...overrides,
  };
}

describe('extension release operational preflight', () => {
  it('fails closed on the checked-in integration state and names human/production blockers', () => {
    const result = buildPreflight({
      ledger: JSON.parse(readFileSync(new URL('../../config/releases/extension-ship-evidence.json', import.meta.url), 'utf8')),
      manifest,
      trust: { schemaVersion: 1, release: manifest.release, namespace: 'reigh-extension-ship-evidence-v1', identities: [] },
      checklistMarkdown,
    });

    assert.equal(result.ready, false);
    assert.match(result.status, /blocked/);
    assert.ok(result.blockers.some((entry) => entry.includes('manifest-frozen')));
    assert.ok(result.blockers.some((entry) => entry.includes('workstream-19')));
    assert.ok(result.blockers.some((entry) => entry.includes('workstream-20')));
    assert.ok(result.blockers.some((entry) => entry.includes('workstream-22')));
    assert.ok(result.blockers.some((entry) => entry.includes('workstream-23')));
    assert.match(result.disclaimer, /does not perform human acceptance/);
  });

  it('reports missing typed receipts even when an operational row is marked pass', () => {
    const workstreams = Array.from({ length: 23 }, (_, index) => ({
      id: `${index + 1}-${['clean-integration-branch', 'completely-green-merged-repository', 'production-like-end-to-end-suite', 'persistence-and-migration-durability', 'real-rendering-and-export-verification', 'large-lane-virtualization', 'deterministic-local-test-mode', 'astrid-bridge-hardening', 'host-owned-provenance-contract', 'transcript-round-trip-policy', 'extension-compatibility-matrix', 'accessibility-gates', 'browser-and-device-matrix', 'performance-and-resource-budgets', 'visual-regression-suite', 'failure-and-recovery-testing', 'extension-security-boundary', 'migration-and-rollback-policy', 'staged-rollout', 'production-observability', 'rollback-and-support-runbooks', 'human-acceptance-testing', 'frozen-release-candidate'][index]}`,
      title: checklistMarkdown.match(new RegExp(`### ${index + 1}\\. ([^\\n]+)`))?.[1] ?? `Fixture ${index + 1}`,
      status: [19, 20, 22, 23].includes(index + 1) ? 'pass' : 'in_progress',
      receipts: [],
    }));
    const result = buildPreflight({
      ledger: fixtureLedger({ status: 'frozen', workstreams }),
      manifest: { ...manifest, status: 'frozen' },
      trust: { schemaVersion: 1, release: manifest.release, namespace: 'reigh-extension-ship-evidence-v1', identities: [] },
      checklistMarkdown,
    });

    assert.equal(result.ready, false);
    for (const number of [19, 20, 22, 23]) {
      assert.ok(result.blockers.some((entry) => entry.includes(`workstream-${number}`)));
    }
  });

  it('prints commands with explicit candidate placeholders and no claim of completed gates', () => {
    const commands = buildOperatorCommands({ release: 'extension-ship-quality-rc45' });
    assert.ok(commands.some((command) => command === 'export REIGH_CANDIDATE=REPLACE_WITH_40_CHAR_CANDIDATE'));
    assert.ok(commands.some((command) => command.includes('human-persona-session')));
    assert.ok(commands.some((command) => command.includes('production-observability')));
    assert.ok(commands.some((command) => command === 'export ASTRID_COMMIT=REPLACE_WITH_40_CHAR_ASTRID_PIN'));
    const report = formatReport({
      status: 'blocked',
      release: 'extension-ship-quality-rc45',
      disclaimer: 'Read-only preflight. It does not perform human acceptance.',
      checks: [],
      blockers: ['workstream-22: blocked'],
      operatorCommands: commands,
    });
    assert.match(report, /replace placeholders/);
    assert.match(report, /does not perform human acceptance/);
  });
});
