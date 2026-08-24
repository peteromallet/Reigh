import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runGate } from '../../../scripts/c5-grep-gates.mjs';

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'c5-graph-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  for (const [path, source] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, source);
  }
  const inventoryPath = join(root, 'inventory.md');
  writeFileSync(inventoryPath, '| File | Owner | Wave | Notes | Disposition |\n|---|---|---|---|---|\n| `root.ts` | x | x | x | bridge-client |');
  return { root, inventoryPath };
}

describe('C5 transitive bridge-mode gate', () => {
  it('catches a forbidden dependency hidden behind a local helper import', () => {
    const { root, inventoryPath } = fixture({
      'src/root.ts': "import './helper';\n",
      'src/helper.ts': "import { createClient } from '@supabase/supabase-js';\nvoid createClient;\n",
    });
    const result = runGate({ repoRoot: root, inventoryPath, surfaceRoots: [] });
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.importPath).toContain('src/root.ts -> src/helper.ts');
  });

  it('does not cross an intentional dynamic-import authority boundary', () => {
    const { root, inventoryPath } = fixture({
      'src/root.ts': "export async function cloud() { return import('./deferred'); }\n",
      'src/deferred.ts': "import { createClient } from '@supabase/supabase-js';\nvoid createClient;\n",
    });
    expect(runGate({ repoRoot: root, inventoryPath, surfaceRoots: [] }).ok).toBe(true);
  });
});
