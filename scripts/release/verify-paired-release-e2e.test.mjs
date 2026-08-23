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
  RUNAWAY_RELEASE_FIXTURE_HASHES,
  TIMELINE_SCHEMA_DISTRIBUTION_VERSION,
  buildBrowserEnvironment,
  buildServerEnvironment,
  parseCliArgs,
  requireFullCommitPin,
  validateTimelineSchemaInstallation,
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

  it('requires exact full commit pins', () => {
    const full = 'a'.repeat(40);
    assert.equal(requireFullCommitPin(full, 'test pin'), full);
    assert.throws(() => requireFullCommitPin('a'.repeat(12), 'test pin'), /full 40-character/);
    assert.throws(() => requireFullCommitPin('A'.repeat(40), 'test pin'), /full 40-character/);
  });

  it('binds the shared timeline schema to the installed venv and pinned Astrid source', () => {
    const expectedSchemaSha256 = 'b'.repeat(64);
    assert.equal(TIMELINE_SCHEMA_DISTRIBUTION_VERSION, '0.0.2');
    assert.deepEqual(validateTimelineSchemaInstallation({
      probe: {
        astridModulePath: '/tmp/astrid/astrid/__init__.py',
        distributionVersion: '0.0.2',
        modulePath: '/tmp/venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py',
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), {
      astridModulePath: '/tmp/astrid/astrid/__init__.py',
      distributionVersion: '0.0.2',
      modulePath: '/tmp/venv/lib/python3.11/site-packages/banodoco_timeline_schema/__init__.py',
      schemaSha256: expectedSchemaSha256,
    });
    assert.throws(() => validateTimelineSchemaInstallation({
      probe: {
        astridModulePath: '/developer/astrid/__init__.py',
        distributionVersion: '0.0.2',
        modulePath: '/developer/site-packages/banodoco_timeline_schema/__init__.py',
        schemaSha256: expectedSchemaSha256,
      },
      astridSnapshot: '/tmp/astrid',
      expectedSchemaSha256,
      venv: '/tmp/venv',
    }), /outside its pinned runtime root/);
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
        browserExecutable: process.execPath,
        browserRoot: '/tmp',
        evidenceDir: '/tmp/paired-evidence',
        phase: 'first',
      });
      assert.equal(browser.ASTRID_BRIDGE_TOKEN, undefined);
      assert.equal(browser.OPENAI_API_KEY, undefined);
      assert.equal(browser.PLAYWRIGHT_CHROMIUM_EXECUTABLE, process.execPath);
      assert.equal(browser.PLAYWRIGHT_BROWSERS_PATH, '/tmp');

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
      'locked Reigh, Playwright, and paired Python provisioning plus production build',
      'Astrid database initialization and pre-migration backup',
      'Runaway migration first apply and idempotent second apply',
      'authenticated Astrid release bridge plus built Reigh preview smoke',
      'development-only local-editor paired acceptance (current production bridge limitation)',
      'Reigh and Astrid restart plus persisted-state/render acceptance',
      'backup restore, second restart, and rollback-state acceptance',
      'immutable receipt and artifact hash index publication',
    ]);
  });

  it('pins the independently owned canonical Runaway release inputs', () => {
    assert.deepEqual(RUNAWAY_RELEASE_FIXTURE_HASHES, {
      'audio-reactive-v1.json': 'd7925d72b52180e206a2511a5d30cf1638c7007a962fd57d8a6eb9ffb10af886',
      'timing-manifest.json': '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
    });
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
    assert.match(source, /requirements\/runtime\.lock/);
    assert.match(source, /--require-hashes/);
    assert.match(source, /requireCleanWorktree/);
    assert.match(source, /render-full-decode\.log/);
    assert.match(source, /playwright-browser-install\.log/);
    assert.match(source, /PLAYWRIGHT_BROWSERS_PATH/);
    assert.match(source, /--only-binary=:all:/);
    assert.match(source, /paired-python-build-tools\.lock/);
    assert.match(source, /timeline-schema-source-snapshot\.json/);
    assert.match(source, /--no-build-isolation/);
    assert.match(source, /pip', '--isolated', 'list', '--format=json/);
    assert.match(source, /astrid-runtime-packages-normalized\.json/);
    assert.doesNotMatch(source, /pip', 'freeze'/);
    assert.match(source, /astrid-restored-logical-snapshot\.json/);
    assert.match(source, /astrid-restored-media-snapshot\.json/);
    assert.match(source, /Promise\.allSettled/);
    assert.match(source, /inspectCandidateController/);
    assert.match(source, /reighControllerHead: pins\.reighControllerHead/);
    assert.match(source, /archiveCommit\(REPO_ROOT, pins\.reighCommit/);
    assert.ok(source.indexOf("'receipt.json'") < source.indexOf("'artifact-index.json'"));
  });
});
