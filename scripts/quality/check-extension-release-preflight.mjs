#!/usr/bin/env node

/**
 * Read-only operational preflight for the external release gates.
 *
 * This command deliberately does not create evidence, sign receipts, mutate
 * the ledger, call a production service, or change rollout state. It turns the
 * integration ledger's warnings into an explicit stop signal and gives an
 * operator the next commands from the documented evidence workflow.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ATTESTATION_TRUST_PATH,
  CHECKLIST_PATH,
  LEDGER_PATH,
  RELEASE_MANIFEST_PATH,
  validateLedger,
} from './check-extension-ship-evidence.mjs';
import {
  REQUIRED_ALERT_DRILLS,
  REQUIRED_HUMAN_TASKS,
  REQUIRED_HUMAN_PERSONAS,
  REQUIRED_OBSERVABILITY_EVENT_FAMILIES,
  REQUIRED_RECOVERY_DRILLS,
} from './lib/extension-external-evidence.mjs';

const LABEL = '[extension-release-preflight]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(moduleDir, '..', '..');

const EXTERNAL_WORKSTREAMS = Object.freeze([
  { number: 10, type: 'transcript-owner-acknowledgement', label: 'transcript owner acknowledgement' },
  { number: 19, type: 'rollout-stage', label: 'staged rollout' },
  { number: 20, type: 'production-observability', label: 'production observability' },
  { number: 21, type: 'recovery-drill', label: 'rollback/support recovery' },
  { number: 22, type: 'human-persona-session', label: 'human acceptance' },
  { number: 23, type: 'independent-review', label: 'independent review' },
]);

const RECEIPT_KIND_BY_WORKSTREAM = new Map([
  [10, 'browser'],
  [19, 'deployment'],
  [20, 'observability'],
  [21, 'recovery'],
  [22, 'human'],
  [23, 'review'],
]);

// Keep replacement tokens valid shell words so an operator can paste the
// setup lines, replace the values, and avoid accidental redirection syntax.
const PLACEHOLDER_CANDIDATE = 'REPLACE_WITH_40_CHAR_CANDIDATE';
const PLACEHOLDER_ASTRID = 'REPLACE_WITH_40_CHAR_ASTRID_PIN';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workstreamByNumber(ledger, number) {
  return ledger?.workstreams?.find((workstream) => {
    const match = typeof workstream?.id === 'string' && workstream.id.match(/^(\d+)-/);
    return Number(match?.[1]) === number;
  });
}

function missingExternalReceipt(workstream, number) {
  const requiredKind = RECEIPT_KIND_BY_WORKSTREAM.get(number);
  const receipts = Array.isArray(workstream?.receipts) ? workstream.receipts : [];
  return !receipts.some((receipt) => receipt?.kind === requiredKind);
}

function trustMissing(trust) {
  const identities = Array.isArray(trust?.identities) ? trust.identities : [];
  const personas = new Set(
    identities
      .filter((identity) => identity?.kind === 'human')
      .map((identity) => identity.persona),
  );
  const reviewers = identities.filter((identity) => identity?.kind === 'review');
  return {
    personas: REQUIRED_HUMAN_PERSONAS.filter((persona) => !personas.has(persona)),
    reviewers: Math.max(0, 2 - reviewers.length),
  };
}

function externalDetail(number, workstream, receiptMissing) {
  const status = workstream?.status ?? 'missing';
  const blocker = typeof workstream?.blocker === 'string' ? workstream.blocker : null;
  if (blocker) return `${status}: ${blocker}`;
  if (number === 19) {
    return `${status}: requires one typed rollout-stage document with two independent agreeing reads and a passing emergency-disable or route-change drill`;
  }
  if (number === 20) {
    return `${status}: requires production revision probe, dashboard, distributed rate-limit exercise, four alert drills (${REQUIRED_ALERT_DRILLS.join(', ')}), privacy audit, and event families (${REQUIRED_OBSERVABILITY_EVENT_FAMILIES.join(', ')})`;
  }
  if (number === 21) {
    return `${status}: requires typed recovery evidence for ${REQUIRED_RECOVERY_DRILLS.join(', ')}`;
  }
  if (number === 22) {
    const present = new Set(
      (workstream?.receipts ?? [])
        .filter((receipt) => receipt?.kind === 'human')
        .map((receipt) => receipt?.persona),
    );
    const missing = REQUIRED_HUMAN_PERSONAS.filter((persona) => !present.has(persona));
    const missingDetails = missing.map((persona) => `${persona} [${REQUIRED_HUMAN_TASKS[persona].join(', ')}]`);
    return `${status}: requires four separately signed sessions; missing ${missingDetails.length > 0 ? missingDetails.join('; ') : 'typed/signed session evidence'}`;
  }
  if (number === 23) {
    const slots = new Set(
      (workstream?.receipts ?? [])
        .filter((receipt) => receipt?.kind === 'review')
        .map((receipt) => receipt?.slot),
    );
    const missingSlots = ['A', 'B'].filter((slot) => !slots.has(slot));
    return `${status}: requires two independently keyed signed reviews; missing slot(s) ${missingSlots.join(', ') || 'independent signatures'}`;
  }
  return `${status}: missing required typed ${EXTERNAL_WORKSTREAMS.find((entry) => entry.number === number)?.type ?? 'external'} evidence${receiptMissing ? ' and receipt' : ''}`;
}

function initCommand({ type, output, extra = '' }, release) {
  return `npm run extension:evidence -- init --type ${type} --output ${output} --release ${release} --reigh-commit "$REIGH_CANDIDATE" --astrid-commit "$ASTRID_COMMIT" --environment "REPLACE_WITH_ENVIRONMENT_ID" --tool "node=20.19.4"${extra}`;
}

export function buildOperatorCommands({ release, astridCommit }) {
  const safeRelease = typeof release === 'string' && release.length > 0
    ? release
    : 'REPLACE_WITH_MANIFEST_RELEASE';
  const safeAstridCommit = /^[0-9a-f]{40}$/.test(astridCommit ?? '')
    ? astridCommit
    : PLACEHOLDER_ASTRID;
  return [
    '# Set these only after resolving the exact frozen pair; this preflight never invents candidate pins.',
    `export REIGH_CANDIDATE=${PLACEHOLDER_CANDIDATE}`,
    `export ASTRID_COMMIT=${safeAstridCommit}`,
    ...REQUIRED_HUMAN_PERSONAS.map((persona) => `npm run extension:evidence -- register-key --principal REPLACE_WITH_${persona.toUpperCase().replaceAll('-', '_')}_PRINCIPAL --kind human --persona ${persona} --public-key /absolute/path/to/public-key`),
    'npm run extension:evidence -- register-key --principal REPLACE_WITH_REVIEWER_A_PRINCIPAL --kind review --public-key /absolute/path/to/public-key',
    'npm run extension:evidence -- register-key --principal REPLACE_WITH_REVIEWER_B_PRINCIPAL --kind review --public-key /absolute/path/to/public-key',
    initCommand({ type: 'transcript-owner-acknowledgement', output: '/tmp/reigh-transcript-owner.json' }, safeRelease),
    initCommand({ type: 'rollout-stage', output: '/tmp/reigh-rollout-stage.json' }, safeRelease),
    initCommand({ type: 'production-observability', output: '/tmp/reigh-production-observability.json' }, safeRelease),
    ...REQUIRED_RECOVERY_DRILLS.map((drillType) => initCommand({
      type: 'recovery-drill',
      output: `/tmp/reigh-recovery-${drillType}.json`,
      extra: ` --drill-type ${drillType}`,
    }, safeRelease)),
    ...REQUIRED_HUMAN_PERSONAS.map((persona) => initCommand({
      type: 'human-persona-session',
      output: `/tmp/reigh-human-${persona}.json`,
      extra: ` --persona ${persona}`,
    }, safeRelease)),
    ...['A', 'B'].map((slot) => initCommand({
      type: 'independent-review',
      output: `/tmp/reigh-review-${slot}.json`,
      extra: ` --slot ${slot}`,
    }, safeRelease)),
    'npm run extension:evidence -- validate --artifact /tmp/REPLACE_WITH_COMPLETED_DRAFT.json',
    'npm run extension:evidence -- capture --input /tmp/REPLACE_WITH_COMPLETED_DRAFT.json --output docs/extensions/evidence/releases/REPLACE_WITH_MANIFEST_RELEASE/REPLACE_WITH_UNIQUE_EVIDENCE_PATH.json',
    'npm run extension:evidence -- receipt --artifact docs/extensions/evidence/releases/REPLACE_WITH_MANIFEST_RELEASE/REPLACE_WITH_UNIQUE_EVIDENCE_PATH.json --workstream REPLACE_WITH_WORKSTREAM_NUMBER --id REPLACE_WITH_UNIQUE_RECEIPT_ID',
    'npm run extension:evidence -- verify-keys',
    'npm run check:extension-ship-evidence -- --audit',
  ];
}

/**
 * Build a conservative, machine-readable view of the external release gates.
 * No returned `ready` value is based on browser automation or a local test.
 */
