#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repoRoot = resolve(import.meta.dirname, '..');
const inventoryPath = resolve(repoRoot, 'docs/cutover-inventory.md');

function coveredFiles(markdown) {
  const files = new Set();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5 || cells[4] !== 'bridge-client') continue;
    const path = cells[0].replaceAll('`', '').trim();
    if (path) files.add(resolve(repoRoot, 'src', path));
  }
  return [...files].sort();
}

function location(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName.slice(repoRoot.length + 1)}:${line + 1}:${character + 1}`;
}

function scanFile(path) {
  const source = readFileSync(path, 'utf8');
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const findings = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === '@supabase/supabase-js'
    ) {
      findings.push(`${location(sourceFile, node)} forbidden @supabase/supabase-js dependency`);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const isArrayFrom = method === 'from' && ts.isIdentifier(receiver) && receiver.text === 'Array';
      if (!isArrayFrom && (method === 'from' || method === 'rpc' || method === 'channel')) {
        findings.push(`${location(sourceFile, node)} forbidden .${method}(...) call`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

const inventory = readFileSync(inventoryPath, 'utf8');
const files = coveredFiles(inventory);
if (files.length === 0) {
  console.error('[c5-grep-gates] FAIL: inventory produced no bridge-client files');
  process.exit(1);
}

const present = files.filter(existsSync);
const removed = files.filter((path) => !existsSync(path));
const findings = present.flatMap(scanFile);

console.log(`[c5-grep-gates] inventory: ${files.length} bridge-client files`);
console.log(`[c5-grep-gates] scanned: ${present.length}; removed since inventory: ${removed.length}`);
for (const path of removed) {
  console.log(`[c5-grep-gates] removed: ${path.slice(repoRoot.length + 1)}`);
}

if (findings.length > 0) {
  console.error(`[c5-grep-gates] FAIL: ${findings.length} forbidden bridge-client references`);
  for (const finding of findings) console.error(finding);
  process.exit(1);
}

console.log('[c5-grep-gates] PASS: no Supabase SDK imports or .from/.rpc/.channel calls in bridge-client modules');

