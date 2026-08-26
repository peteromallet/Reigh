#!/usr/bin/env node
/**
 * B5 harness: boot the REAL Astrid bridge (`astrid serve`) against a temp
 * seeded project root, for the Playwright CAS/watchdog/draft specs.
 *
 *   ASTRID_CHECKOUT    clean checkout at the release pin (default: the local
 *                      Astrid-extension-integration worktree)
 *   ASTRID_PYTHON      absolute pinned Python executable; otherwise the exact
 *                      release interpreter is resolved from PATH
 *   ASTRID_SERVE_BIN   explicit executable override (not provenance-checked)
 *   ASTRID_NODE_EXECUTABLE
 *                      absolute Node 20.19.4 executable override; otherwise
 *                      the exact pinned runtime is resolved from PATH
 *   ASTRID_REMOTION_PROJECT_DIR
 *                      Remotion project for an explicit binary override
 *   ASTRID_TIMELINE_SCHEMA_PYTHONPATH
 *                      timeline-schema Python package root (default: Reigh vendor)
 *   ASTRID_BRIDGE_PORT port to listen on (default 17334)
 *   ASTRID_SEED_ROOT   reuse a pre-seeded projects root (default: temp dir)
 *   ASTRID_BRIDGE_METADATA_FILE provenance receipt path (default: /tmp)
 *
 * The seeded project mirrors the stub's `demo-project/demo-timeline` so the
 * existing `tests/e2e/timeline/support.ts` URLs work against the real bridge.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { resolvePinnedNodeExecutable } from '../../../scripts/release/pinned-node-runtime.mjs';
import { resolvePinnedPythonExecutable } from '../../../scripts/release/pinned-python-runtime.mjs';
import { createBridgeReadinessAdapter } from './real-bridge-readiness.mjs';

const PORT = Number(process.env.ASTRID_BRIDGE_PORT ?? 17334);
const READY_PORT = Number(process.env.ASTRID_BRIDGE_READY_PORT ?? 0);
if (!Number.isInteger(READY_PORT) || READY_PORT < 1 || READY_PORT > 65_535) {
  throw new Error('ASTRID_BRIDGE_READY_PORT must be a valid separately allocated TCP port');
}
if (READY_PORT === PORT) throw new Error('ASTRID_BRIDGE_READY_PORT must be distinct from ASTRID_BRIDGE_PORT');
const PINNED_ASTRID_SHA = '9d714649f2f658ad508dbb4ead8eaf15bff2149b';
const DEFAULT_ASTRID_CHECKOUT = '/Users/peteromalley/Documents/reigh-workspace/Astrid-extension-integration';
const astrid = resolveAstridCommand();
astrid.env = resolveReleaseRuntimeEnv(astrid);
const OWNS_SEED_ROOT = !process.env.ASTRID_SEED_ROOT;
const SEED_ROOT = process.env.ASTRID_SEED_ROOT ? resolve(process.env.ASTRID_SEED_ROOT) : mkdtempSync(join(tmpdir(), 'astrid-real-bridge-'));
// B1 identity-first: the canonical id must be a UUID for the bridge's save validation.
const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
const TIMELINE_ULID = '01JM4K5N7P0000000000000017';
const PROJECT = { slug: 'demo-project', name: 'Demo Project' };
const OTHER_TIMELINE_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_TIMELINE_ULID = '01JM4K5N7P0000000000000018';
const OTHER_PROJECT = { slug: 'other-project', name: 'Other Project' };
const RUNAWAY_RUN_ID = '01j5realbridgepage000000000000';
const BRIDGE_TOKEN = process.env.ASTRID_BRIDGE_TOKEN ?? randomBytes(32).toString('hex');

// B8-T5a: ONE builder for the demo `{config, registry}` pair so the on-disk
// assembly.json mirror written by seed() and the SQLite CAS document written
// by registerInBridgeRegistry() can never diverge. The generation/variant
// asset entries give the DOCUMENT its generation references (render/duplicate
// reads); they do NOT create gallery rows and never satisfy promote-primary.
const BRIDGE_SHOT_A = Object.freeze({
  shotId: 'shot-bridge-a',
  trackId: 'V1',
  clipIds: Object.freeze(['clip-1', 'clip-2']),
  mode: 'images',
  name: 'Bridge Shot A',
});
const BRIDGE_GENERATION_ID = '01j5genbridgea0000000000000a';
const BRIDGE_VARIANT_PRIMARY_ID = '01j5varbridgeapri00000000000';
const BRIDGE_VARIANT_ALT_ID = '01j5varbridgeaalt00000000000';

function demoDocument(imported) {
  const managed = imported ? {
    media_id: imported.id,
    content_sha256: imported.content_hash,
    type: imported.mime_type,
  } : {};
  const config = {
    output: { resolution: '1920x1080', fps: 24, file: 'output.mp4' },
    clips: [
      { id: 'clip-1', track: 'V1', at: 0, clipType: 'media', hold: 4, asset: 'example-image1.jpg' },
      { id: 'clip-2', track: 'V1', at: 4, clipType: 'media', hold: 4, asset: 'gen-shot-a-primary' },
    ],
    tracks: [
      { id: 'V1', kind: 'visual', label: 'Video' },
      { id: 'V2', kind: 'visual', label: 'Video 2' },
      { id: 'A1', kind: 'audio', label: 'Audio' },
    ],
    pinnedShotGroups: [{ ...BRIDGE_SHOT_A, clipIds: [...BRIDGE_SHOT_A.clipIds] }],
  };
  const registry = {
    assets: {
      'example-image1.jpg': {
        file: 'example-image1.jpg',
        ...managed,
      },
      'gen-shot-a-primary': {
        file: 'example-image1.jpg',
        ...managed,
        generationId: BRIDGE_GENERATION_ID,
        variantId: BRIDGE_VARIANT_PRIMARY_ID,
        origin: 'refreshable-from-generation',
      },
      'gen-shot-a-alt': {
        file: 'example-image1.jpg',
        ...managed,
        generationId: BRIDGE_GENERATION_ID,
        variantId: BRIDGE_VARIANT_ALT_ID,
        origin: 'refreshable-from-generation',
      },
    },
  };
  return { config, registry };
}

function seed() {
  // Lockstep mirror: same builder as the SQLite registration (managed media
  // fields are runtime-derived and only exist post-import, so the mirror is
  // built pre-import; the extension itself is byte-identical).
  const { config } = demoDocument(null);

  const writeProject = (project, timeline, timelineUlid, timelineSlug, timelineName) => {
    const projectDir = join(SEED_ROOT, project.slug);
    mkdirSync(join(projectDir, 'timelines', timelineUlid), { recursive: true });
    writeFileSync(join(projectDir, 'project.json'), JSON.stringify({
      created_at: '2026-08-11T00:00:00Z',
      name: project.name,
      schema_version: 1,
      slug: project.slug,
      updated_at: '2026-08-11T00:00:00Z',
      default_timeline_id: timeline,
    }, null, 2));

    const home = join(projectDir, 'timelines', timelineUlid);
    writeFileSync(join(home, 'display.json'), JSON.stringify({
      schema_version: 1,
      slug: timelineSlug,
      name: timelineName,
      is_default: true,
    }, null, 2));
    writeFileSync(join(home, 'assembly.identity.json'), JSON.stringify({
      timeline_id: timeline,
      provenance: 'created',
      backend: 'local_fs',
    }, null, 2));
    writeFileSync(join(home, 'assembly.json'), JSON.stringify(config, null, 2));
  };

  writeProject(PROJECT, TIMELINE_ID, TIMELINE_ULID, 'demo-timeline', 'Demo Timeline');
  writeProject(OTHER_PROJECT, OTHER_TIMELINE_ID, OTHER_TIMELINE_ULID, 'other-timeline', 'Other Timeline');

  const projectDir = join(SEED_ROOT, PROJECT.slug);
  const sourcesDir = join(projectDir, 'sources');
  mkdirSync(sourcesDir, { recursive: true });
  const sourcePath = join(sourcesDir, 'example-image1.jpg');
  writeFileSync(sourcePath, Buffer.from(
    // 1x1 red JPEG so asset serving returns real bytes.
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AV//2Q==',
    'base64',
  ));
  return { sourcePath };
}

function commandSucceeded(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', env: process.env, ...options });
  return result.status === 0 ? result : null;
}

function requireAbsolutePath(raw, label) {
  if (typeof raw !== 'string' || !raw.trim() || !isAbsolute(raw)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(raw);
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} is missing or not a file: ${path}`);
  }
  return path;
}

function requireDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is missing or not a directory: ${path}`);
  }
  return path;
}

function resolveReleaseRuntimeEnv(command) {
  const nodeExecutable = resolvePinnedNodeExecutable();

  const defaultProjectDir = command.checkout ? join(command.checkout, 'remotion') : null;
  const configuredProjectDir = process.env.ASTRID_REMOTION_PROJECT_DIR ?? defaultProjectDir;
  if (!configuredProjectDir) {
    throw new Error(
      'ASTRID_SERVE_BIN requires ASTRID_REMOTION_PROJECT_DIR or ASTRID_CHECKOUT '
      + 'so the locked Remotion runtime can be validated',
    );
  }
  const remotionProjectDir = requireAbsolutePath(
    configuredProjectDir,
    'ASTRID_REMOTION_PROJECT_DIR',
  );
  requireDirectory(remotionProjectDir, 'ASTRID_REMOTION_PROJECT_DIR');
  requireFile(join(remotionProjectDir, 'package.json'), 'Remotion package.json');
  requireFile(
    join(remotionProjectDir, 'node_modules', '@remotion', 'cli', 'remotion-cli.js'),
    'locked Remotion CLI',
  );
  for (const packageName of ['timeline-composition', 'timeline-schema', 'timeline-theme-2rp']) {
    requireFile(
      join(remotionProjectDir, 'node_modules', '@banodoco', packageName, 'package.json'),
      `Remotion package @banodoco/${packageName}`,
    );
  }

  const schemaRoot = requireAbsolutePath(
    process.env.ASTRID_TIMELINE_SCHEMA_PYTHONPATH
      ?? join(process.cwd(), 'vendor', 'timeline-schema', 'python'),
    'ASTRID_TIMELINE_SCHEMA_PYTHONPATH',
  );
  requireDirectory(schemaRoot, 'ASTRID_TIMELINE_SCHEMA_PYTHONPATH');
  const schemaPackage = join(schemaRoot, 'banodoco_timeline_schema');
  for (const fileName of [
    '__init__.py',
    'generated.py',
    'materialize.py',
    'theme.py',
    'timeline.schema.json',
    'validate.py',
  ]) {
    requireFile(join(schemaPackage, fileName), `timeline schema file ${fileName}`);
  }

  return {
    ...command.env,
    ASTRID_NODE_EXECUTABLE: nodeExecutable,
    ASTRID_REMOTION_PROJECT_DIR: remotionProjectDir,
    ASTRID_TIMELINE_SCHEMA_PYTHONPATH: schemaRoot,
    PATH: [dirname(nodeExecutable), command.env.PATH].filter(Boolean).join(delimiter),
  };
}

function resolveAstridCommand() {
  const python = resolvePinnedPythonExecutable();
  if (process.env.ASTRID_SERVE_BIN) {
    const bin = resolve(process.env.ASTRID_SERVE_BIN);
    const result = commandSucceeded(bin, ['--version']);
    if (!result) {
      throw new Error(`ASTRID_SERVE_BIN is not runnable: ${bin}`);
    }
    return {
      command: bin,
      prefix: [],
      cwd: undefined,
      env: { ...process.env, ASTRID_PYTHON: python },
      checkout: process.env.ASTRID_CHECKOUT ? resolve(process.env.ASTRID_CHECKOUT) : null,
      provenance: `binary:${bin}`,
      pinVerified: false,
    };
  }

  const checkout = resolve(process.env.ASTRID_CHECKOUT ?? DEFAULT_ASTRID_CHECKOUT);
  if (!existsSync(join(checkout, '.git'))) {
    throw new Error(
      `Pinned Astrid checkout is unavailable at ${checkout}; set ASTRID_CHECKOUT or ASTRID_SERVE_BIN explicitly`,
    );
  }
  const head = commandSucceeded('git', ['rev-parse', 'HEAD'], { cwd: checkout });
  const sha = head?.stdout?.toString().trim();
  if (sha !== PINNED_ASTRID_SHA) {
    throw new Error(`Astrid checkout HEAD ${sha ?? '<unreadable>'} does not match pinned ${PINNED_ASTRID_SHA}`);
  }
  const status = commandSucceeded('git', ['status', '--porcelain'], { cwd: checkout });
  if (!status || status.stdout.toString().trim() !== '') {
    throw new Error(`Pinned Astrid checkout must be clean: ${checkout}`);
  }

  const env = {
    ...process.env,
    ASTRID_PYTHON: python,
    PYTHONPATH: [checkout, process.env.PYTHONPATH].filter(Boolean).join(':'),
  };
  const runnable = commandSucceeded(python, ['-m', 'astrid', '--version'], { cwd: checkout, env });
  if (!runnable) {
    throw new Error(`Pinned Astrid is not runnable with ${python} -m astrid from ${checkout}`);
  }
  return {
    command: python,
    prefix: ['-m', 'astrid'],
    cwd: checkout,
    env,
    checkout,
    provenance: `git:${sha}`,
    pinVerified: true,
  };
}

// The bridge discovers projects/timelines from its SQLite registry, not the
// filesystem layout — register the seeded project through the astrid CLI
// (which opens and closes its own writer BEFORE `serve` takes the exclusive
// lock), otherwise every route answers project_not_found.
function runAstridSync(astrid, args, env) {
  return spawnSync(astrid.command, [...astrid.prefix, ...args], {
    stdio: 'pipe',
    cwd: astrid.cwd,
    env,
  });
}

function runAstridJson(astrid, args, env, label) {
  const result = runAstridSync(astrid, [...args, '--json'], env);
  if (result.status !== 0) {
    throw new Error(
      `[real-bridge] ${label} failed: ${[...astrid.prefix, ...args].join(' ')}\n`
      + (result.stderr?.toString() ?? ''),
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout.toString());
  } catch (error) {
    throw new Error(`[real-bridge] ${label} returned invalid JSON`, { cause: error });
  }
  if (envelope?.ok !== true || !envelope.data || typeof envelope.data !== 'object') {
    throw new Error(
      `[real-bridge] ${label} returned an unsuccessful result: ${JSON.stringify(envelope)}`,
    );
  }
  return envelope.data;
}

function registerInBridgeRegistry(astrid, { sourcePath }) {
  const cliEnv = { ...astrid.env, ASTRID_PROJECTS_ROOT: SEED_ROOT };
  // B8-T5a: the SQLite bridge document is created HERE (not by seed()), so
  // the clip-2 / pinnedShotGroups / generation-variant extension travels in
  // these registration payloads via the same demoDocument() helper that
  // builds seed()'s assembly.json mirror.
  runAstridJson(astrid, ['projects', 'create', PROJECT.slug, '--name', PROJECT.name], cliEnv, 'project registration');
  const imported = runAstridJson(
    astrid,
    ['media', 'import', sourcePath, '--project', PROJECT.slug],
    cliEnv,
    'managed media import',
  );
  if (
    typeof imported.id !== 'string'
    || typeof imported.content_hash !== 'string'
    || typeof imported.mime_type !== 'string'
  ) {
    throw new Error(`[real-bridge] managed media import returned incomplete data: ${JSON.stringify(imported)}`);
  }
  const { config, registry } = demoDocument(imported);
  runAstridJson(
    astrid,
    ['timelines', 'create', 'demo-timeline', '--project', PROJECT.slug,
      '--name', 'Demo Timeline', '--default',
      '--config', JSON.stringify(config), '--registry', JSON.stringify(registry)],
    cliEnv,
    'timeline registration',
  );
  runAstridJson(
    astrid,
    ['projects', 'create', OTHER_PROJECT.slug, '--name', OTHER_PROJECT.name],
    cliEnv,
    'cross-project registration',
  );
  runAstridJson(
    astrid,
    ['timelines', 'create', 'other-timeline', '--project', OTHER_PROJECT.slug,
      '--name', 'Other Timeline', '--default',
      '--config', JSON.stringify(config), '--registry', JSON.stringify({ assets: {} })],
    cliEnv,
    'cross-project timeline registration',
  );
}

function seedRunawayTransitions(astrid) {
  const script = `
import os
from astrid.core.events.service import EventAppendService
from astrid.core.receipts.service import ReceiptService
from astrid.core.repositories.runs import RunRepository
from astrid.core.store.uow import UnitOfWork
from astrid.packs import compose_standard_bridge

root = os.environ['ASTRID_PROJECTS_ROOT']
composition = compose_standard_bridge(root)
try:
    with composition.writer.read_only_connection() as conn:
        project = conn.execute(
            'SELECT id FROM projects WHERE slug = ?', ('demo-project',)
        ).fetchone()
    if project is None:
        raise RuntimeError('demo-project was not registered before Runaway seeding')
    project_id = str(project[0])
    runs = RunRepository(
        events=EventAppendService(composition.registry),
        receipts=ReceiptService(),
    )
    transitions = [
        {
            'ordinal': ordinal,
            'start_ms': ordinal * 20,
            'duration_ms': 20,
            'prompt': f'real bridge transition {ordinal}',
            'metadata': {'frame': ordinal + 1},
        }
        for ordinal in range(5)
    ]
    def seed(uow):
        runs.create(
            uow,
            project_id=project_id,
            run_id='${RUNAWAY_RUN_ID}',
            children=[],
            evidence=[],
            idempotency_key='real-bridge:runaway:run',
            kind='runaway:timing-v1',
            title='Real bridge pagination',
            input={},
            created_at='2026-08-11T00:00:00Z',
        )
        composition.runaway.create(
            uow,
            project_id=project_id,
            run_id='${RUNAWAY_RUN_ID}',
            transitions=transitions,
            idempotency_key='real-bridge:runaway:create',
            created_at='2026-08-11T00:00:00Z',
        )
    UnitOfWork(composition.writer).run(seed)
finally:
    composition.close()
`;
  const env = { ...astrid.env, ASTRID_PROJECTS_ROOT: SEED_ROOT };
  const python = env.ASTRID_PYTHON ?? astrid.command;
  const result = spawnSync(python, ['-c', script], {
    stdio: 'pipe',
    cwd: astrid.cwd,
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      `[real-bridge] Runaway pagination seed failed\n${result.stderr?.toString() ?? ''}`,
    );
  }
}

function cleanupOwnedSeedRoot() {
  try {
    if (OWNS_SEED_ROOT) rmSync(SEED_ROOT, { recursive: true, force: true });
  } catch {
    // Preserve the setup failure; cleanup is best effort for temp artifacts.
  }
}

let seedState;
try {
  seedState = seed();
  console.error(`[real-bridge] seeding ${SEED_ROOT}`);
  console.error(`[real-bridge] Astrid provenance ${astrid.provenance}`);
  registerInBridgeRegistry(astrid, seedState);
  seedRunawayTransitions(astrid);
} catch (error) {
  cleanupOwnedSeedRoot();
  throw error;
}
const serveArgs = [
  ...astrid.prefix,
  'serve',
  '--release-mode',
  '--no-open-editor',
  '--projects-root',
  SEED_ROOT,
  '--port',
  String(PORT),
];
console.error(`[real-bridge] spawning ${astrid.command} ${serveArgs.join(' ')}`);
const child = spawn(astrid.command, serveArgs, {
  stdio: 'inherit',
  cwd: astrid.cwd,
  env: { ...astrid.env, ASTRID_BRIDGE_TOKEN: BRIDGE_TOKEN },
});

const readinessAdapter = createBridgeReadinessAdapter({
  bridgePort: PORT,
  readyPort: READY_PORT,
  token: BRIDGE_TOKEN,
});
try {
  await readinessAdapter.listen();
} catch (error) {
  child.kill('SIGTERM');
  await readinessAdapter.close().catch(() => {});
  throw error;
}

const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
const tokenFile = process.env.ASTRID_REQUEST_TOKEN_FILE || '/tmp/astrid-real-bridge.token';
const metadataFile = process.env.ASTRID_BRIDGE_METADATA_FILE || '/tmp/astrid-real-bridge.metadata.json';
writeFileSync(pidFile, String(child.pid));
const metadata = {
  astrid_provenance: astrid.provenance,
  projects_root: SEED_ROOT,
  bridge_origin: `http://127.0.0.1:${PORT}`,
  bridge_ready_origin: `http://127.0.0.1:${READY_PORT}`,
  bridge_pid: child.pid,
  astrid_pin_verified: astrid.pinVerified,
};
if (astrid.pinVerified) metadata.pinned_astrid_sha = PINNED_ASTRID_SHA;
writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));

// Release mode requires an operator-supplied token and deliberately does not
// mint one on disk. Publish the harness-generated secret with owner-only
// permissions so the Vite proxy and direct API specs share the exact token
// without weakening the production server posture.
writeFileSync(tokenFile, BRIDGE_TOKEN, { mode: 0o600 });
console.error(`[real-bridge] request token published to ${tokenFile}`);

function cleanup() {
  void readinessAdapter.close().catch(() => {});
  try {
    rmSync(pidFile, { force: true });
    rmSync(tokenFile, { force: true });
    rmSync(metadataFile, { force: true });
    if (OWNS_SEED_ROOT) rmSync(SEED_ROOT, { recursive: true, force: true });
  } catch {
    // Harness-owned temp artifacts are best-effort cleanup.
  }
}

child.on('exit', (code, signal) => {
  cleanup();
  if (!process.exitCode) process.exitCode = code ?? (signal ? 1 : 0);
});


process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
