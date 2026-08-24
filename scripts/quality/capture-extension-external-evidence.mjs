#!/usr/bin/env node

import {
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ATTESTATION_TRUST_PATH,
  CHECKLIST_PATH,
  LEDGER_PATH,
  REPO_ROOT,
  ed25519KeyFingerprint,
  parseChecklistWorkstreams,
  validateAttestationTrust,
} from './check-extension-ship-evidence.mjs';
import {
  EXTERNAL_EVIDENCE_TYPES,
  EXTERNAL_EVIDENCE_TYPE_BY_WORKSTREAM,
  REQUIRED_ALERT_DRILLS,
  REQUIRED_HUMAN_TASKS,
  REQUIRED_HUMAN_PERSONAS,
  REQUIRED_OBSERVABILITY_EVENT_FAMILIES,
  REQUIRED_RECOVERY_DRILLS,
  REQUIRED_REVIEW_SCOPE,
  sha256File,
  validateExternalEvidence,
} from './lib/extension-external-evidence.mjs';

const LABEL = '[extension-external-evidence]';
const moduleDir = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(
  moduleDir,
  '../../config/releases/extension-external-evidence/v1/templates',
);

const KIND_BY_WORKSTREAM = new Map([
  [10, 'browser'],
  [19, 'deployment'],
  [20, 'observability'],
  [21, 'recovery'],
  [22, 'human'],
  [23, 'review'],
]);

function usage() {
  return `Usage:
  node scripts/quality/capture-extension-external-evidence.mjs init
    --type <type> --output <draft.json> --release <release>
    --reigh-commit <sha> --astrid-commit <sha> --environment <id>
    --tool <name=version> [--tool <name=version> ...]
    [--persona <persona>] [--slot <A|B>] [--drill-type <type>]

  node scripts/quality/capture-extension-external-evidence.mjs capture
    --input <completed-draft.json> --output <repository-relative.json>

  node scripts/quality/capture-extension-external-evidence.mjs validate
    --artifact <evidence.json>

  node scripts/quality/capture-extension-external-evidence.mjs hash --artifact <file>

  node scripts/quality/capture-extension-external-evidence.mjs receipt
    --artifact <repository-relative.json> --workstream <number|id> --id <receipt-id>
    [--append-ledger]

  node scripts/quality/capture-extension-external-evidence.mjs fingerprint
    --public-key <public-key-file>

  node scripts/quality/capture-extension-external-evidence.mjs register-key
    --principal <id> --kind <human|review> --public-key <public-key-file>
    [--persona <persona>]

  node scripts/quality/capture-extension-external-evidence.mjs verify-keys

No command accepts or reads a private key. init creates an invalid draft;
capture and receipt proceed only after strict validation. receipt never changes
a workstream status and emits an unsigned receipt.`;
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const [command, ...rest] = argv;
  const allowedByCommand = new Map([
    ['init', new Set(['type', 'output', 'release', 'reigh-commit', 'astrid-commit', 'environment', 'tool', 'persona', 'slot', 'drill-type'])],
    ['capture', new Set(['input', 'output'])],
    ['validate', new Set(['artifact'])],
    ['hash', new Set(['artifact'])],
    ['receipt', new Set(['artifact', 'workstream', 'id', 'append-ledger'])],
    ['fingerprint', new Set(['public-key'])],
    ['register-key', new Set(['principal', 'kind', 'public-key', 'persona'])],
    ['verify-keys', new Set()],
  ]);
  const allowed = allowedByCommand.get(command);
  if (!allowed) throw new Error(`unknown command: ${command}`);
  const options = { command, tool: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown ${command} option: ${arg}`);
    if (name === 'append-ledger') {
      if (options[name]) throw new Error(`${arg} may only be provided once`);
      options[name] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (name === 'tool') options.tool.push(value);
    else {
      if (options[name]) throw new Error(`${arg} may only be provided once`);
      options[name] = value;
    }
    index += 1;
  }
  return options;
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!options[name]) throw new Error(`--${name} is required for ${options.command}`);
  }
}

function atomicWriteJson(path, value, mode = 0o644) {
  const temporaryPath = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function writeNewJson(path, value, mode = 0o644) {
  const temporaryPath = resolve(dirname(path), `.${basename(path)}.${process.pid}.new`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode,
    });
    linkSync(temporaryPath, path);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`refusing to overwrite existing file: ${path}`);
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read JSON ${path}: ${error.message}`);
  }
}

