#!/usr/bin/env node

/**
 * Verify the committed copy of the immutable RC4 paired-release capture.
 *
 * The paired verifier writes its artifact-index relative to its evidence root.
 * The committed receipt keeps that same layout below paired/raw/ so this check
 * can prove the original index still describes the committed bytes, including
 * the large Playwright trace and video artifacts.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DEFAULT_RAW_ROOT = resolve(
  REPO_ROOT,
  'docs/extensions/evidence/releases/extension-ship-quality-rc4/paired/raw',
);

function fail(message) {
  throw new Error(`[rc4-paired-evidence] ${message}`);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function allFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'));
    else fail(`raw evidence contains non-file entry: ${relative(root, path)}`);
  }
  return files.sort();
}

function verify(rawRoot) {
  const indexPath = join(rawRoot, 'artifact-index.json');
  if (!existsSync(indexPath)) fail(`missing ${indexPath}`);
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (index.schemaVersion !== 1 || !Array.isArray(index.files)) {
    fail('artifact-index.json must have schemaVersion=1 and a files array');
  }
  if (index.files.length !== 34) {
    fail(`expected 34 indexed artifacts plus the index (35 total), found ${index.files.length}`);
  }

  const expected = new Set(['artifact-index.json']);
  for (const [number, artifact] of index.files.entries()) {
    const prefix = `files[${number}]`;
    if (!artifact || typeof artifact.path !== 'string' || !artifact.path) fail(`${prefix}.path is invalid`);
    if (isAbsolute(artifact.path) || artifact.path.includes('\\')) fail(`${prefix}.path is not a portable relative path`);
    const path = resolve(rawRoot, artifact.path);
    if (relative(rawRoot, path).startsWith('..')) fail(`${prefix}.path escapes raw evidence: ${artifact.path}`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) fail(`${prefix}.bytes is invalid`);
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) fail(`${prefix}.sha256 is invalid`);
    if (expected.has(artifact.path)) fail(`duplicate artifact path: ${artifact.path}`);
    expected.add(artifact.path);
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing indexed artifact: ${artifact.path}`);
    const { size } = lstatSync(path);
    if (size !== artifact.bytes) fail(`${artifact.path}: expected ${artifact.bytes} bytes, got ${size}`);
    const actual = sha256File(path);
    if (actual !== artifact.sha256) fail(`${artifact.path}: expected ${artifact.sha256}, got ${actual}`);
  }

  const actual = new Set(allFiles(rawRoot));
  if (actual.size !== expected.size) fail(`expected ${expected.size} raw files, found ${actual.size}`);
  for (const path of expected) if (!actual.has(path)) fail(`expected raw file is absent: ${path}`);
  for (const path of actual) if (!expected.has(path)) fail(`unexpected raw file: ${path}`);

  return { count: expected.size, bytes: index.files.reduce((sum, artifact) => sum + artifact.bytes, 0) };
}

const rawRoot = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_RAW_ROOT;
try {
  const result = verify(rawRoot);
  console.log(`[rc4-paired-evidence] PASS: ${result.count} files, ${result.bytes} indexed artifact bytes`);
} catch (error) {
  console.error(`[rc4-paired-evidence] FAIL: ${error.message}`);
  process.exitCode = 1;
}
