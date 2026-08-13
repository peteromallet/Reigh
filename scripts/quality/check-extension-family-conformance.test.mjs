#!/usr/bin/env node
/**
 * Coverage for the extension family conformance gate — M7b sidecar-blocker
 * and requirement-key awareness, plus release-mode uiIntegrationTest
 * host-consumer evidence enforcement.
 *
 * Uses temporary fixtures where practical.  The registry is dynamically
 * imported via tsx path resolution, so negative M7b-key tests operate
 * against the checked-in registry while the sidecar-blocker checks use
 * temp directories for the file-system reads.  The uiIntegrationTest
 * evidence checks inject a one-family fixture registry through the
 * gate's `--registry-override` test hook so missing / nonexistent /
 * invalid-extension / out-of-repo / node_modules / non-file /
 * non-test-content evidence can be enumerated deterministically.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, '..', '..');
const gateScript = resolve(moduleDir, 'check-extension-family-conformance.mjs');

function writeRepoFile(root, relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}

function replaceInFile(root, relPath, searchValue, replaceValue) {
  const absPath = join(root, relPath);
  const next = readFileSync(absPath, 'utf8').replaceAll(searchValue, replaceValue);
  writeFileSync(absPath, next, 'utf8');
}

function runGate(root, mode = '--audit', extraArgs = '') {
  try {
    const result = execSync(
      `npx tsx "${gateScript}" ${mode} --repo-root="${root}" ${extraArgs} 2>&1`,
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    return { exitCode: 0, stdout: result, stderr: '' };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
    };
  }
}

/**
 * Copies the runtime support files the gate reads from `--repo-root` into
 * a temp fixture repo so the file-system checks have real content.
 */
function copyRuntimeSupportFiles(root) {
  // Copy extensionSurface.ts (needed for inline-projection check)
  const extSurfaceSrc = join(repoRoot, 'src/tools/video-editor/runtime/extensionSurface.ts');
  if (existsSync(extSurfaceSrc)) {
    writeRepoFile(
      root,
      'src/tools/video-editor/runtime/extensionSurface.ts',
      readFileSync(extSurfaceSrc, 'utf8'),
    );
  }

  // Copy projector directory (needed for projector import checks)
  const projectorsDir = join(repoRoot, 'src/tools/video-editor/runtime/families/projectors');
  if (existsSync(projectorsDir)) {
    for (const f of readdirSync(projectorsDir)) {
      if (f.endsWith('.ts')) {
        writeRepoFile(
          root,
          `src/tools/video-editor/runtime/families/projectors/${f}`,
          readFileSync(join(projectorsDir, f), 'utf8'),
        );
      }
    }
  }

  // Copy the process adapter (needed for sidecar-blocker awareness)
  const processAdapterSrc = join(repoRoot, 'src/tools/video-editor/runtime/families/processAdapter.ts');
  if (existsSync(processAdapterSrc)) {
    writeRepoFile(
      root,
      'src/tools/video-editor/runtime/families/processAdapter.ts',
      readFileSync(processAdapterSrc, 'utf8'),
    );
  }
}

/**
 * Sets up a temp repo that mirrors the real repo's structure enough for
 * the sidecar-blocker file-system checks to run.  The temp dir must
 * contain the schema, maturity JSON, and adapter/projector files at the
 * expected paths.  The registry import resolves from the real project
 * root regardless of --repo-root (tsx uses the real tsconfig).
 */
function setupTempRepoForSidecarChecks() {
  const root = mkdtempSync(join(os.tmpdir(), 'family-conformance-'));

  // Copy the schema from the real repo
  const schemaSrc = join(repoRoot, 'config/contracts/reigh-extension.schema.json');
  writeRepoFile(root, 'config/contracts/reigh-extension.schema.json', readFileSync(schemaSrc, 'utf8'));

  // Copy family-maturity.json
  const maturitySrc = join(repoRoot, 'config/extensions/family-maturity.json');
  writeRepoFile(root, 'config/extensions/family-maturity.json', readFileSync(maturitySrc, 'utf8'));

  copyRuntimeSupportFiles(root);

  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Release-mode uiIntegrationTest evidence fixtures
// ---------------------------------------------------------------------------

/**
 * All-true requirement checklist for the evidence fixture family.  Key
 * order matters: the gate's expected-matrix builder iterates
 * `Object.keys(def.requirements)`, so the fixture maturity JSON must use
 * the same order to byte-match.
 */
const EVIDENCE_REQUIREMENTS = {
  manifestSchema: true,
  normalizedDescriptor: true,
  registrationApi: true,
  lifecycleCleanup: true,
  diagnostics: true,
  hostCapabilityProjection: true,
  uiIntegration: true,
  persistencePosture: true,
  examples: true,
  tests: true,
};

/** Minimal schema whose enum/oneOf match the single fixture kind. */
const EVIDENCE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  definitions: {
    ContributionKind: { enum: ['slot'] },
    Contribution: { oneOf: [{ $ref: '#/definitions/SlotContribution' }] },
  },
};

