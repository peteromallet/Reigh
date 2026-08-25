#!/usr/bin/env node
/**
 * B5 harness: boot the REAL Astrid bridge (`astrid serve`) against a temp
 * seeded project root, for the Playwright CAS/watchdog/draft specs.
 *
 *   ASTRID_CHECKOUT    clean checkout at the release pin (default: the local
 *                      Astrid-extension-integration worktree)
 *   ASTRID_PYTHON      Python used for `<python> -m astrid` (default: python3)
 *   ASTRID_SERVE_BIN   explicit executable override (not provenance-checked)
 *   ASTRID_BRIDGE_PORT port to listen on (default 17334)
 *   ASTRID_SEED_ROOT   reuse a pre-seeded projects root (default: temp dir)
 *   ASTRID_BRIDGE_METADATA_FILE provenance receipt path (default: /tmp)
 *
 * The seeded project mirrors the stub's `demo-project/demo-timeline` so the
 * existing `tests/e2e/timeline/support.ts` URLs work against the real bridge.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.ASTRID_BRIDGE_PORT ?? 17334);
const PINNED_ASTRID_SHA = '8cab273448dbdcf0b52b4cfff085728a7af021d0';
const DEFAULT_ASTRID_CHECKOUT = '/Users/peteromalley/Documents/reigh-workspace/Astrid-extension-integration';
const astrid = resolveAstridCommand();
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
  writeFileSync(join(sourcesDir, 'example-image1.jpg'), Buffer.from(
    // 1x1 red JPEG so asset serving returns real bytes.
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AV//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AV//2Q==',
    'base64',
  ));
}

function commandSucceeded(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', env: process.env, ...options });
  return result.status === 0 ? result : null;
}

function resolveAstridCommand() {
  if (process.env.ASTRID_SERVE_BIN) {
    const bin = resolve(process.env.ASTRID_SERVE_BIN);
    const result = commandSucceeded(bin, ['--version']);
    if (!result) {
      throw new Error(`ASTRID_SERVE_BIN is not runnable: ${bin}`);
    }
    return { command: bin, prefix: [], cwd: undefined, env: process.env, provenance: `binary:${bin}` };
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
    provenance: `git:${sha}`,
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

function registerInBridgeRegistry(astrid) {
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
  const steps = [
    ['projects', 'create', PROJECT.slug, '--name', PROJECT.name],
    ['timelines', 'create', 'demo-timeline', '--project', PROJECT.slug,
      '--name', 'Demo Timeline', '--default',
      '--config', JSON.stringify(config), '--registry', '{"assets":{}}'],
  ];
  for (const args of steps) {
    const result = runAstridSync(astrid, args, cliEnv);
    if (result.status !== 0) {
      console.error(`[real-bridge] registry step failed: ${astrid.command} ${[...astrid.prefix, ...args].join(' ')}`);
      console.error(result.stderr?.toString() ?? '');
      process.exit(1);
    }
  }
}

seed();

console.error(`[real-bridge] seeding ${SEED_ROOT}`);
console.error(`[real-bridge] Astrid provenance ${astrid.provenance}`);
registerInBridgeRegistry(astrid);
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
writeFileSync(metadataFile, JSON.stringify({
  astrid_provenance: astrid.provenance,
  pinned_astrid_sha: PINNED_ASTRID_SHA,
  projects_root: SEED_ROOT,
  bridge_origin: `http://127.0.0.1:${PORT}`,
  bridge_pid: child.pid,
}, null, 2));

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
