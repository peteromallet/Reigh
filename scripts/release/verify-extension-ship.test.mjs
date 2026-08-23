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
  });

  it('pins the container runtime and forwards every extension build control', () => {
    const dockerfile = readFileSync(`${REPO_ROOT}/Dockerfile`, 'utf8');
    const nvmVersion = readFileSync(`${REPO_ROOT}/.nvmrc`, 'utf8').trim();
    const fromLines = dockerfile.match(/^FROM node:[^\n]+$/gm) ?? [];

    assert.equal(nvmVersion, manifest.verification.node);
    assert.deepEqual(fromLines, [
      `FROM node:${manifest.verification.node}-alpine AS build`,
      `FROM node:${manifest.verification.node}-alpine AS runtime`,
    ]);

    for (const key of [
      'VITE_EXTENSION_HOST_ENABLED',
      'VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED',
      'VITE_RUNAWAY_TYPED_TIMELINE_ENABLED',
      'VITE_EXTENSION_RELEASE_CONFIG_REVISION',
    ]) {
      assert.match(dockerfile, new RegExp(`^ARG ${key}$`, 'm'));
      assert.match(dockerfile, new RegExp(`${key}="\\$${key}"`));
    }
  });

  it('fails closed on a mutable Astrid ref or incomplete gate inventory', () => {
    const mutableRef = structuredClone(manifest);
    mutableRef.astrid.commit = 'main';
    assert.throws(
      () => validateReleaseManifest(mutableRef),
      /astrid\.commit must be a 12-40 character lowercase commit pin/,
    );

    const missingGate = structuredClone(manifest);
    missingGate.requiredGates.pop();
    assert.throws(
      () => validateReleaseManifest(missingGate),
      /requiredGates must exactly equal/,
    );
  });

  it('builds only fixed argument-vector commands with Astrid last', () => {
    const astridCheckout = '/tmp/astrid-pinned-fixture';
    const plan = buildExecutionPlan({ repoRoot: REPO_ROOT, astridCheckout });

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
      PY: '<ASTRID_PYTHON required for execution>',
      PYTHON_BIN: '<ASTRID_PYTHON required for execution>',
    });
    assert.ok(plan.every((step) => Array.isArray(step.args)));
    assert.ok(plan.every((step) => step.command === 'npm' || step.command === 'make'));

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
        assert.equal(captured[key], undefined, `${key} leaked into the gate`);
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
    assert.throws(
      () => resolveAstridPython(manifest, { ASTRID_PYTHON: 'python3' }),
      /must be absolute/,
    );
    assert.throws(
      () => resolveAstridPython(manifest, { ASTRID_PYTHON: '/bin/sh' }),
      /not a usable Python interpreter|not a Python interpreter|identity mismatch/,
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
