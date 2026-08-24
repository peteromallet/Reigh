#!/usr/bin/env node
/**
 * B5 harness: boot the REAL Astrid bridge (`astrid serve`) against a temp
 * seeded project root, for the Playwright CAS/watchdog/draft specs.
 *
 *   ASTRID_SERVE_BIN   astrid executable (default: resolves `astrid` on PATH,
 *                      or `~/.pyenv/versions/3.11.11/bin/astrid`)
 *   ASTRID_BRIDGE_PORT port to listen on (default 17334)
 *   ASTRID_SEED_ROOT   reuse a pre-seeded projects root (default: temp dir)
 *
 * The seeded project mirrors the stub's `demo-project/demo-timeline` so the
 * existing `tests/e2e/timeline/support.ts` URLs work against the real bridge.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.ASTRID_BRIDGE_PORT ?? 17334);
const SEED_ROOT = process.env.ASTRID_SEED_ROOT ? resolve(process.env.ASTRID_SEED_ROOT) : mkdtempSync(join(tmpdir(), 'astrid-real-bridge-'));
// B1 identity-first: the canonical id must be a UUID for the bridge's save validation.
const TIMELINE_ID = '11111111-1111-1111-1111-111111111111';
const TIMELINE_ULID = '01JM4K5N7P0000000000000017';
const PROJECT = { slug: 'demo-project', name: 'Demo Project' };

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

function resolveAstridBin() {
  if (process.env.ASTRID_SERVE_BIN) {
    return resolve(process.env.ASTRID_SERVE_BIN);
  }
  const candidates = [
    'astrid',
    resolve(process.env.HOME ?? '', '.pyenv/versions/3.11.11/bin/astrid'),
  ];
  for (const candidate of candidates) {
    try {
      const result = spawnSyncSafe(candidate, ['--version']);
      if (result !== null) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return candidates[0];
}

function spawnSyncSafe(bin, args) {
  const result = spawnSync(bin, args, { stdio: 'pipe', env: process.env });
  return result.status === 0 ? result : null;
}

// The bridge discovers projects/timelines from its SQLite registry, not the
// filesystem layout — register the seeded project through the astrid CLI
// (which opens and closes its own writer BEFORE `serve` takes the exclusive
// lock), otherwise every route answers project_not_found.
function registerInBridgeRegistry(bin) {
  const cliEnv = { ...process.env, ASTRID_PROJECTS_ROOT: SEED_ROOT };
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
    [bin, ['projects', 'create', PROJECT.slug, '--name', PROJECT.name]],
    [bin, ['timelines', 'create', 'demo-timeline', '--project', PROJECT.slug,
      '--name', 'Demo Timeline', '--default',
      '--config', JSON.stringify(config), '--registry', '{"assets":{}}']],
  ];
  for (const [cmd, args] of steps) {
    const result = spawnSync(cmd, args, { stdio: 'pipe', env: cliEnv });
    if (result.status !== 0) {
      console.error(`[real-bridge] registry step failed: ${cmd} ${args.join(' ')}`);
      console.error(result.stderr?.toString() ?? '');
      process.exit(1);
    }
  }
}

seed();
const bin = process.env.ASTRID_SERVE_BIN || 'astrid';

console.error(`[real-bridge] seeding ${SEED_ROOT}`);
registerInBridgeRegistry(bin);
console.error(`[real-bridge] spawning ${bin} serve --projects-root ${SEED_ROOT} --port ${PORT}`);
const child = spawn(bin, ['serve', '--projects-root', SEED_ROOT, '--port', String(PORT)], {
  stdio: 'inherit',
  env: process.env,
});

const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
const tokenFile = process.env.ASTRID_REQUEST_TOKEN_FILE || '/tmp/astrid-real-bridge.token';
writeFileSync(pidFile, String(child.pid));

// Serve mints the per-boot mutation token into <root>/.astrid/request-token
// (mode 0600). The vite proxy injects it server-side; direct API callers
// (specs hitting the bridge origin) read it here instead.
function publishToken(attempt = 0) {
  try {
    writeFileSync(tokenFile, readFileSync(join(SEED_ROOT, '.astrid', 'request-token'), 'utf8'));
    console.error(`[real-bridge] request token published to ${tokenFile}`);
  } catch {
    if (attempt < 20) setTimeout(() => publishToken(attempt + 1), 250);
    else console.error('[real-bridge] request token never appeared; mutations will 403');
  }
}
publishToken();

child.on('exit', () => {
  try {
    rmSync(pidFile, { force: true });
    rmSync(tokenFile, { force: true });
  } catch {
    // pid/token file best-effort
  }
});


process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
