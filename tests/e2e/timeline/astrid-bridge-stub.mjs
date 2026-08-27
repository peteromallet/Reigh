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
  createAudioReactiveColourFixtures,
  createOffsetAudioReactiveColourFixtures,
  createTimelineFixtures,
  AUDIO_REACTIVE_OFFSET_FIXTURE_TIMELINE_ID,
  AUDIO_REACTIVE_FIXTURE_TIMELINE_ID,
  FIXTURE_PROJECT as PROJECT,
  FIXTURE_TIMELINE_ID as TIMELINE_ID,
} from '../../../src/test/bridgeFixtures.mjs';

const PORT = Number(process.env.ASTRID_BRIDGE_PORT || 17334);
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:2222').replace(/\/+$/, '');

// Asset bytes come from the repo's own `public/` directory, resolved relative to
// this file so the stub works from any cwd.
const PUBLIC_DIR = new URL('../../../public/', import.meta.url);

const initialFixtures = createTimelineFixtures({
  assetSrcBaseUrl: BASE_URL,
});
const audioReactiveFixtures = createAudioReactiveColourFixtures({
  assetSrcBaseUrl: BASE_URL,
});
const audioReactiveOffsetFixtures = createOffsetAudioReactiveColourFixtures({
  assetSrcBaseUrl: BASE_URL,
});
const timelineStates = new Map([
  [TIMELINE_ID, {
    timelineSummary: initialFixtures.timelineSummary,
    config: initialFixtures.config,
    registry: initialFixtures.registry,
    configVersion: 1,
  }],
  [AUDIO_REACTIVE_FIXTURE_TIMELINE_ID, {
    timelineSummary: audioReactiveFixtures.timelineSummary,
    config: audioReactiveFixtures.config,
    registry: audioReactiveFixtures.registry,
    configVersion: 1,
  }],
  [AUDIO_REACTIVE_OFFSET_FIXTURE_TIMELINE_ID, {
    timelineSummary: audioReactiveOffsetFixtures.timelineSummary,
    config: audioReactiveOffsetFixtures.config,
    registry: audioReactiveOffsetFixtures.registry,
    configVersion: 1,
  }],
]);

function stateForTimeline(timelineId) {
  const ref = decodeURIComponent(timelineId);
  return timelineStates.get(ref)
    ?? [...timelineStates.values()].find((state) => (
      state.timelineSummary.timeline_id === ref
      || state.timelineSummary.slug === ref
      || state.timelineSummary.timeline_ulid === ref
    ));
}

// Every mutating route shares one queue. This makes a hard reset atomic with
// respect to CAS saves and registry writes instead of allowing an async body
// read to interleave half of one mutation with another.
let mutationTail = Promise.resolve();

