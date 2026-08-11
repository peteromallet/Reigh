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
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  // Avoid importing child_process sync just for probing; the serve spawn below
  // is async and the binary probe is best-effort.
  return null;
}

seed();
const bin = process.env.ASTRID_SERVE_BIN || 'astrid';

console.error(`[real-bridge] seeding ${SEED_ROOT}`);
console.error(`[real-bridge] spawning ${bin} serve --projects-root ${SEED_ROOT} --port ${PORT}`);
const child = spawn(bin, ['serve', '--projects-root', SEED_ROOT, '--port', String(PORT)], {
  stdio: 'inherit',
  env: process.env,
});

const pidFile = process.env.ASTRID_BRIDGE_PID_FILE || '/tmp/astrid-real-bridge.pid';
writeFileSync(pidFile, String(child.pid));
child.on('exit', () => {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // pid file best-effort
  }
});

child.on('exit', (code) => {
  if (process.env.ASTRID_SEED_ROOT === undefined) {
    rmSync(SEED_ROOT, { recursive: true, force: true });
  }
  process.exit(code ?? 0);
});

process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
