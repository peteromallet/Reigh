// Minimal stand-in for `astrid serve` so the video editor's dev "Local" mode
// has a bridge to talk to. Serves one project with one timeline.
//
// All seed data comes from the shared fixture module
// (`src/test/bridgeFixtures.mjs`) — the same authority the vitest fake router
// consumes. Only the display `src` base and the node-http scaffolding live
// here.
//
// Run it alongside the dev server before `npm run test:e2e:timeline`:
//   npm run test:e2e:timeline:bridge
//
// Env:
//   ASTRID_BRIDGE_PORT  port to listen on            (default 17334)
//   BASE_URL            dev-server origin the asset  (default http://127.0.0.1:2222)
//                       `src` URLs point at
import fs from 'node:fs';
import http from 'node:http';

import {
  createTimelineFixtures,
  FIXTURE_PROJECT as PROJECT,
  FIXTURE_TIMELINE_ID as TIMELINE_ID,
} from '../../../src/test/bridgeFixtures.mjs';

const PORT = Number(process.env.ASTRID_BRIDGE_PORT || 17334);
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:2222').replace(/\/+$/, '');

// Asset bytes come from the repo's own `public/` directory, resolved relative to
// this file so the stub works from any cwd.
const PUBLIC_DIR = new URL('../../../public/', import.meta.url);

const { registry, config: initialConfig, timelineSummary } = createTimelineFixtures({
  assetSrcBaseUrl: BASE_URL,
});
let config = initialConfig;
let configVersion = 1;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  console.log(`[bridge] ${req.method} ${path}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (path === '/health') return send(res, 200, { ok: true });
  if (path === '/projects') return send(res, 200, { projects: [PROJECT] });

  const timelinesMatch = path.match(/^\/projects\/([^/]+)\/timelines$/);
  if (timelinesMatch) return send(res, 200, { timelines: [timelineSummary] });

  const timelineMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)$/);
  if (timelineMatch) {
    return send(res, 200, {
      ...timelineSummary,
      config,
      config_version: configVersion,
      registry,
    });
  }

  const assetMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/assets\/([^/]+)$/);
  if (assetMatch) {
    const entry = registry.assets[decodeURIComponent(assetMatch[3])];
    if (!entry) return send(res, 404, { error: 'asset_not_found' });
    const file = new URL(entry.file, PUBLIC_DIR);
    let body;
    try {
      body = fs.readFileSync(file);
    } catch (error) {
      return send(res, 404, { error: 'asset_read_failed', detail: String(error) });
    }
    // Range support (single range only). Media elements need 206 to seek
    // without buffering the whole file; Vite's own static server does this, so
    // a stub that only ever answers 200 hides seeking bugs from the e2e suite.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] !== '' || range[2] !== '')) {
      const suffixLength = range[1] === '' ? Number(range[2]) : null;
      const start = suffixLength === null ? Number(range[1]) : Math.max(0, body.length - suffixLength);
      const end = suffixLength === null && range[2] !== ''
        ? Math.min(Number(range[2]), body.length - 1)
        : body.length - 1;
      if (start > end || start >= body.length) {
        res.writeHead(416, {
          'Content-Range': `bytes */${body.length}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end();
      }
      const slice = body.subarray(start, end + 1);
      res.writeHead(206, {
        'Content-Type': entry.type,
        'Content-Length': slice.length,
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(slice);
    }
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(body);
  }

  const saveMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/save$/);
  if (saveMatch && req.method === 'POST') {
    const body = await readBody(req);
    // Optimistic concurrency. `expected_version` is optional on the wire: a
    // client that omits it keeps the old last-writer-wins behaviour, which is
    // what every pre-CAS caller relies on. When it *is* sent and does not match
    // head, the save is rejected so the client can reload and retry instead of
    // silently reverting whatever landed in between.
    if (typeof body?.expected_version === 'number' && body.expected_version !== configVersion) {
      console.log(`[bridge] 409 conflict: expected_version ${body.expected_version} != config_version ${configVersion}`);
      return send(res, 409, {
        error: 'timeline_version_conflict',
        detail: `expected_version ${body.expected_version} does not match config_version ${configVersion}`,
        config_version: configVersion,
      });
    }
    if (body?.config) config = body.config;
    // B4: the combined CAS save carries config + registry (asset registration
    // rides the save — there is no separate registry write path).
    if (body?.registry) {
      registry.assets = { ...registry.assets, ...(body.registry.assets ?? {}) };
    }
    configVersion += 1;
    return send(res, 200, { ...timelineSummary, config, config_version: configVersion, registry });
  }

  const registryMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/registry$/);
  if (registryMatch && req.method === 'PUT') {
    const body = await readBody(req);
    if (body?.assets) registry.assets = body.assets;
    return send(res, 200, registry);
  }

  return send(res, 404, { error: 'not_found', detail: `No bridge route for ${path}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] listening on http://127.0.0.1:${PORT} (assets from ${PUBLIC_DIR.pathname})`);
});