function serializeMutation(operation) {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function resetPristineState() {
  const pristine = createTimelineFixtures({ assetSrcBaseUrl: BASE_URL });
  const audioPristine = createAudioReactiveColourFixtures({ assetSrcBaseUrl: BASE_URL });
  const audioOffsetPristine = createOffsetAudioReactiveColourFixtures({ assetSrcBaseUrl: BASE_URL });
  const defaultState = stateForTimeline(TIMELINE_ID);
  const audioState = stateForTimeline(AUDIO_REACTIVE_FIXTURE_TIMELINE_ID);
  const audioOffsetState = stateForTimeline(AUDIO_REACTIVE_OFFSET_FIXTURE_TIMELINE_ID);
  defaultState.config = pristine.config;
  defaultState.registry = pristine.registry;
  audioState.config = audioPristine.config;
  audioState.registry = audioPristine.registry;
  audioOffsetState.config = audioOffsetPristine.config;
  audioOffsetState.registry = audioOffsetPristine.registry;
  // Versions are store history, not fixture contents. Never rewind them: a
  // client holding a pre-reset version must remain stale after every reset.
  defaultState.configVersion += 1;
  audioState.configVersion += 1;
  return {
    reset: true,
    ...defaultState.timelineSummary,
    config: defaultState.config,
    config_version: defaultState.configVersion,
    registry: defaultState.registry,
  };
}

const RUNAWAY_TOTAL_COUNT = 566;
const RUNAWAY_SCALE_COUNTS = new Map([
  ['runaway-scale-5000', 5_000],
  ['runaway-scale-50000', 50_000],
]);
const RUNAWAY_PAGE_LIMIT = 1_000;
const RUNAWAY_FPS = 48;
const RUNAWAY_FRAME_COUNT = 8_085;
const RUNAWAY_SNAPSHOT = 'runaway-v1:deterministic-browser-stub';

function frameToMs(frame) {
  return Math.round((frame * 1000) / RUNAWAY_FPS);
}

/**
 * Deterministic Runaway rows for browser gates.  The real bridge's typed lane
 * contract is paginated even when this fixture fits in one page; retaining
 * that envelope here catches protocol/header regressions instead of letting a
 * browser gate silently fall back to an empty lane.
 */
const runawayTransitionCache = new Map();

function runawayTransitionsForCount(totalCount) {
  const cached = runawayTransitionCache.get(totalCount);
  if (cached) return cached;
  const manifestWidth = totalCount >= 10_000 ? 5 : 4;
  const segmentSize = Math.ceil(totalCount / 10);
  const transitions = Array.from({ length: totalCount }, (_, index) => {
    const ordinal = index;
    // Spread the typed rows across the complete composition envelope. Keeping
    // the endpoints explicit matters: the final row is the final visible frame
    // (8084), while the composition itself contains 8085 frames (0..8084).
    const frame = Math.round(
      (index * (RUNAWAY_FRAME_COUNT - 1)) / (totalCount - 1),
    );
    const startMs = frameToMs(frame);
    const nextFrame = index + 1 < totalCount
      ? Math.round(
        ((index + 1) * (RUNAWAY_FRAME_COUNT - 1)) / (totalCount - 1),
      )
      : RUNAWAY_FRAME_COUNT;
    // Derive each duration from the same rounded frame-time endpoints as the
    // start. This keeps every duration positive and makes the sum exactly span
    // the declared composition envelope instead of accumulating per-row drift.
    const durationMs = Math.max(1, frameToMs(nextFrame) - startMs);
    const segmentNumber = Math.min(10, Math.floor(index / segmentSize) + 1);
    const isRose = index % 2 === 0;
    return {
      id: `runaway-stub-row-${String(index + 1).padStart(manifestWidth, '0')}`,
      run_id: 'runaway-stub-run-v1',
      task_id: null,
      ordinal,
      start_ms: startMs,
      duration_ms: durationMs,
      prompt: `${isRose ? 'rose' : 'teal'} neon piano chord, deterministic browser fixture`,
      metadata: {
        manifest_id: `T${String(index + 1).padStart(manifestWidth, '0')}`,
        segment_id: `S${String(segmentNumber).padStart(2, '0')}`,
        segment_label: `Runaway fixture region ${String(segmentNumber).padStart(2, '0')}`,
        timing_mode: index % 5 === 0 ? 'hard_cut' : 'hold',
        colour_name: isRose ? 'rose' : 'teal',
        colour_hex: isRose ? '#D47795' : '#26A7D0',
        frame,
        fps: RUNAWAY_FPS,
      },
      created_at: '2026-08-24T00:00:00Z',
    };
  });
  runawayTransitionCache.set(totalCount, transitions);
  return transitions;
}

function runawayPage(url) {
  const project = url.pathname.split('/')[3] ?? 'runaway-browser-stub';
  const totalCount = RUNAWAY_SCALE_COUNTS.get(project) ?? RUNAWAY_TOTAL_COUNT;
  const runawayTransitions = runawayTransitionsForCount(totalCount);
  const requestedLimit = Number(url.searchParams.get('limit') || RUNAWAY_PAGE_LIMIT);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, RUNAWAY_PAGE_LIMIT)
    : RUNAWAY_PAGE_LIMIT;
  const requestedCursor = url.searchParams.get('cursor');
  const start = requestedCursor === null ? 0 : Number(requestedCursor);
  const offset = Number.isSafeInteger(start) && start >= 0 && start <= totalCount
    ? start
    : 0;
  const transitions = runawayTransitions.slice(offset, offset + limit);
  const nextOffset = offset + transitions.length;
  return {
    api_version: 'v1',
    project,
    count: transitions.length,
    total_count: totalCount,
    snapshot: RUNAWAY_SNAPSHOT,
    page: {
      // The client contract fixes the bridge page limit at 1000.  A smaller
      // request is only a useful harness convenience; it must not change the
      // declared wire contract.
      limit: RUNAWAY_PAGE_LIMIT,
      next_cursor: nextOffset < totalCount ? String(nextOffset) : null,
    },
    timing_summary: {
      evidence_id: 'runaway-stub-evidence-v1',
      run_id: 'runaway-stub-run-v1',
      summary: 'Deterministic Runaway browser fixture',
      created_at: '2026-08-24T00:00:00Z',
      data: {
        frame_count: RUNAWAY_FRAME_COUNT,
        transition_count: totalCount,
        fps: RUNAWAY_FPS,
        segment_counts: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            `S${String(index + 1).padStart(2, '0')}`,
            index === 9 ? totalCount - 9 * Math.ceil(totalCount / 10) : Math.ceil(totalCount / 10),
          ]),
        ),
      },
    },
    transitions,
  };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Astrid-Bridge-Version': 'v1',
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

  // Test-only control plane for the deterministic stub. The real bridge never
  // exposes this route, and support.ts never calls it under REAL_BRIDGE=1.
  if (path === '/__test/reset' && req.method === 'POST') {
    return serializeMutation(() => send(res, 200, resetPristineState()));
  }

  const runawayMatch = path.match(/^\/v1\/projects\/([^/]+)\/runaway-transitions$/);
  if (runawayMatch && req.method === 'GET') {
    return send(res, 200, runawayPage(url));
  }

  // Discovery probes are optional capabilities in local mode.  Returning the
  // valid empty envelopes keeps a deterministic editor session free of
  // avoidable 404 console noise while preserving the bridge's real schemas.
  const tasksMatch = path.match(/^\/projects\/([^/]+)\/tasks$/);
  if (tasksMatch && req.method === 'GET') {
    return send(res, 200, { tasks: [], next_offset: null });
  }
  const generationsMatch = path.match(/^\/projects\/([^/]+)\/generations$/);
  if (generationsMatch && req.method === 'GET') {
    return send(res, 200, { generations: [], next_cursor: null });
  }

  const timelinesMatch = path.match(/^\/projects\/([^/]+)\/timelines$/);
  if (timelinesMatch) {
    return send(res, 200, { timelines: [...timelineStates.values()].map((state) => state.timelineSummary) });
  }

  const timelineMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)$/);
  if (timelineMatch) {
    const state = stateForTimeline(timelineMatch[2]);
    if (!state) return send(res, 404, { error: 'timeline_not_found' });
    return send(res, 200, {
      ...state.timelineSummary,
      config: state.config,
      config_version: state.configVersion,
      registry: state.registry,
    });
  }

  const assetMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/assets\/([^/]+)$/);
  if (assetMatch) {
    const state = stateForTimeline(assetMatch[2]);
    if (!state) return send(res, 404, { error: 'timeline_not_found' });
    const entry = state.registry.assets[decodeURIComponent(assetMatch[3])];
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
    const headers = {
      'Content-Type': entry.type,
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    return res.end(body);
  }

  const saveMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/save$/);
  if (saveMatch && req.method === 'POST') {
    return serializeMutation(async () => {
      const state = stateForTimeline(saveMatch[2]);
      if (!state) return send(res, 404, { error: 'timeline_not_found' });
      const body = await readBody(req);
      // Optimistic concurrency. `expected_version` is optional on the wire: a
      // client that omits it keeps the old last-writer-wins behaviour, which is
      // what every pre-CAS caller relies on. When it *is* sent and does not match
      // head, the save is rejected so the client can reload and retry instead of
      // silently reverting whatever landed in between.
      if (typeof body?.expected_version === 'number' && body.expected_version !== state.configVersion) {
        console.log(`[bridge] 409 conflict: expected_version ${body.expected_version} != config_version ${state.configVersion}`);
        return send(res, 409, {
          error: 'timeline_version_conflict',
          detail: `expected_version ${body.expected_version} does not match config_version ${state.configVersion}`,
          config_version: state.configVersion,
        });
      }
      if (body?.config) state.config = body.config;
      // B4: the combined CAS save carries config + registry (asset registration
      // rides the save — there is no separate registry write path).
      if (body?.registry) {
        state.registry.assets = { ...state.registry.assets, ...(body.registry.assets ?? {}) };
      }
      state.configVersion += 1;
      return send(res, 200, {
        ...state.timelineSummary,
        config: state.config,
        config_version: state.configVersion,
        registry: state.registry,
      });
    });
  }

  const registryMatch = path.match(/^\/projects\/([^/]+)\/timelines\/([^/]+)\/registry$/);
  if (registryMatch && req.method === 'PUT') {
    return serializeMutation(async () => {
      const state = stateForTimeline(registryMatch[2]);
      if (!state) return send(res, 404, { error: 'timeline_not_found' });
      const body = await readBody(req);
      if (body?.assets) state.registry.assets = body.assets;
      return send(res, 200, state.registry);
    });
  }

  return send(res, 404, { error: 'not_found', detail: `No bridge route for ${path}` });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] listening on http://127.0.0.1:${PORT} (assets from ${PUBLIC_DIR.pathname})`);
});
