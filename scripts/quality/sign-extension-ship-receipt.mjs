#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ATTESTATION_NAMESPACE,
  ATTESTATION_TRUST_PATH,
  LEDGER_PATH,
  canonicalReceiptPayload,
  validateAttestationTrust,
  verifyReceiptAttestation,
} from './check-extension-ship-evidence.mjs';

const LABEL = '[extension-ship-attestation]';

function usage() {
  return `Usage:
  node scripts/quality/sign-extension-ship-receipt.mjs \\
    --workstream <workstream-id> --receipt <receipt-id> \\
    --principal <trusted-principal> --key <private-key-path>

The command signs one existing unsigned human/review receipt and atomically
updates config/releases/extension-ship-evidence.json. Existing attestations are
never overwritten.`;
}

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--workstream', '--receipt', '--principal', '--key'].includes(arg)) {
      throw new Error(`unknown option: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    const name = arg.slice(2);
    if (options[name]) throw new Error(`${arg} may only be provided once`);
    options[name] = value;
    index += 1;
  }
  for (const name of ['workstream', 'receipt', 'principal', 'key']) {
    if (!options[name]) throw new Error(`--${name} is required`);
  }
  return { help: false, ...options };
}

export function signLedgerReceipt({
  ledger,
  trust,
  workstreamId,
  receiptId,
  principal,
  privateKeyPath,
}) {
  const trustResult = validateAttestationTrust({
    trust,
    release: ledger.release,
    releaseMode: false,
  });
  if (trustResult.errors.length > 0) {
    throw new Error(`invalid attestation trust:\n- ${trustResult.errors.join('\n- ')}`);
  }
  const identity = trustResult.identityByPrincipal.get(principal);
  if (!identity) throw new Error(`principal is not present in the trust configuration: ${principal}`);

  const workstream = ledger.workstreams?.find((item) => item.id === workstreamId);
  if (!workstream) throw new Error(`workstream not found: ${workstreamId}`);
  const receipt = workstream.receipts?.find((item) => item.id === receiptId);
  if (!receipt) throw new Error(`receipt not found in ${workstreamId}: ${receiptId}`);
  if (receipt.kind !== 'human' && receipt.kind !== 'review') {
    throw new Error(`receipt kind must be human or review; found ${receipt.kind}`);
  }
  if (receipt.attestation) throw new Error('receipt already has an attestation; refusing to overwrite it');
  if (identity.kind !== receipt.kind) {
    throw new Error(`principal ${principal} is not authorized for ${receipt.kind} evidence`);
  }
  if (receipt.kind === 'human' && identity.persona !== receipt.persona) {
    throw new Error(`principal ${principal} is not authorized for persona ${receipt.persona}`);
  }
  if (!existsSync(privateKeyPath) || !statSync(privateKeyPath).isFile()) {
    throw new Error(`private key is not a regular file: ${privateKeyPath}`);
  }

  receipt.attestation = {
    namespace: ATTESTATION_NAMESPACE,
    principal,
    signature: '',
  };
  const directory = mkdtempSync(resolve(tmpdir(), 'reigh-extension-signing-'));
  const payloadPath = resolve(directory, 'receipt.json');
  try {
    const payload = canonicalReceiptPayload({
      release: ledger.release,
      candidate: ledger.candidate,
      workstream,
      receipt,
    });
    writeFileSync(payloadPath, payload, { encoding: 'utf8', mode: 0o600 });
    execFileSync(
      'ssh-keygen',
      ['-Y', 'sign', '-f', privateKeyPath, '-n', ATTESTATION_NAMESPACE, payloadPath],
      { stdio: ['inherit', 'inherit', 'inherit'] },
    );
    receipt.attestation.signature = readFileSync(`${payloadPath}.sig`, 'utf8');
    const verificationError = verifyReceiptAttestation({
      attestation: receipt.attestation,
      identity,
      payload,
    });
    if (verificationError) throw new Error(verificationError);
    return ledger;
  } catch (error) {
    delete receipt.attestation;
    throw error;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function runCli(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    const trust = JSON.parse(readFileSync(ATTESTATION_TRUST_PATH, 'utf8'));
    signLedgerReceipt({
      ledger,
      trust,
      workstreamId: options.workstream,
      receiptId: options.receipt,
      principal: options.principal,
      privateKeyPath: resolve(options.key),
    });
    const temporaryLedgerPath = resolve(
      dirname(LEDGER_PATH),
      `.extension-ship-evidence.${process.pid}.tmp`,
    );
    try {
      writeFileSync(temporaryLedgerPath, `${JSON.stringify(ledger, null, 2)}\n`, {
        encoding: 'utf8',
        mode: statSync(LEDGER_PATH).mode,
      });
      renameSync(temporaryLedgerPath, LEDGER_PATH);
    } finally {
      rmSync(temporaryLedgerPath, { force: true });
    }
    console.log(`${LABEL} signed ${options.workstream}/${options.receipt} as ${options.principal}`);
    return 0;
  } catch (error) {
    console.error(`${LABEL} failed: ${error.message}`);
    return 1;
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = runCli();
