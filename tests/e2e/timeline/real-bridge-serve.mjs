#!/usr/bin/env node
/**
 * B5 harness: boot the REAL Astrid bridge (`astrid serve`) against a temp
 * seeded project root, for the Playwright CAS/watchdog/draft specs.
 *
 *   ASTRID_CHECKOUT    clean checkout at the release pin (default: the local
 *                      Astrid-extension-integration worktree)
 *   ASTRID_PYTHON      Python used for `<python> -m astrid` (default: python3)
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

const PORT = Number(process.env.ASTRID_BRIDGE_PORT ?? 17334);
const PINNED_ASTRID_SHA = 'bebfb913252827a581b791adb224db61816c00ef';
const DEFAULT_ASTRID_CHECKOUT = '/Users/peteromalley/Documents/reigh-workspace/Astrid-extension-integration';
const astrid = resolveAstridCommand();
astrid.env = resolveReleaseRuntimeEnv(astrid);
const OWNS_SEED_ROOT = !process.env.ASTRID_SEED_ROOT;
const SEED_ROOT = process.env.ASTRID_SEED_ROOT ? resolve(process.env.ASTRID_SEED_ROOT) : mkdtempSync(join(tmpdir(), 'astrid-real-bridge-'));
// B1 identity-first: the canonical id must be a UUID for the bridge's save validation.
const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
const TIMELINE_ULID = '01JM4K5N7P0000000000000017';
const PROJECT = { slug: 'demo-project', name: 'Demo Project' };
const BRIDGE_TOKEN = process.env.ASTRID_BRIDGE_TOKEN ?? randomBytes(32).toString('hex');

function seed() {
  const projectDir = join(SEED_ROOT, PROJECT.slug);
  mkdirSync(join(projectDir, 'timelines', TIMELINE_ULID), { recursive: true });
  writeFileSync(join(projectDir, 'project.json'), JSON.stringify({
    created_at: '2026-08-11T00:00:00Z',
    name: PROJECT.name,
    schema_version: 1,
    slug: PROJECT.slug,
    updated_at: '2026-08-11T00:00:00Z',
    default_timeline_id: TIMELINE_ID,
  }, null, 2));

  const home = join(projectDir, 'timelines', TIMELINE_ULID);
  writeFileSync(join(home, 'display.json'), JSON.stringify({
    schema_version: 1,
    slug: 'demo-timeline',
    name: 'Demo Timeline',
    is_default: true,
  }, null, 2));
  writeFileSync(join(home, 'assembly.identity.json'), JSON.stringify({
    timeline_id: TIMELINE_ID,
    provenance: 'created',
    backend: 'local_fs',
  }, null, 2));
  writeFileSync(join(home, 'assembly.json'), JSON.stringify({
    output: { resolution: '1920x1080', fps: 24, file: 'output.mp4' },
    clips: [
      { id: 'clip-1', track: 'V1', at: 0, clipType: 'media', hold: 4, asset: 'example-image1.jpg' },
    ],
    tracks: [
      { id: 'V1', kind: 'visual', label: 'Video' },
      { id: 'V2', kind: 'visual', label: 'Video 2' },
      { id: 'A1', kind: 'audio', label: 'Audio' },
    ],
  }, null, 2));

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
      env: process.env,
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

  const python = process.env.ASTRID_PYTHON ?? 'python3';
  const env = {
    ...process.env,
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
  const config = {
    output: { resolution: '1920x1080', fps: 24, file: 'output.mp4' },
    clips: [
      { id: 'clip-1', track: 'V1', at: 0, clipType: 'media', hold: 4, asset: 'example-image1.jpg' },
    ],
    tracks: [
      { id: 'V1', kind: 'visual', label: 'Video' },
      { id: 'V2', kind: 'visual', label: 'Video 2' },
      { id: 'A1', kind: 'audio', label: 'Audio' },
    ],
  };
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
  const registry = {
    assets: {
      'example-image1.jpg': {
        file: 'example-image1.jpg',
        media_id: imported.id,
        content_sha256: imported.content_hash,
        type: imported.mime_type,
      },
    },
  };
  runAstridJson(
    astrid,
    ['timelines', 'create', 'demo-timeline', '--project', PROJECT.slug,
      '--name', 'Demo Timeline', '--default',
      '--config', JSON.stringify(config), '--registry', JSON.stringify(registry)],
    cliEnv,
    'timeline registration',
  );
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

const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
const tokenFile = process.env.ASTRID_REQUEST_TOKEN_FILE || '/tmp/astrid-real-bridge.token';
const metadataFile = process.env.ASTRID_BRIDGE_METADATA_FILE || '/tmp/astrid-real-bridge.metadata.json';
writeFileSync(pidFile, String(child.pid));
const metadata = {
  astrid_provenance: astrid.provenance,
  projects_root: SEED_ROOT,
  bridge_origin: `http://127.0.0.1:${PORT}`,
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