function assertValid(document, expected = {}) {
  const result = validateExternalEvidence(document, expected);
  if (result.errors.length > 0) {
    throw new Error(`external evidence is invalid:\n- ${result.errors.join('\n- ')}`);
  }
}

function parseTools(entries) {
  const tools = {};
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator < 1 || separator === entry.length - 1) {
      throw new Error(`--tool must be name=version; found ${entry}`);
    }
    const name = entry.slice(0, separator);
    if (Object.hasOwn(tools, name)) throw new Error(`duplicate --tool name: ${name}`);
    tools[name] = entry.slice(separator + 1);
  }
  if (Object.keys(tools).length === 0) throw new Error('at least one --tool is required');
  return tools;
}

function safeOutputPath(value, { mustBeInRepo = false } = {}) {
  const output = resolve(value);
  if (mustBeInRepo) {
    const rel = relative(REPO_ROOT, output);
    if (!rel || rel.startsWith('..')) throw new Error('output must be a file under the repository');
    const realRoot = realpathSync(REPO_ROOT);
    const realParent = realpathSync(dirname(output));
    const realParentRelative = relative(realRoot, realParent);
    if (realParentRelative.startsWith('..')) {
      throw new Error('output parent resolves outside the repository');
    }
  }
  return output;
}

function normalizedPublicKey(path) {
  const parts = readFileSync(resolve(path), 'utf8').trim().split(/\s+/);
  if (parts.length < 2) throw new Error('public key file is not an OpenSSH public key');
  const key = `${parts[0]} ${parts[1]}`;
  const fingerprint = ed25519KeyFingerprint(key);
  if (!fingerprint) throw new Error('public key must be a valid ssh-ed25519 public key');
  return { publicKey: key, fingerprint: `SHA256:${fingerprint}` };
}

function init(options) {
  requireOptions(options, ['type', 'output', 'release', 'reigh-commit', 'astrid-commit', 'environment']);
  if (!EXTERNAL_EVIDENCE_TYPES.includes(options.type)) {
    throw new Error(`--type must be one of ${EXTERNAL_EVIDENCE_TYPES.join(', ')}`);
  }
  if (options.type === 'human-persona-session' && !options.persona) {
    throw new Error('--persona is required for human-persona-session');
  }
  if (options.type !== 'human-persona-session' && options.persona) {
    throw new Error('--persona is only valid for human-persona-session');
  }
  if (options.type === 'independent-review' && !options.slot) {
    throw new Error('--slot is required for independent-review');
  }
  if (options.type !== 'independent-review' && options.slot) {
    throw new Error('--slot is only valid for independent-review');
  }
  if (options.type === 'recovery-drill') {
    if (!REQUIRED_RECOVERY_DRILLS.includes(options['drill-type'])) {
      throw new Error(`--drill-type must be one of ${REQUIRED_RECOVERY_DRILLS.join(', ')}`);
    }
  } else if (options['drill-type']) {
    throw new Error('--drill-type is only valid for recovery-drill');
  }
  const output = safeOutputPath(options.output);
  const document = readJson(resolve(TEMPLATE_ROOT, `${options.type}.json`));
  document.release = options.release;
  document.candidate = {
    reighCommit: options['reigh-commit'],
    astridCommit: options['astrid-commit'],
  };
  document.environment = { id: options.environment, toolVersions: parseTools(options.tool) };
  if (options.persona) {
    if (!REQUIRED_HUMAN_PERSONAS.includes(options.persona)) {
      throw new Error(`--persona must be one of ${REQUIRED_HUMAN_PERSONAS.join(', ')}`);
    }
    document.record.persona = options.persona;
    document.record.tasks = REQUIRED_HUMAN_TASKS[options.persona].map((id) => ({
      id,
      outcome: '',
      durationSeconds: null,
      observations: [],
      evidenceRefs: [],
    }));
  }
  if (options.slot) {
    if (!['A', 'B'].includes(options.slot)) throw new Error('--slot must be A or B');
    document.record.slot = options.slot;
    document.record.scope = [...REQUIRED_REVIEW_SCOPE[options.slot]];
  }
  if (options['drill-type']) document.record.drillType = options['drill-type'];
  if (options.type === 'production-observability') {
    document.record.syntheticProbe.eventFamilies = [...REQUIRED_OBSERVABILITY_EVENT_FAMILIES];
    document.record.alertDrills = REQUIRED_ALERT_DRILLS.map((kind) => ({
      kind,
      firedAt: '',
      acknowledgedBy: '',
      acknowledgedAt: '',
      runbookLinked: false,
      outcome: '',
      evidence: { path: '', sha256: '' },
    }));
  }
  writeNewJson(output, document);
  return `initialized invalid draft ${output}`;
}