export function buildPreflight({ ledger, manifest, trust, checklistMarkdown }) {
  const validation = validateLedger({
    ledger,
    checklistMarkdown,
    releaseManifest: manifest,
    attestationTrust: trust,
    repoRoot: REPO_ROOT,
    mode: 'audit',
  });
  const blockers = [];
  const checks = [];
  const add = (id, ok, detail) => {
    checks.push({ id, status: ok ? 'pass' : 'blocked', detail });
    if (!ok) blockers.push(`${id}: ${detail}`);
  };

  add(
    'manifest-frozen',
    manifest?.status === 'frozen',
    manifest?.status === 'frozen'
      ? 'manifest is frozen'
      : `manifest status is ${manifest?.status ?? 'missing'}; freeze only after source and gate review`,
  );
  add(
    'ledger-frozen',
    ledger?.status === 'frozen',
    ledger?.status === 'frozen'
      ? 'evidence ledger is frozen'
      : `ledger status is ${ledger?.status ?? 'missing'}; evidence remains integration-only`,
  );
  add(
    'ledger-structure',
    validation.errors.length === 0,
    validation.errors.length === 0
      ? 'ledger structure and any claimed receipts validate'
      : validation.errors.join('; '),
  );

  const missingTrust = trustMissing(trust);
  add(
    'attestation-trust',
    missingTrust.personas.length === 0 && missingTrust.reviewers === 0,
    missingTrust.personas.length === 0 && missingTrust.reviewers === 0
      ? 'all human persona and independent reviewer principals are registered'
      : `missing human principals: ${missingTrust.personas.join(', ') || 'none'}; missing independent reviewers: ${missingTrust.reviewers}`,
  );

  for (const entry of EXTERNAL_WORKSTREAMS) {
    const workstream = workstreamByNumber(ledger, entry.number);
    const receiptMissing = missingExternalReceipt(workstream, entry.number);
    add(
      `workstream-${entry.number}`,
      workstream?.status === 'pass' && !receiptMissing,
      externalDetail(entry.number, workstream, receiptMissing),
    );
  }

  return {
    release: manifest?.release ?? ledger?.release ?? null,
    status: blockers.length === 0 ? 'ready-for-human-production-gates' : 'blocked',
    ready: blockers.length === 0,
    blockers,
    checks,
    operatorCommands: buildOperatorCommands({
      release: manifest?.release,
      astridCommit: manifest?.astrid?.commit,
    }),
    disclaimer: 'Read-only preflight. It does not perform human acceptance, production observation, signing, rollout, rollback, or ledger status changes.',
  };
}

