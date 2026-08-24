import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  ASTRID_GATE_PROFILE,
  ASTRID_SEPARATE_VOLUME_MIN_BYTES,
  DISK_BUDGET_OVERRIDE_ENV,
  EXPECTED_REQUIRED_GATES,
  HEAVY_STEP_MIN_FREE_BYTES,
  MANIFEST_PATH,
  REIGH_GATE_PROFILE,
  REPO_ROOT,
  assertDiskRequirements,
  assertCaptionSemanticsToolchain,
  assertHeavyStepDiskCapacity,
  assertReleaseDiskCapacity,
  availableBytesAt,
  buildExecutionPlan,
  buildSanitizedEnvironment,
  calculateReleaseRequiredBytes,
  executeSteps,
  formatCommand,
  formatNativeToolPin,
  isMakeRecipeSafeExecutablePath,
  nearestExistingAncestor,
  parseCliArgs,
  parseDiskBudgetOverride,
  parseLsTreeAllocatedBytes,
  resolveAstridPython,
  validatePackageJson,
  validateReleaseManifest,
  volumeKeyForPath,
} from './verify-extension-ship.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
    assert.match(
      dockerfile,
      new RegExp(`^LABEL org\\.opencontainers\\.image\\.base\\.digest="${manifest.verification.nodeImageDigest}"$`, 'm'),
    );

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
    assert.ok(REIGH_GATE_PROFILE.some((gate) => (
      gate.id === 'visual-baseline-provenance'
      && gate.command === 'npm'
      && gate.args.join(' ') === 'run verify:rc6-visual-baseline-provenance'
    )));
    const visualGateIndex = REIGH_GATE_PROFILE.findIndex((gate) => gate.id === 'visual-e2e');
    const provenanceGateIndex = REIGH_GATE_PROFILE.findIndex((gate) => gate.id === 'visual-baseline-provenance');
    assert.ok(visualGateIndex >= 0 && visualGateIndex < provenanceGateIndex);
    assert.deepEqual(REIGH_GATE_PROFILE[visualGateIndex].args, [
      'run', 'test:e2e:extension-visual',
    ]);
    assert.ok(!REIGH_GATE_PROFILE[visualGateIndex].args.includes('--update-snapshots'));
    assert.equal(manifest.verification.tesseract.executable, 'tesseract');
    assert.equal(manifest.verification.imageMagick.executable, 'magick');
    for (const toolName of ['ffmpeg', 'ffprobe', 'tesseract', 'imageMagick']) {
      assert.match(manifest.verification[toolName].executableSha256, /^sha256:[0-9a-f]{64}$/);
      assert.match(manifest.verification[toolName].buildIdentity, /\S/);
    }
    assert.match(manifest.verification.tesseract.engDataSha256, /^sha256:[0-9a-f]{64}$/);
  });

  it('rejects native pin drift, missing pins, and PATH substitutions', () => {
    for (const toolName of ['ffmpeg', 'ffprobe', 'tesseract', 'imageMagick']) {
      const drifted = structuredClone(manifest);
      drifted.verification[toolName].executableSha256 = 'sha256:not-a-digest';
      assert.throws(() => validateReleaseManifest(drifted), new RegExp(`verification\\.${toolName}\\.executableSha256`));
      const missing = structuredClone(manifest);
      delete missing.verification[toolName].buildIdentity;
      assert.throws(() => validateReleaseManifest(missing), new RegExp(`verification\\.${toolName}\\.buildIdentity`));
    }
    const substituted = structuredClone(manifest);
    assert.throws(
      () => assertCaptionSemanticsToolchain({
        ...substituted,
        verification: {
          ...substituted.verification,
          tesseract: {
            ...substituted.verification.tesseract,
            executable: 'missing-tesseract-path-substitution',
          },
        },
      }),
      /pinned native executable is missing from PATH|pinned tool executable is missing from the release PATH/,
    );
  });

  it('fails closed when a pinned caption-semantic executable is unavailable', () => {
    const missingTool = structuredClone(manifest);
    missingTool.verification.tesseract.executable = 'missing-tesseract-for-release-test';
    assert.throws(
      () => assertCaptionSemanticsToolchain(missingTool),
      /pinned native executable is missing from PATH/,
    );
  });

  it('explicitly permits only the committed Astrid stub in browser release lanes', () => {
    for (const configName of [
      'playwright.extension-cross-browser.config.ts',
      'playwright.extension-accessibility.config.ts',
      'playwright.extension-visual.config.ts',
    ]) {
      const config = readFileSync(`${REPO_ROOT}/${configName}`, 'utf8');
      assert.match(
        config,
        /ASTRID_BRIDGE_ALLOW_UNAUTHENTICATED_STUB:\s*'1'/,
        `${configName} must explicitly permit its committed bridge stub`,
      );
      assert.match(
        config,
        /command:\s*'node tests\/e2e\/timeline\/astrid-bridge-stub\.mjs'/,
        `${configName} must start the committed bridge stub`,
      );
    }
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

  it('renders native tool versions and exact build identities readably in the plan', () => {
    const rendered = formatNativeToolPin('FFmpeg', {
      version: '7.1.1',
      buildIdentity: 'ffmpeg version 7.1.1\nbuilt with fixture compiler\nconfiguration: --enable-gpl',
    });
    assert.equal(
      rendered,
      'FFmpeg 7.1.1 (build: ffmpeg version 7.1.1 | built with fixture compiler | configuration: --enable-gpl)',
    );
    assert.doesNotMatch(rendered, /\[object Object\]/);
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

  it('sizes complete commit trees in bigint allocation blocks and budgets archive overlap', () => {
    const sha = 'a'.repeat(40);
    const tree = [
      `100644 blob ${sha}       1\tfirst file`,
      `100644 blob ${sha} 4097\tsecond-file`,
      `100644 blob ${sha} 0\tempty`,
      `160000 commit ${sha} -\tsubmodule`,
      '',
    ].join('\0');
    assert.equal(parseLsTreeAllocatedBytes(tree), 4n * 4096n);
    assert.throws(
      () => parseLsTreeAllocatedBytes(`100644 blob ${sha} 1 missing-tab\0`),
      /no path separator/,
    );

    const gib = 1024n ** 3n;
    assert.equal(calculateReleaseRequiredBytes({
      reighTreeBytes: gib,
      astridTreeBytes: gib / 4n,
    }), 11n * gib);
    assert.throws(
      () => calculateReleaseRequiredBytes({ reighTreeBytes: 1, astridTreeBytes: 1n }),
      /reighTreeBytes must be a non-negative bigint/,
    );
  });

  it('uses statfs bigint bavail, walks to an existing ancestor, and fails closed', () => {
    const seen = [];
    const exists = (candidate) => candidate === '/volume';
    assert.equal(nearestExistingAncestor('/volume/not/yet/created', exists), '/volume');
    const probe = availableBytesAt('/volume/not/yet/created', {
      exists,
      statfs: (target, options) => {
        seen.push([target, options]);
        return { bavail: 3n, bfree: 999n, bsize: 4096n };
      },
    });
    assert.deepEqual(probe, { availableBytes: 12288n, target: '/volume' });
    assert.deepEqual(seen, [['/volume', { bigint: true }]]);

    assert.throws(
      () => availableBytesAt('/volume', {
        exists,
        statfs: () => {
          const error = new Error('not implemented');
          error.code = 'ENOSYS';
          throw error;
        },
      }),
      /cannot measure release disk capacity.*ENOSYS/,
    );
    assert.throws(
      () => availableBytesAt('/volume', { exists, statfs: () => ({ bavail: 1, bsize: 4096 }) }),
      /invalid bigint fields/,
    );
  });

  it('groups same-volume requirements, distinguishes volumes, and rejects unsupported platforms', () => {
    const calls = [];
    const dependencies = {
      ancestor: (candidate) => candidate,
      exists: () => true,
      platform: 'linux',
      realpath: (candidate) => candidate,
      stat: (candidate) => ({ dev: candidate.startsWith('/one') ? 1n : 2n }),
      statfs: (candidate) => {
        calls.push(candidate);
        return { bavail: candidate.startsWith('/one') ? 10n : 20n, bsize: 1n };
      },
    };
    const result = assertDiskRequirements([
      { path: '/one/a', requiredBytes: 5n },
      { path: '/one/b', requiredBytes: 9n },
      { path: '/two/a', requiredBytes: 20n },
    ], dependencies);
    assert.equal(result.length, 2);
    assert.deepEqual(calls.sort(), ['/one/b', '/two/a']);
    assert.throws(
      () => assertDiskRequirements([{ path: '/one/a', requiredBytes: 11n }], dependencies),
      /requires at least.*available/,
    );
    assert.equal(volumeKeyForPath('C:\\release\\tmp', {
      ancestor: (candidate) => candidate,
      platform: 'win32',
      realpath: (candidate) => candidate,
    }), 'win32:c:\\');
    assert.equal(volumeKeyForPath('\\\\server\\share\\release', {
      ancestor: (candidate) => candidate,
      platform: 'win32',
      realpath: (candidate) => candidate,
    }), 'win32:\\\\server\\share\\');
    assert.throws(
      () => volumeKeyForPath('/volume', {
        ancestor: (candidate) => candidate,
        platform: 'plan9',
        realpath: (candidate) => candidate,
      }),
      /does not support platform plan9/,
    );
  });

  it('allows the disk environment override to raise but never weaken the calculated budget', () => {
    const gib = 1024n ** 3n;
    assert.equal(parseDiskBudgetOverride({}), null);
    assert.equal(parseDiskBudgetOverride({ [DISK_BUDGET_OVERRIDE_ENV]: '123' }), 123n);
    for (const invalid of ['-1', '1.5', ' 1', '+1', '01', 'abc']) {
      assert.throws(
        () => parseDiskBudgetOverride({ [DISK_BUDGET_OVERRIDE_ENV]: invalid }),
        /unsigned base-10 byte count/,
      );
    }
    assert.throws(
      () => parseDiskBudgetOverride({ [DISK_BUDGET_OVERRIDE_ENV]: String(1024n ** 5n + 1n) }),
      /1 PiB safety bound/,
    );

    const dependencies = {
      ancestor: (candidate) => candidate,
      exists: () => true,
      platform: 'linux',
      realpath: (candidate) => candidate,
      stat: () => ({ dev: 1n }),
      statfs: () => ({ bavail: 100n * gib, bsize: 1n }),
    };
    const base = assertReleaseDiskCapacity({
      reighTreeBytes: 1n,
      astridTreeBytes: 1n,
      astridCheckout: '/astrid',
      tempPath: '/tmp',
      env: { [DISK_BUDGET_OVERRIDE_ENV]: '1' },
    }, dependencies);
    assert.equal(base.requiredBytes, base.calculatedBytes);

    const raised = assertReleaseDiskCapacity({
      reighTreeBytes: 1n,
      astridTreeBytes: 1n,
      astridCheckout: '/astrid',
      tempPath: '/tmp',
      env: { [DISK_BUDGET_OVERRIDE_ENV]: String(20n * gib) },
    }, dependencies);
    assert.equal(raised.requiredBytes, 20n * gib);
    assert.equal(buildSanitizedEnvironment()[DISK_BUDGET_OVERRIDE_ENV], undefined);
  });

  it('rechecks disk immediately before heavy steps and closes the TOCTOU window', () => {
    const calls = [];
    const checks = [];
    const steps = [
      { id: 'light', label: 'light', command: 'npm', args: ['--version'], cwd: REPO_ROOT },
      { id: 'dependencies', label: 'dependencies', command: 'npm', args: ['ci'], cwd: REPO_ROOT },
      { id: 'later', label: 'later', command: 'npm', args: ['test'], cwd: REPO_ROOT },
    ];
    assert.throws(
      () => executeSteps(steps, (command, args) => {
        calls.push([command, ...args]);
        return { status: 0 };
      }, {
        diskRecheck: (step) => {
          checks.push(step.id);
          if (step.id === 'dependencies') throw new Error('capacity stolen after initial preflight');
        },
      }),
      /capacity stolen/,
    );
    assert.deepEqual(checks, ['light', 'dependencies']);
    assert.deepEqual(calls, [['npm', '--version']]);

    const gib = 1024n ** 3n;
    assert.equal(HEAVY_STEP_MIN_FREE_BYTES.dependencies, 8n * gib);
    assert.deepEqual(assertHeavyStepDiskCapacity({ id: 'light' }, {
      astridCheckout: '/astrid', tempPath: '/tmp',
    }), []);
    assert.equal(ASTRID_SEPARATE_VOLUME_MIN_BYTES, 2n * gib);
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
    assert.match(plan.stdout, /disk preflight: commit-tree archive peak/);
    const plannedWorktree = plan.stdout.match(/fresh detached worktree (.+)$/m)?.[1].trim();
    assert.ok(plannedWorktree, 'plan did not disclose the isolated worktree path');
    assert.equal(existsSync(dirname(plannedWorktree)), false, 'plan created its release HOME');
  });
});
