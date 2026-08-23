import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  getRuntimeErrorAliasImportBudget,
  RUNTIME_ERROR_ALIAS_IMPORT_BUDGET_PHASES,
  RUNTIME_ERROR_ALIAS_OWNER,
  RUNTIME_ERROR_ALIAS_REMOVE_BY,
  RUNTIME_ERROR_ALIAS_SPECIFIER,
} from '@/shared/lib/governance/runtimeErrorAliasPolicy';

function walkSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.desloppify') {
        return [];
      }
      return walkSourceFiles(resolved);
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    if (/\.test\.(ts|tsx)$/.test(entry.name) || /\.spec\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }
    return [resolved];
  });
}

function collectRuntimeErrorAliasImporters(): string[] {
  const srcRoot = path.join(process.cwd(), 'src');
  const escapedSpecifier = RUNTIME_ERROR_ALIAS_SPECIFIER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliasImport = new RegExp(
    `(?:\\bfrom\\s+|\\bimport\\s*\\(\\s*|\\bimport\\s+)["']${escapedSpecifier}["']`,
  );

  return walkSourceFiles(srcRoot)
    .filter((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      // Match actual static, side-effect, re-export, or dynamic imports. A raw
      // substring search counted the policy's own string constant as an alias
      // importer once the time-based budget reached zero.
      return aliasImport.test(content);
    })
    .map((filePath) => path.relative(process.cwd(), filePath).replace(/\\/g, '/'))
    .sort();
}

describe('runtime error alias governance contract', () => {
  it('keeps owner/removal metadata stable for migration automation', () => {
    expect(RUNTIME_ERROR_ALIAS_OWNER).toBe('runtime-foundation');
    expect(RUNTIME_ERROR_ALIAS_REMOVE_BY).toBe('2026-06-30');
  });

  it('keeps import budget phases descending until removal target', () => {
    expect(RUNTIME_ERROR_ALIAS_IMPORT_BUDGET_PHASES).toEqual([
      { through: '2026-03-31', max: 28 },
      { through: '2026-04-30', max: 20 },
      { through: '2026-05-31', max: 10 },
      { through: '2026-06-30', max: 4 },
    ]);
    expect(getRuntimeErrorAliasImportBudget(new Date('2026-03-15T00:00:00Z'))).toBe(28);
    expect(getRuntimeErrorAliasImportBudget(new Date('2026-04-10T00:00:00Z'))).toBe(20);
    expect(getRuntimeErrorAliasImportBudget(new Date('2026-05-20T00:00:00Z'))).toBe(10);
    expect(getRuntimeErrorAliasImportBudget(new Date('2026-07-01T00:00:00Z'))).toBe(0);
  });

  it('enforces importer budget against real source imports (not a static allowlist)', () => {
    const importerCount = collectRuntimeErrorAliasImporters().length;
    expect(importerCount).toBeLessThanOrEqual(getRuntimeErrorAliasImportBudget());
  });
});
