#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import ts from 'typescript';

const DEFAULT_REPO_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_SURFACE_ROOTS = [
  'src/app/providers/AppProviders.tsx',
  'src/integrations/astrid/AstridCapabilityBootstrap.tsx',
  'src/shared/providers/RealtimeProvider.tsx',
];
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export function coveredFiles(markdown, repoRoot) {
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

function inventoryDispositions(markdown, repoRoot) {
  const dispositions = new Map();
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const path = cells[0].replaceAll('`', '').trim();
    if (path && ['bridge-client', 'defer', 'cut'].includes(cells[4])) {
      dispositions.set(resolve(repoRoot, 'src', path), cells[4]);
    }
  }
  return dispositions;
}

function parseSource(path) {
  const source = readFileSync(path, 'utf8');
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

function isRuntimeImport(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (
      !clause.name
      && clause.namedBindings
      && ts.isNamedImports(clause.namedBindings)
      && clause.namedBindings.elements.every((element) => element.isTypeOnly)
    ) return false;
    return true;
  }
  return !node.isTypeOnly;
}

function resolveSourceImport(fromPath, specifier, repoRoot) {
  let candidate;
  if (specifier.startsWith('@/')) candidate = resolve(repoRoot, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) candidate = resolve(dirname(fromPath), specifier);
  else return null;
  const candidates = extname(candidate) ? [candidate] : SOURCE_SUFFIXES.map((suffix) => candidate + suffix);
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

function staticDependencies(path, repoRoot) {
  const sourceFile = parseSource(path);
  const dependencies = [];
  sourceFile.statements.forEach((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && isRuntimeImport(node)
    ) {
      const dependency = resolveSourceImport(path, node.moduleSpecifier.text, repoRoot);
      if (dependency) dependencies.push(dependency);
    }
  });
  return dependencies;
}

export function reachableFiles(roots, repoRoot, dispositions = new Map()) {
  const reached = new Set();
  const predecessor = new Map();
  const queue = roots.filter(existsSync);
  queue.forEach((root) => predecessor.set(root, null));
  while (queue.length > 0) {
    const path = queue.shift();
    if (reached.has(path)) continue;
    reached.add(path);
    for (const dependency of staticDependencies(path, repoRoot)) {
      // The inventory is the reviewed cutover boundary. Deferred/cut modules
      // remain outside bridge mode, so do not enter their implementation
      // graph. Dynamic imports are already excluded above.
      if (dispositions.get(dependency) === 'defer' || dispositions.get(dependency) === 'cut') continue;
      if (!predecessor.has(dependency)) predecessor.set(dependency, path);
      if (!reached.has(dependency)) queue.push(dependency);
    }
  }
  return { files: [...reached].sort(), predecessor };
}

function location(sourceFile, node, repoRoot) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName.slice(repoRoot.length + 1)}:${line + 1}:${character + 1}`;
}

function scanFile(path, repoRoot) {
  const sourceFile = parseSource(path);
  const findings = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
      && (
        node.moduleSpecifier.text === '@supabase/supabase-js'
      )
    ) {
      findings.push(`${location(sourceFile, node, repoRoot)} forbidden Supabase runtime dependency`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      const isArrayFrom = method === 'from'
        && ts.isIdentifier(receiver)
        && /^(?:Array|Uint(?:8|16|32)Array|Int(?:8|16|32)Array|Float(?:32|64)Array|BigInt64Array|BigUint64Array)$/.test(receiver.text);
      if (!isArrayFrom && (method === 'from' || method === 'rpc' || method === 'channel')) {
        findings.push(`${location(sourceFile, node, repoRoot)} forbidden .${method}(...) call`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function importPath(path, predecessor, repoRoot) {
  const chain = [];
  let current = path;
  while (current) {
    chain.push(current.slice(repoRoot.length + 1));
    current = predecessor.get(current) ?? null;
  }
  return chain.reverse().join(' -> ');
}

export function runGate(options = {}) {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const inventoryPath = options.inventoryPath ?? resolve(repoRoot, 'docs/cutover-inventory.md');
  const surfaceRoots = options.surfaceRoots ?? DEFAULT_SURFACE_ROOTS.map((path) => resolve(repoRoot, path));
  const inventory = readFileSync(inventoryPath, 'utf8');
  const inventoryRoots = coveredFiles(inventory, repoRoot);
  const dispositions = inventoryDispositions(inventory, repoRoot);
  const roots = [...new Set([...inventoryRoots, ...surfaceRoots])];
  if (inventoryRoots.length === 0) {
    return { ok: false, summary: 'inventory produced no bridge-client files', findings: [], files: [], removed: [] };
  }
  const removed = roots.filter((path) => !existsSync(path));
  const { files, predecessor } = reachableFiles(roots, repoRoot, dispositions);
  const findings = files.flatMap((path) => scanFile(path, repoRoot).map((message) => ({
    message,
    importPath: importPath(path, predecessor, repoRoot),
  })));
  return {
    ok: findings.length === 0,
    summary: `${inventoryRoots.length} inventory roots; ${files.length} statically reachable files; ${removed.length} removed roots`,
    findings,
    files,
    removed,
  };
}

function main() {
  const result = runGate();
  console.log(`[c5-grep-gates] ${result.summary}`);
  result.removed.forEach((path) => console.log(`[c5-grep-gates] removed: ${path.slice(DEFAULT_REPO_ROOT.length + 1)}`));
  if (!result.ok) {
    console.error(`[c5-grep-gates] FAIL: ${result.findings.length} forbidden reachable references`);
    result.findings.forEach((finding) => {
      console.error(finding.message);
      console.error(`  reachable via ${finding.importPath}`);
    });
    process.exitCode = 1;
    return;
  }
  console.log('[c5-grep-gates] PASS: no Supabase SDK/runtime calls in the transitive bridge-mode graph');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