export function formatReport(result) {
  const lines = [
    `${LABEL} ${result.status.toUpperCase()}`,
    `${LABEL} release: ${result.release ?? '<unknown>'}`,
    `${LABEL} ${result.disclaimer}`,
    `${LABEL} checks:`,
    ...result.checks.map((check) => `- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`),
  ];
  if (result.blockers.length > 0) {
    lines.push(`${LABEL} current blockers:`, ...result.blockers.map((blocker) => `- ${blocker}`));
  }
  lines.push(`${LABEL} operator commands (replace placeholders; no command is run by this tool):`);
  lines.push(...result.operatorCommands.map((command) => `  ${command}`));
  return `${lines.join('\n')}\n`;
}

export function runCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const unknown = argv.filter((arg) => arg !== '--json');
  if (unknown.length > 0) {
    console.error(`${LABEL} unknown option(s): ${unknown.join(', ')}`);
    return 2;
  }
  try {
    const result = buildPreflight({
      ledger: readJson(LEDGER_PATH),
      manifest: readJson(RELEASE_MANIFEST_PATH),
      trust: readJson(ATTESTATION_TRUST_PATH),
      checklistMarkdown: readFileSync(CHECKLIST_PATH, 'utf8'),
    });
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
    return result.ready ? 0 : 1;
  } catch (error) {
    console.error(`${LABEL} FAIL: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runCli();
}