/**
 * One-family fixture registry: kind 'slot', declared `documented` /
 * execution `absent` (no host-adapter coupling), fully conformant, with
 * `requirements.uiIntegration: true` so the evidence check applies.
 */
function evidenceFixtureFamily(overrides = {}) {
  return {
    kind: 'slot',
    declarationMaturity: 'documented',
    executionMaturity: 'absent',
    hostIntegrationNotes: null,
    requiresTrustedCode: false,
    manifestSchemaDefinition: 'SlotContribution',
    sdkModules: ['src/sdk/manifest.ts'],
    hostAdapter: null,
    requirements: { ...EVIDENCE_REQUIREMENTS },
    legacyMilestone: null,
    label: 'Slot',
    description: null,
    ...overrides,
  };
}

/**
 * The family-maturity.json row the gate's `buildExpectedMatrix` produces
 * for a fixture family.  Written to the fixture repo so the
 * generated-JSON freshness check byte-matches.  `uiIntegrationTest` is
 * mirrored from the family (undefined → null), matching the generator.
 */
function evidenceFixtureMatrix(family) {
  const coverage = {};
  for (const key of Object.keys(EVIDENCE_REQUIREMENTS)) {
    coverage[key] = EVIDENCE_REQUIREMENTS[key];
  }
  return [
    {
      kind: 'slot',
      label: 'Slot',
      description: null,
      declarationMaturity: 'documented',
      executionMaturity: 'absent',
      sdkModules: ['src/sdk/manifest.ts'],
      hostAdapter: null,
      requiresTrustedCode: false,
      manifestSchemaDefinition: 'SlotContribution',
      uiIntegrationTest: family.uiIntegrationTest ?? null,
      coverage,
      conformance: {
        fullyConformant: true,
        gapCount: 0,
        coherent: true,
        schemaCovered: true,
        metRequirementCount: 10,
        unmetRequirementCount: 0,
        unassessedRequirementCount: 0,
      },
      legacyCompatibility: { milestone: null, bridged: false },
      hostIntegrationNotes: null,
    },
  ];
}

/**
 * Sets up a temp repo for evidence-check scenarios.  The fixture registry
 * is injected through `--registry-override`; all other file-system inputs
 * (schema, maturity JSON, runtime support files) are written/copied so
 * every non-evidence check passes in release mode.
 *
 * @param {object} options
 * @param {object} options.family    The fixture family definition.
 * @param {Record<string, string>} [options.files]
 *   Extra files to create in the temp repo (e.g. evidence test files).
 */
