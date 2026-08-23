import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  EXPECTED_EXTENSION_COUNT,
  EXPECTED_RUNAWAY_COUNT,
  PAIRED_RELEASE_PHASES,
  RELEASE_BRIDGE_CAPABILITY,
  REPO_ROOT,
  buildBrowserEnvironment,
  buildRunawayMigrationFixture,
  buildServerEnvironment,
  parseCliArgs,
  validateAstridReleaseBridgeSources,
} from './verify-paired-release-e2e.mjs';

describe('paired repository release E2E gate', () => {
  it('accepts only run/plan/help and exposes no skip surface', () => {
    assert.deepEqual(parseCliArgs([]), { help: false, mode: 'run' });
    assert.deepEqual(parseCliArgs(['--plan']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--dry-run']), { help: false, mode: 'plan' });
    assert.deepEqual(parseCliArgs(['--help']), { help: true, mode: 'run' });
    for (const bypass of ['--skip-browser', '--skip-migration', '--use-stub', '--no-restore']) {
      assert.throws(() => parseCliArgs([bypass]), /unknown option/);
    }
  });

  it('rejects the old pre-auth pin and accepts the complete release capability', () => {
    assert.throws(
      () => validateAstridReleaseBridgeSources({
        dispatchSource: "parser.add_argument('--port')",
        serverSource: 'server.serve_forever()',
      }),
      new RegExp(`lacks ${RELEASE_BRIDGE_CAPABILITY.replaceAll('.', '\\.')}`),
    );

    assert.deepEqual(validateAstridReleaseBridgeSources({
      dispatchSource: [
        "parser.add_argument('--release-mode', dest='release_mode')",
        "token = os.environ.get('ASTRID_BRIDGE_TOKEN')",
        'create_server(require_auth=release_mode)',
      ].join('\n'),
      serverSource: [
        "supplied = self.headers.get('Authorization')",
        "version = self.headers.get('X-Astrid-Bridge-Version')",
        'if self.server.require_auth: validate()',
      ].join('\n'),
    }), { capability: RELEASE_BRIDGE_CAPABILITY });
  });

  it('keeps the token in server environments and out of browser workers', () => {
    const previous = process.env.ASTRID_BRIDGE_TOKEN;
    process.env.ASTRID_BRIDGE_TOKEN = 'ambient-secret';
    try {
      const browser = buildBrowserEnvironment({
        baseUrl: 'http://127.0.0.1:21000',
        evidenceDir: '/tmp/paired-evidence',
        phase: 'first',
      });
      assert.equal(browser.ASTRID_BRIDGE_TOKEN, undefined);
      assert.equal(browser.OPENAI_API_KEY, undefined);

      const server = buildServerEnvironment({
        home: '/tmp/paired-home',
        projectsRoot: '/tmp/paired-projects',
        pythonPath: '/tmp/paired-astrid',
        bridgePort: 21001,
        token: 'generated-server-secret',
      });
      assert.equal(server.ASTRID_BRIDGE_TOKEN, 'generated-server-secret');
      assert.equal(server.OPENAI_API_KEY, undefined);
    } finally {
      if (previous === undefined) delete process.env.ASTRID_BRIDGE_TOKEN;
      else process.env.ASTRID_BRIDGE_TOKEN = previous;
    }
  });

  it('keeps every required phase and fixed acceptance count in code ownership', () => {
    assert.equal(EXPECTED_EXTENSION_COUNT, 13);
    assert.equal(EXPECTED_RUNAWAY_COUNT, 566);
    assert.deepEqual(PAIRED_RELEASE_PHASES, [
      'exact-ref capability preflight',
      'clean archive materialization',
      'locked Reigh dependency install and production build',
      'Astrid database initialization and pre-migration backup',
      'Runaway migration first apply and idempotent second apply',
      'authenticated Astrid release bridge plus built Reigh preview smoke',
      'development-only local-editor paired acceptance (current production bridge limitation)',
      'Reigh and Astrid restart plus persisted-state/render acceptance',
      'backup restore, second restart, and rollback-state acceptance',
      'immutable receipt and artifact hash index publication',
    ]);
  });

  it('builds a hermetic deterministic Runaway migration input', () => {
    const first = buildRunawayMigrationFixture();
    const second = buildRunawayMigrationFixture();
    assert.deepEqual(first, second);
    assert.equal(first.manifest.transition_count, EXPECTED_RUNAWAY_COUNT);
    assert.equal(first.manifest.transitions.length, EXPECTED_RUNAWAY_COUNT);
    assert.equal(first.manifest.segments[0].transition_count, EXPECTED_RUNAWAY_COUNT);
    assert.equal(first.manifest.transitions[0].frame, 0);
    assert.equal(first.manifest.transitions.at(-1).frame, (EXPECTED_RUNAWAY_COUNT - 1) * 10);
    assert.ok(
      first.audioReactive.timebase.range_end_frame
      > first.manifest.transitions.at(-1).frame,
    );
    assert.throws(() => buildRunawayMigrationFixture(0), /positive integer/);
  });

  it('prints an honest non-executing plan and documents the production boundary', () => {
    const script = `${REPO_ROOT}/scripts/release/verify-paired-release-e2e.mjs`;
    const plan = spawnSync(process.execPath, [script, '--plan'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /PLAN ONLY/);
    assert.match(plan.stdout, /no phase is optional/);
    assert.match(plan.stdout, /development-only local-editor paired acceptance/);
    assert.match(plan.stdout, new RegExp(RELEASE_BRIDGE_CAPABILITY.replaceAll('.', '\\.')));

    const source = readFileSync(script, 'utf8');
    assert.doesNotMatch(source, /shell\s*:\s*true/);
    assert.doesNotMatch(source, /execSync|execFileSync/);
    assert.match(source, /git', \['archive'/);
    assert.match(source, /npm-userconfig/);
    assert.match(source, /npm-globalconfig/);
    assert.doesNotMatch(source, /NPM_CONFIG_USERCONFIG: '\/dev\/null'/);
    assert.match(source, /freezeArtifacts\(evidenceRoot\)/);
  });
});