function capture(options) {
  requireOptions(options, ['input', 'output']);
  const input = resolve(options.input);
  const requestedOutput = resolve(options.output);
  const document = readJson(input);
  assertValid(document);
  const outputRelative = relative(REPO_ROOT, requestedOutput);
  const requiredRoot = `docs/extensions/evidence/releases/${document.release}/`;
  if (!outputRelative.startsWith(requiredRoot) || outputRelative.length <= requiredRoot.length) {
    throw new Error(`captured evidence output must be under ${requiredRoot}`);
  }
  mkdirSync(dirname(requestedOutput), { recursive: true });
  const output = safeOutputPath(requestedOutput, { mustBeInRepo: true });
  writeNewJson(output, document, 0o644);
  return `captured ${relative(REPO_ROOT, output)} sha256=${sha256File(output)}`;
}

function validate(options) {
  requireOptions(options, ['artifact']);
  const artifact = resolve(options.artifact);
  assertValid(readJson(artifact));
  return `valid ${artifact} sha256=${sha256File(artifact)}`;
}

function hash(options) {
  requireOptions(options, ['artifact']);
  const artifact = resolve(options.artifact);
  return `${sha256File(artifact)}  ${artifact}`;
}

function resolveWorkstream(ledger, selector) {
  const checklist = parseChecklistWorkstreams(readFileSync(CHECKLIST_PATH, 'utf8'));
  const number = /^\d+$/.test(selector)
    ? Number.parseInt(selector, 10)
    : checklist.find((entry) => entry.id === selector)?.number;
  const expected = checklist.find((entry) => entry.number === number);
  if (!expected || !EXTERNAL_EVIDENCE_TYPE_BY_WORKSTREAM.has(number)) {
    throw new Error('--workstream must select one of 10, 19, 20, 21, 22, or 23');
  }
  const workstream = ledger.workstreams?.find((entry) => entry.id === expected.id);
  if (!workstream) throw new Error(`ledger workstream not found: ${expected.id}`);
  return { number, workstream };
}