function setupEvidenceRepo({ family, files = {} }) {
  const root = mkdtempSync(join(os.tmpdir(), 'family-evidence-'));

  writeRepoFile(
    root,
    'config/contracts/reigh-extension.schema.json',
    JSON.stringify(EVIDENCE_SCHEMA, null, 2) + '\n',
  );
  writeRepoFile(
    root,
    'config/extensions/family-maturity.json',
    JSON.stringify(evidenceFixtureMatrix(family), null, 2) + '\n',
  );

  copyRuntimeSupportFiles(root);

  for (const [relPath, content] of Object.entries(files)) {
    writeRepoFile(root, relPath, content);
  }

  const registryPath = join(root, 'fixture-registry.mjs');
  writeFileSync(
    registryPath,
    `export const VIDEO_FAMILY_REGISTRY = ${JSON.stringify([family], null, 2)};\n`,
    'utf8',
  );

  return {
    root,
    registryPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('check-extension-family-conformance — M7b sidecar-blocker and requirement-key awareness', () => {
  it('passes against the checked-in repository (audit mode)', () => {
    const result = runGate(repoRoot, '--audit');
    assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Checking sidecar-blocker awareness/);
  });

  it('recognizes M7b requirement keys for outputFormat and process families', () => {
    const result = runGate(repoRoot, '--audit');
    assert.strictEqual(result.exitCode, 0, result.stdout + result.stderr);
    // The output should NOT warn about missing M7b keys for outputFormat/process
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /outputFormat.*is missing M7b requirement key/,
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /process.*is missing M7b requirement key/,
    );
  });

  it('passes sidecar-blocker checks on a fixture that mirrors the real project', () => {
    const { root, cleanup } = setupTempRepoForSidecarChecks();
    try {
      const result = runGate(root, '--audit');
      // The gate may produce other warnings but should not produce sidecar-blocker warnings
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /sidecar-blocker awareness is incomplete/,
      );
    } finally {
      cleanup();
    }
  });

  it('fails when outputFormat projector loses sidecar-export references', () => {
    const { root, cleanup } = setupTempRepoForSidecarChecks();
    try {
      replaceInFile(
        root,
        'src/tools/video-editor/runtime/families/projectors/outputFormatProjector.ts',
        'sidecar-export',
        'unsupported-route',
      );

      const result = runGate(root, '--audit');
      assert.match(
        result.stdout + result.stderr,
        /does not reference sidecar-export routes/,
      );
    } finally {
      cleanup();
    }
  });

  it('fails when outputFormat projector loses buildOutputFormatBlockers', () => {
    const { root, cleanup } = setupTempRepoForSidecarChecks();
    try {
      replaceInFile(
        root,
        'src/tools/video-editor/runtime/families/projectors/outputFormatProjector.ts',
        'buildOutputFormatBlockers',
        'buildLegacyBlockers',
      );

      const result = runGate(root, '--audit');
      assert.match(
        result.stdout + result.stderr,
        /is missing buildOutputFormatBlockers/,
      );
    } finally {
      cleanup();
    }
  });

  it('fails when process adapter loses process-dependent references', () => {
    const { root, cleanup } = setupTempRepoForSidecarChecks();
    try {
      // Remove all process-dependent, sidecar, and route-scoped references
      const adapterPath = join(
        root,
        'src/tools/video-editor/runtime/families/processAdapter.ts',
      );
      let content = readFileSync(adapterPath, 'utf8');
      content = content.replace(/process-dependent/g, 'unknown-state');
      content = content.replace(/sidecar/g, 'auxiliary');
      content = content.replace(/route-scoped/g, 'global');
      writeFileSync(adapterPath, content, 'utf8');

      const result = runGate(root, '--audit');
      assert.match(
        result.stdout + result.stderr,
        /does not reference sidecar or route-scoped concepts/,
      );
    } finally {
      cleanup();
    }
  });
});

