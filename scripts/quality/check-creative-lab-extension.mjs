#!/usr/bin/env node
/**
 * Fast, complete validation for one Creative Lab editor extension.
 *
 * Usage:
 *   npm run test:creative-extension -- pulse-map
 */

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requestedSlug = process.argv[2];
const creativeLabDirectory = resolve(
  repoRoot,
  'src/tools/video-editor/examples/extensions/creative-lab',
);

if (!requestedSlug || (requestedSlug !== '--all' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedSlug))) {
  console.error('[creative-extension] Expected one kebab-case extension slug or --all.');
  process.exit(2);
}

const slugs = requestedSlug === '--all'
  ? readdirSync(creativeLabDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
      .filter((name) => existsSync(resolve(creativeLabDirectory, name, 'reigh-extension.json')))
      .sort()
  : [requestedSlug];

const extensions = slugs.map((slug) => {
  const extensionDirectory = resolve(creativeLabDirectory, slug);
  return {
    slug,
    sourcePath: ['index.ts', 'index.tsx']
      .map((name) => resolve(extensionDirectory, name))
      .find(existsSync),
    testPath: ['index.test.ts', 'index.test.tsx']
      .map((name) => resolve(extensionDirectory, name))
      .find(existsSync),
    manifestPath: resolve(extensionDirectory, 'reigh-extension.json'),
  };
});

for (const extension of extensions) {
  if (!extension.sourcePath || !extension.testPath || !existsSync(extension.manifestPath)) {
    console.error(
      `[creative-extension] ${extension.slug} must contain index.ts(x), index.test.ts(x), and reigh-extension.json.`,
    );
    process.exit(2);
  }
}

const label = requestedSlug === '--all' ? `${extensions.length} extensions` : requestedSlug;
const sourcePaths = extensions.map((extension) => extension.sourcePath);
const testPaths = extensions.map((extension) => extension.testPath);

const commands = [
  {
    label: 'focused Vitest',
    command: resolve(repoRoot, 'node_modules/.bin/vitest'),
    args: ['run', '--config', 'config/testing/vitest.config.ts', ...testPaths],
  },
  {
    label: 'focused ESLint',
    command: resolve(repoRoot, 'node_modules/.bin/eslint'),
    args: [...sourcePaths, ...testPaths, '--max-warnings', '0'],
  },
  {
    label: 'TypeScript project check',
    command: resolve(repoRoot, 'node_modules/.bin/tsc'),
    args: ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
  },
  {
    label: 'extension drift release gate',
    command: process.execPath,
    args: ['scripts/quality/check-extension-drift.mjs', '--release'],
  },
];

for (const step of commands) {
  console.log(`\n[creative-extension] ${label}: ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(`[creative-extension] Failed to start ${step.label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[creative-extension] ${step.label} failed with status ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[creative-extension] ${label}: all checks passed.`);
