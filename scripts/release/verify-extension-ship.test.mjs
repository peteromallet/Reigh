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
  executeSteps,
  formatCommand,
  parseCliArgs,
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
      env: { ...process.env, ASTRID_CHECKOUT: '', ASTRID_REF: '' },
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /PLAN ONLY/);
    assert.match(plan.stdout, /make ci/);
    assert.match(plan.stdout, /<required for execution>/);
  });
});