describe('check-extension-family-conformance — release-mode uiIntegrationTest host-consumer evidence', () => {
  const VALID_EVIDENCE = 'src/tools/video-editor/components/TimelineEditorShellCore.test.tsx';

  /**
   * Plausible host-consumer test source: exercises every accepted
   * test-runner construct (describe/it/test/render/renderHook).
   */
  const VALID_HOST_CONSUMER_SOURCE =
    "import { describe, it, test } from 'vitest';\n" +
    "import { render, renderHook } from '@testing-library/react';\n" +
    "describe('host consumer', () => {\n" +
    "  it('renders', () => {});\n" +
    "  test('hooks', () => { renderHook(() => {}); });\n" +
    '  render(<div />);\n' +
    '});\n';

  const MISSING_DIAGNOSTIC =
    /claims requirements\.uiIntegration but does not name a uiIntegrationTest/;
  const NONEXISTENT_DIAGNOSTIC = /uiIntegrationTest path does not exist/;
  const INVALID_EXTENSION_DIAGNOSTIC = /unsupported test-file extension/;
  const OUTSIDE_REPO_DIAGNOSTIC = /resolves outside the repository/;
  const NOT_REGULAR_FILE_DIAGNOSTIC = /is not a regular file/;
  const NON_TEST_CONTENT_DIAGNOSTIC =
    /does not contain test-runner constructs/;

  it('release mode passes when a UI-integrated family names existing .test.tsx evidence', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({ uiIntegrationTest: VALID_EVIDENCE }),
      files: { [VALID_EVIDENCE]: VALID_HOST_CONSUMER_SOURCE },
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.strictEqual(
        result.exitCode,
        0,
        `expected clean release pass, got:\n${result.stdout + result.stderr}`,
      );
      assert.match(result.stdout, /OK: all families conform/);
    } finally {
      cleanup();
    }
  });

  it('release mode passes for .test.ts and .spec.ts evidence extensions', () => {
    const cases = [
      {
        path: 'src/tools/video-editor/runtime/host-consumer.test.ts',
        file: 'src/tools/video-editor/runtime/host-consumer.test.ts',
      },
      {
        path: 'src/tools/video-editor/runtime/host-consumer.spec.ts',
        file: 'src/tools/video-editor/runtime/host-consumer.spec.ts',
      },
    ];
    for (const c of cases) {
      const { root, registryPath, cleanup } = setupEvidenceRepo({
        family: evidenceFixtureFamily({ uiIntegrationTest: c.path }),
        files: { [c.file]: VALID_HOST_CONSUMER_SOURCE },
      });
      try {
        const result = runGate(
          root,
          '--release',
          `--registry-override="${registryPath}"`,
        );
        assert.strictEqual(
          result.exitCode,
          0,
          `expected clean release pass for ${c.path}, got:\n${result.stdout + result.stderr}`,
        );
      } finally {
        cleanup();
      }
    }
  });

  it('release mode rejects a UI-integrated family with missing uiIntegrationTest', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily(),
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(result.exitCode, 0, 'release mode must reject missing evidence');
      assert.match(result.stdout + result.stderr, MISSING_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /Family 'slot'/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects blank uiIntegrationTest with the same stable diagnostic', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({ uiIntegrationTest: '   ' }),
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.stdout + result.stderr, MISSING_DIAGNOSTIC);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects nonexistent evidence paths', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/missing-consumer.test.tsx',
      }),
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(result.exitCode, 0, 'release mode must reject nonexistent evidence');
      assert.match(result.stdout + result.stderr, NONEXISTENT_DIAGNOSTIC);
      assert.match(
        result.stdout + result.stderr,
        /missing-consumer\.test\.tsx/,
      );
    } finally {
      cleanup();
    }
  });

  it('release mode rejects invalid-extension evidence paths', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/evidence-source.ts',
      }),
      files: {
        'src/tools/video-editor/runtime/evidence-source.ts':
          'export const notATest = true;\n',
      },
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(result.exitCode, 0, 'release mode must reject invalid extensions');
      assert.match(result.stdout + result.stderr, INVALID_EXTENSION_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /evidence-source\.ts/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects evidence paths that resolve outside the repository', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: '../outside-consumer.test.ts',
      }),
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(
        result.exitCode,
        0,
        'release mode must reject out-of-repo evidence',
      );
      assert.match(result.stdout + result.stderr, OUTSIDE_REPO_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /outside-consumer\.test\.ts/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects evidence paths inside node_modules even when the file exists', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'node_modules/video-host/host-consumer.test.ts',
      }),
      files: {
        'node_modules/video-host/host-consumer.test.ts':
          VALID_HOST_CONSUMER_SOURCE,
      },
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(
        result.exitCode,
        0,
        'release mode must reject node_modules evidence',
      );
      assert.match(result.stdout + result.stderr, OUTSIDE_REPO_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /node_modules/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects symlink evidence that escapes the repository root', (t) => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/linked-consumer.test.ts',
      }),
    });
    try {
      // Symlink an out-of-repo file into the fixture repo at the evidence
      // path; the canonical target lives outside the repository root.
      const outsideTarget = join(root, '..', 'outside-target.test.ts');
      writeFileSync(outsideTarget, VALID_HOST_CONSUMER_SOURCE, 'utf8');
      try {
        symlinkSync(
          outsideTarget,
          join(root, 'src/tools/video-editor/runtime/linked-consumer.test.ts'),
        );
      } catch {
        t.skip('symlink creation is not permitted in this environment');
        return;
      }
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(
        result.exitCode,
        0,
        'release mode must reject symlink escapes',
      );
      assert.match(result.stdout + result.stderr, OUTSIDE_REPO_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /linked-consumer\.test\.ts/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects evidence paths that are directories, not regular files', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/host-consumer.test.ts',
      }),
    });
    try {
      // Create a directory at the evidence path instead of a file
      mkdirSync(
        join(root, 'src/tools/video-editor/runtime/host-consumer.test.ts'),
        { recursive: true },
      );
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(
        result.exitCode,
        0,
        'release mode must reject non-file evidence',
      );
      assert.match(result.stdout + result.stderr, NOT_REGULAR_FILE_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /host-consumer\.test\.ts/);
    } finally {
      cleanup();
    }
  });

  it('release mode rejects suffix-valid evidence whose content is not a host-consumer test', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/registry-unit.test.ts',
      }),
      files: {
        'src/tools/video-editor/runtime/registry-unit.test.ts':
          'import { commandRegistry } from "./commandRegistry";\n' +
          'export const unitOnly = true;\n',
      },
    });
    try {
      const result = runGate(
        root,
        '--release',
        `--registry-override="${registryPath}"`,
      );
      assert.notStrictEqual(
        result.exitCode,
        0,
        'release mode must reject non-test content',
      );
      assert.match(result.stdout + result.stderr, NON_TEST_CONTENT_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /registry-unit\.test\.ts/);
    } finally {
      cleanup();
    }
  });

  it('release mode accepts evidence containing any single test-runner construct (lenient)', () => {
    const cases = [
      {
        path: 'src/tools/video-editor/runtime/describe-only.test.ts',
        body: "describe('x', () => {});\n",
      },
      {
        path: 'src/tools/video-editor/runtime/it-only.test.ts',
        body: "it('x', () => {});\n",
      },
      {
        path: 'src/tools/video-editor/runtime/test-only.test.ts',
        body: "test('x', () => {});\n",
      },
      {
        path: 'src/tools/video-editor/runtime/render-only.test.ts',
        body: "import { render } from '@testing-library/react';\nrender(<div />);\n",
      },
      {
        path: 'src/tools/video-editor/runtime/renderHook-only.test.ts',
        body: "import { renderHook } from '@testing-library/react';\nrenderHook(() => {});\n",
      },
    ];
    for (const c of cases) {
      const { root, registryPath, cleanup } = setupEvidenceRepo({
        family: evidenceFixtureFamily({ uiIntegrationTest: c.path }),
        files: { [c.path]: c.body },
      });
      try {
        const result = runGate(
          root,
          '--release',
          `--registry-override="${registryPath}"`,
        );
        assert.strictEqual(
          result.exitCode,
          0,
          `expected clean release pass for ${c.path}, got:\n${result.stdout + result.stderr}`,
        );
      } finally {
        cleanup();
      }
    }
  });

  it('audit mode reports evidence violations as warnings and exits 0', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily(),
    });
    try {
      const result = runGate(
        root,
        '--audit',
        `--registry-override="${registryPath}"`,
      );
      assert.strictEqual(result.exitCode, 0, 'audit mode must not fail on advisory violations');
      assert.match(result.stdout + result.stderr, /WARNINGS/);
      assert.match(result.stdout + result.stderr, MISSING_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /OK \(audit mode\)/);
    } finally {
      cleanup();
    }
  });

  it('audit mode warns (exit 0) on suffix-valid but non-test evidence content', () => {
    const { root, registryPath, cleanup } = setupEvidenceRepo({
      family: evidenceFixtureFamily({
        uiIntegrationTest: 'src/tools/video-editor/runtime/registry-unit.test.ts',
      }),
      files: {
        'src/tools/video-editor/runtime/registry-unit.test.ts':
          'export const unitOnly = true;\n',
      },
    });
    try {
      const result = runGate(
        root,
        '--audit',
        `--registry-override="${registryPath}"`,
      );
      assert.strictEqual(
        result.exitCode,
        0,
        'audit mode must not fail on advisory content violations',
      );
      assert.match(result.stdout + result.stderr, /WARNINGS/);
      assert.match(result.stdout + result.stderr, NON_TEST_CONTENT_DIAGNOSTIC);
      assert.match(result.stdout + result.stderr, /OK \(audit mode\)/);
    } finally {
      cleanup();
    }
  });

  it('checked-in registry evidence passes the release-mode evidence check', () => {
    // Every uiIntegration-true family in the checked-in registry names an
    // existing .test.ts / .test.tsx / .spec.ts path that is a regular
    // file under the repo root (not node_modules) whose content contains
    // test-runner constructs, so the evidence check must not report any
    // violation.  (Release mode may still fail on unrelated pre-existing
    // warnings; the evidence check must stay quiet.)
    const result = runGate(repoRoot, '--release');
    assert.notStrictEqual(result.exitCode, 2, 'gate must run, not crash');
    assert.doesNotMatch(result.stdout + result.stderr, MISSING_DIAGNOSTIC);
    assert.doesNotMatch(result.stdout + result.stderr, NONEXISTENT_DIAGNOSTIC);
    assert.doesNotMatch(result.stdout + result.stderr, INVALID_EXTENSION_DIAGNOSTIC);
    assert.doesNotMatch(result.stdout + result.stderr, OUTSIDE_REPO_DIAGNOSTIC);
    assert.doesNotMatch(result.stdout + result.stderr, NOT_REGULAR_FILE_DIAGNOSTIC);
    assert.doesNotMatch(result.stdout + result.stderr, NON_TEST_CONTENT_DIAGNOSTIC);
    assert.match(result.stdout + result.stderr, /Checking UI integration evidence/);
  });
});
