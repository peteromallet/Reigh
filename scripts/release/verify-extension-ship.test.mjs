import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  ASTRID_GATE_PROFILE,
  EXPECTED_REQUIRED_GATES,
  MANIFEST_PATH,
  REIGH_GATE_PROFILE,
  REPO_ROOT,
  buildExecutionPlan,
  buildSanitizedEnvironment,
  executeSteps,
  formatCommand,
  isMakeRecipeSafeExecutablePath,
  parseCliArgs,
  resolveAstridPython,
  validatePackageJson,
  validateReleaseManifest,
} from './verify-extension-ship.mjs';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const packageJson = JSON.parse(readFileSync(`${REPO_ROOT}/package.json`, 'utf8'));

describe('extension ship verifier', () => {
  it('accepts help and both plan aliases while rejecting unknown options', () => {
    assert.deepEqual(parseCliArgs([]), { help: false, mode: 'run' });
    assert.deepEqual(parseCliArgs(['--plan']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--dry-run']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--help']), { help: true, mode: 'run' });
    assert.throws(() => parseCliArgs(['--skip-astrid']), /unknown option/);
  });

  it('validates the checked-in manifest, gate profile, and package scripts', () => {
    assert.equal(validateReleaseManifest(manifest), manifest);
    assert.doesNotThrow(() => validatePackageJson(packageJson, manifest));
    assert.deepEqual(manifest.requiredGates, [...EXPECTED_REQUIRED_GATES]);
    const gitignore = readFileSync(`${REPO_ROOT}/.gitignore`, 'utf8');
    assert.match(gitignore, /^!docs\/extensions\/evidence\/releases\/$/m);
    assert.match(gitignore, /^!docs\/extensions\/evidence\/releases\/\*\*$/m);

    for (const command of [
      'npx --yes only-allow npm',
      'npm exec only-allow npm',
      'pnpx only-allow npm',
      'bunx only-allow npm',
    ]) {
      const unpinnedLifecycle = structuredClone(packageJson);
      unpinnedLifecycle.scripts.preinstall = command;
      assert.throws(
        () => validatePackageJson(unpinnedLifecycle, manifest),
        /preinstall must not execute packages outside the lockfile/,
      );
    }
  });

  it('pins the container runtime and writes extension controls at container start', () => {
    const dockerfile = readFileSync(`${REPO_ROOT}/Dockerfile`, 'utf8');
    const nvmVersion = readFileSync(`${REPO_ROOT}/.nvmrc`, 'utf8').trim();
    const fromLines = dockerfile.match(/^FROM node:[^\n]+$/gm) ?? [];
    const pinnedImage = `node:${manifest.verification.node}-alpine@${manifest.verification.nodeImageDigest}`;

    assert.equal(nvmVersion, manifest.verification.node);
    assert.deepEqual(fromLines, [
      `FROM ${pinnedImage} AS build`,
      `FROM ${pinnedImage} AS runtime`,
    ]);

    for (const retiredKey of [
      'VITE_EXTENSION_HOST_ENABLED',
      'VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED',
      'VITE_RUNAWAY_TYPED_TIMELINE_ENABLED',
      'VITE_EXTENSION_RELEASE_CONFIG_REVISION',
    ]) {
      assert.doesNotMatch(dockerfile, new RegExp(`^ARG ${retiredKey}$`, 'm'));
      assert.doesNotMatch(dockerfile, new RegExp(`${retiredKey}="\\$${retiredKey}"`));
    }
    assert.match(dockerfile, /^COPY --chown=node:node config \.\/config$/m);
    assert.match(dockerfile, /^COPY scripts\/runtime \.\/scripts\/runtime$/m);
    assert.match(dockerfile, /^COPY --chown=node:node --from=build \/app\/dist \.\/dist$/m);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /^HEALTHCHECK .*\\$/m);
    assert.match(dockerfile, /NODE_OPTIONS="--max-old-space-size=4096" npm run build/);
    assert.match(dockerfile, /node scripts\/runtime\/write-extension-release-config\.mjs/);
    assert.match(dockerfile, /exec npm run serve/);
    assert.equal(
      packageJson.scripts['start:railway'],
      'node scripts/runtime/write-extension-release-config.mjs && npm run serve',
    );
    assert.doesNotMatch(packageJson.scripts['start:railway'], /npm run build/);
    assert.deepEqual(REIGH_GATE_PROFILE[0].args, [
      'ci', '--no-audit', '--no-fund',
    ]);
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'runtime-rollout'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run test:extensions:runtime-rollout'
    )));
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'container-runtime'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run verify:extension-container'
    )));
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'paired-release-e2e'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run verify:paired-release-e2e'
    )));
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'cross-browser-e2e'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run test:e2e:extension-cross-browser'
    )));
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'accessibility-e2e'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run test:e2e:extension-accessibility'
    )));
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'ship-evidence'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run check:extension-ship-evidence:release'
    )));
  });

  it('fails closed on a mutable Astrid ref or incomplete gate inventory', () => {
    const mutableRef = structuredClone(manifest);
    mutableRef.astrid.commit = 'main';
    assert.throws(
      () => validateReleaseManifest(mutableRef),
      /astrid\.commit must be a full 40-character lowercase commit pin/,
    );

    const missingGate = structuredClone(manifest);
    missingGate.requiredGates.pop();
    assert.throws(
      () => validateReleaseManifest(missingGate),
      /requiredGates must exactly equal/,
    );

    const unsafeTag = structuredClone(manifest);
    unsafeTag.reigh.releaseTag = '../mutable';
    assert.throws(
      () => validateReleaseManifest(unsafeTag),
      /reigh\.releaseTag must be a safe annotated-tag name/,
    );
  });

  it('builds only fixed argument-vector commands with Astrid last', () => {
    const astridCheckout = '/tmp/astrid-pinned-fixture';
    const plan = buildExecutionPlan({
      repoRoot: REPO_ROOT,
      astridCheckout,
      astridPython: '/tmp/astrid-python',
      astridRef: 'a'.repeat(40),
      reighRef: 'b'.repeat(40),
    });

    assert.equal(
      plan.length,
      REIGH_GATE_PROFILE.length + ASTRID_GATE_PROFILE.length,
    );
    assert.equal(plan.at(-2).cwd, `${astridCheckout}/remotion`);
    assert.equal(plan.at(-2).command, 'npm');
    assert.equal(plan.at(-1).cwd, astridCheckout);
    assert.equal(plan.at(-1).command, 'make');
    assert.deepEqual(plan.at(-1).args, ['ci']);
    assert.deepEqual(plan.at(-1).env, {
      PY: '/tmp/astrid-python',
      PYTHON_BIN: '/tmp/astrid-python',
      PYTHONPATH: `${REPO_ROOT}/vendor/timeline-schema/python`,
    });
    assert.ok(plan.every((step) => Array.isArray(step.args)));
    assert.ok(plan.every((step) => step.command === 'npm' || step.command === 'make'));
    const paired = plan.find((step) => step.id === 'paired-release-e2e');
    assert.deepEqual(paired?.env, {
      ASTRID_CHECKOUT: astridCheckout,
      ASTRID_PYTHON: '/tmp/astrid-python',
      ASTRID_REF: 'a'.repeat(40),
      REIGH_REF: 'b'.repeat(40),
    });

    const rendered = plan.map(formatCommand).join('\n');
    assert.doesNotMatch(
      rendered,
      /\b(?:rm|rmdir|git\s+(?:checkout|clean|reset)|sudo)\b/,
    );
  });

  it('stops at the first failed gate', () => {
    const calls = [];
    const steps = [
      { id: 'one', label: 'one', command: 'npm', args: ['--version'], cwd: REPO_ROOT },
      { id: 'two', label: 'two', command: 'npm', args: ['--version'], cwd: REPO_ROOT },
      { id: 'three', label: 'three', command: 'npm', args: ['--version'], cwd: REPO_ROOT },
    ];

    assert.throws(
      () => executeSteps(steps, (command, args) => {
        calls.push([command, ...args]);
        return { status: calls.length === 2 ? 7 : 0 };
      }),
      /gate two failed: exit 7/,
    );
    assert.equal(calls.length, 2);
  });

  it('runs gates with an allowlisted environment and controlled Python overrides', () => {
    const ambientBypasses = {
      MAKEFLAGS: '-n',
      MFLAGS: '-n',
      ASTRID_CI_SKIP_GATE: '1',
      ASTRID_CI_SKIP_BROAD: '1',
      ASTRID_CI_SKIP_COVERAGE: '1',
      PYTHONPATH: '/tmp/attacker',
      PYTEST_ADDOPTS: '-m not_release',
      NODE_OPTIONS: '--require=/tmp/attacker.cjs',
      NPM_CONFIG_SCRIPT_SHELL: '/usr/bin/true',
      NPM_CONFIG_USERCONFIG: '/tmp/attacker.npmrc',
      NPM_CONFIG_GLOBALCONFIG: '/tmp/global-attacker.npmrc',
      VITEST_POOL_ID: 'attacker',
      OPENAI_API_KEY: 'secret',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      TEST_USER_PASSWORD: 'secret',
    };
    const previous = Object.fromEntries(
      Object.keys(ambientBypasses).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, ambientBypasses);

    try {
      let captured;
      executeSteps([{
        id: 'astrid-ci',
        label: 'Astrid CI',
        command: 'make',
        args: ['ci'],
        cwd: '/tmp',
        env: { PY: '/safe/python', PYTHON_BIN: '/safe/python' },
      }], (_command, _args, options) => {
        captured = options.env;
        return { status: 0 };
      });

      assert.deepEqual(captured, {
        ...buildSanitizedEnvironment(),
        PY: '/safe/python',
        PYTHON_BIN: '/safe/python',
      });
      for (const key of Object.keys(ambientBypasses)) {
        if (key === 'NPM_CONFIG_USERCONFIG' || key === 'NPM_CONFIG_GLOBALCONFIG') {
          assert.equal(captured[key], '/dev/null', `${key} was not neutralized`);
        } else {
          assert.equal(captured[key], undefined, `${key} leaked into the gate`);
        }
      }
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    assert.throws(
      () => buildSanitizedEnvironment({ ASTRID_CI_SKIP_GATE: '1' }),
      /environment key is not allowed/,
    );
  });

  it('rejects shell executables and non-absolute Astrid Python paths', () => {
    assert.equal(isMakeRecipeSafeExecutablePath('/safe/venv/bin/python3.11'), true);
    for (const unsafePath of [
      '/tmp/python path/bin/python',
      '/tmp/python;other/bin/python',
      '/tmp/python#other/bin/python',
      '/tmp/python$other/bin/python',
    ]) {
      assert.equal(isMakeRecipeSafeExecutablePath(unsafePath), false);
    }
    assert.throws(
      () => resolveAstridPython(manifest, { ASTRID_PYTHON: 'python3' }),
      /must be absolute/,
    );
    assert.throws(
      () => resolveAstridPython(manifest, { ASTRID_PYTHON: '/bin/sh' }),
      /not a usable Python interpreter|not a Python interpreter|identity mismatch/,
    );
    assert.throws(
      () => resolveAstridPython(manifest, {
        ASTRID_PYTHON: '/tmp/python path/with spaces/bin/python',
      }),
      /does not exist|unsafe for Make recipes/,
    );
  });

  it('prints help and a non-executing plan without Astrid environment', () => {
    const script = `${REPO_ROOT}/scripts/release/verify-extension-ship.mjs`;
    const help = spawnSync(process.execPath, [script, '--help'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /ASTRID_CHECKOUT/);
    assert.match(help.stdout, /--dry-run/);

    const plan = spawnSync(process.execPath, [script, '--plan'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        REIGH_REF: '',
        ASTRID_CHECKOUT: '',
        ASTRID_REF: '',
        ASTRID_PYTHON: '',
      },
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /PLAN ONLY/);
    assert.match(plan.stdout, /make ci/);
    assert.match(plan.stdout, /<required for execution>/);
    assert.match(plan.stdout, /ASTRID_PYTHON/);
  });
});