function receipt(options) {
  requireOptions(options, ['artifact', 'workstream', 'id']);
  const ledger = readJson(LEDGER_PATH);
  const { number, workstream } = resolveWorkstream(ledger, options.workstream);
  const artifactPath = resolve(options.artifact);
  const artifactRelative = relative(REPO_ROOT, artifactPath);
  if (!artifactRelative || artifactRelative.startsWith('..')) {
    throw new Error('--artifact must be under the repository');
  }
  const document = readJson(artifactPath);
  assertValid(document, {
    evidenceType: EXTERNAL_EVIDENCE_TYPE_BY_WORKSTREAM.get(number),
    release: ledger.release,
    reighCommit: ledger.candidate?.reighCommit,
    astridCommit: ledger.candidate?.astridCommit,
  });
  const manual = number === 22 || number === 23;
  const generated = {
    id: options.id,
    kind: KIND_BY_WORKSTREAM.get(number),
    repository: 'reigh',
    commit: document.candidate.reighCommit,
    capturedAt: document.capturedAt,
    action: `Captured and validated ${document.evidenceType} evidence`,
    environment: document.environment,
    artifact: { path: artifactRelative, sha256: sha256File(artifactPath) },
    ...(manual ? { decision: 'approve' } : { exitCode: 0 }),
    ...(number === 22 ? { persona: document.record.persona } : {}),
    ...(number === 23 ? { reviewerId: document.record.reviewer.principal } : {}),
  };
  if (!options['append-ledger']) return JSON.stringify(generated, null, 2);
  const duplicate = ledger.workstreams
    .flatMap((entry) => entry.receipts ?? [])
    .some((entry) => entry.id === generated.id);
  if (duplicate) throw new Error(`receipt id already exists: ${generated.id}`);
  workstream.receipts ??= [];
  workstream.receipts.push(generated);
  atomicWriteJson(LEDGER_PATH, ledger, statSync(LEDGER_PATH).mode);
  return `appended unsigned receipt ${workstream.id}/${generated.id}; status remains ${workstream.status}`;
}

function fingerprint(options) {
  requireOptions(options, ['public-key']);
  return normalizedPublicKey(options['public-key']).fingerprint;
}

function registerKey(options) {
  requireOptions(options, ['principal', 'kind', 'public-key']);
  if (!['human', 'review'].includes(options.kind)) throw new Error('--kind must be human or review');
  if (options.kind === 'human') {
    if (!REQUIRED_HUMAN_PERSONAS.includes(options.persona)) {
      throw new Error(`human --persona must be one of ${REQUIRED_HUMAN_PERSONAS.join(', ')}`);
    }
  } else if (options.persona) {
    throw new Error('--persona is only valid for a human key');
  }
  const trust = readJson(ATTESTATION_TRUST_PATH);
  if (trust.identities?.some((entry) => entry.principal === options.principal)) {
    throw new Error(`principal already registered: ${options.principal}`);
  }
  const { publicKey, fingerprint: keyFingerprint } = normalizedPublicKey(options['public-key']);
  if (trust.identities?.some((entry) => entry.fingerprint === keyFingerprint)) {
    throw new Error(`public key already registered: ${keyFingerprint}`);
  }
  const identity = {
    principal: options.principal,
    kind: options.kind,
    ...(options.kind === 'human' ? { persona: options.persona } : {}),
    publicKey,
    fingerprint: keyFingerprint,
  };
  trust.identities ??= [];
  trust.identities.push(identity);
  const result = validateAttestationTrust({ trust, release: trust.release, releaseMode: false });
  if (result.errors.length > 0) throw new Error(`updated trust is invalid:\n- ${result.errors.join('\n- ')}`);
  atomicWriteJson(ATTESTATION_TRUST_PATH, trust, statSync(ATTESTATION_TRUST_PATH).mode);
  return `registered ${options.principal} ${keyFingerprint}`;
}

function verifyKeys() {
  const trust = readJson(ATTESTATION_TRUST_PATH);
  const result = validateAttestationTrust({ trust, release: trust.release, releaseMode: false });
  if (result.errors.length > 0) throw new Error(`attestation trust is invalid:\n- ${result.errors.join('\n- ')}`);
  const fingerprints = trust.identities.map((identity) => `${identity.principal} ${identity.fingerprint}`);
  return fingerprints.length > 0 ? fingerprints.join('\n') : 'valid trust configuration; no keys registered';
}

export function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    const handlers = { init, capture, validate, hash, receipt, fingerprint, 'register-key': registerKey, 'verify-keys': verifyKeys };
    console.log(`${LABEL} ${handlers[options.command](options)}`);
    return 0;
  } catch (error) {
    console.error(`${LABEL} failed: ${error.message}`);
    return 1;
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = runCli();
