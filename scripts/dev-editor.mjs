#!/usr/bin/env node
/**
 * `npm run dev:editor` — the timeline in a browser, with no Supabase.
 *
 * Spawns the committed Astrid bridge stub (demo project/timeline/assets, saves
 * held in memory) plus the Vite dev server, and prints the local-mode URL that
 * the e2e device specs use. The placeholder `VITE_SUPABASE_*` values mirror the
 * ones `playwright.config.ts` injects: the Supabase env getters are lazy, so
 * local mode only needs them to exist.
 */
import { spawn } from 'node:child_process';

const PORT = process.env.PORT ?? '2222';
const BRIDGE_PORT = process.env.VITE_ASTRID_BRIDGE_PORT ?? '17333';
const EDITOR_URL =
  `http://127.0.0.1:${PORT}/tools/video-editor?localProject=demo-project&localTimeline=demo-timeline`;

const env = {
  ...process.env,
  PORT,
  VITE_ASTRID_BRIDGE_PORT: BRIDGE_PORT,
  ASTRID_BRIDGE_PORT: BRIDGE_PORT,
  // Must stay in step with PLACEHOLDER_SUPABASE_URL in
  // src/tools/video-editor/dev/devSession.ts — the dev session's storage key is
  // derived from this URL. (.mjs cannot import the TS module.)
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? 'test-anon-key',
  VITE_APP_ENV: process.env.VITE_APP_ENV ?? 'web',
};

const children = [
  spawn('node', ['tests/e2e/timeline/astrid-bridge-stub.mjs'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', PORT], { stdio: 'inherit', env }),
];

console.log([
  '',
  'Timeline dev environment',
  `  editor : ${EDITOR_URL}`,
  `  bridge : http://127.0.0.1:${BRIDGE_PORT} (demo project, in-memory saves)`,
  '',
].join('\n'));

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// If either process dies the other is useless — take the whole thing down.
for (const child of children) {
  child.on('exit', (code) => {
    shutdown('SIGTERM');
    process.exitCode = code ?? 0;
  });
}
