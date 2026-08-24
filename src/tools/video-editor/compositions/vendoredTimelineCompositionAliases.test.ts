import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = process.cwd();
const DECLARATIONS_PATH =
  'vendor/timeline-composition/typescript/src/workspace-aliases.d.ts';
const THEME_API_PATH = 'vendor/timeline-composition/typescript/src/theme-api.ts';
const RUNTIME_ALIAS_CONFIGS = [
  'config/vite/vite.config.ts',
  'config/testing/vitest.config.ts',
  'config/testing/vitest.boundary.config.ts',
] as const;
const REGISTRY_FAMILIES = [
  {
    family: 'effects',
    generated: 'vendor/timeline-composition/typescript/src/effects.generated.ts',
    vendorRoot: 'vendor/banodoco-effects',
  },
  {
    family: 'animations',
    generated: 'vendor/timeline-composition/typescript/src/animations.generated.ts',
    vendorRoot: 'vendor/banodoco-animations',
  },
  {
    family: 'transitions',
    generated: 'vendor/timeline-composition/typescript/src/transitions.generated.ts',
    vendorRoot: 'vendor/banodoco-transitions',
  },
] as const;

function workspaceSource(relativePath: string): string {
  return readFileSync(path.join(WORKSPACE_ROOT, relativePath), 'utf8');
}

describe('vendored timeline-composition workspace aliases', () => {
  it('loads the declaration contract from the stable non-generated package surface', () => {
    expect(workspaceSource(THEME_API_PATH)).toContain(
      '/// <reference path="./workspace-aliases.d.ts" />',
    );
  });

  it.each(REGISTRY_FAMILIES)(
    'keeps generated $family imports aligned with declarations, runtime aliases, and vendored modules',
    ({ family, generated, vendorRoot }) => {
      const declarations = workspaceSource(DECLARATIONS_PATH);
      expect(declarations).toContain(`declare module '@workspace-${family}/*'`);

      for (const configPath of RUNTIME_ALIAS_CONFIGS) {
        expect(workspaceSource(configPath)).toMatch(
          new RegExp(`["']@workspace-${family}["']\\s*:`),
        );
      }

      const generatedSource = workspaceSource(generated);
      const importPattern = new RegExp(
        `from ["']@workspace-${family}/([^"']+)["']`,
        'g',
      );
      const moduleSpecifiers = [...generatedSource.matchAll(importPattern)]
        .map((match) => match[1])
        .filter((specifier): specifier is string => specifier !== undefined);

      expect(moduleSpecifiers.length).toBeGreaterThan(0);
      for (const moduleSpecifier of moduleSpecifiers) {
        expect(
          existsSync(path.join(WORKSPACE_ROOT, vendorRoot, `${moduleSpecifier}.tsx`)),
          `missing vendored source for @workspace-${family}/${moduleSpecifier}`,
        ).toBe(true);
      }
    },
  );
});
