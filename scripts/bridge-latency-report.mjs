#!/usr/bin/env node
/**
 * Bridge latency report — GET + warm-save p95 regression gates.
 *
 * Measures steady-state GET latency AND warm-save latency against an Astrid
 * local bridge, against a DISPOSABLE fixture timeline (default 2,000 events)
 * that this script seeds itself under a temp projects root. It never touches
 * the real bridge projects root or the live bridge on 17333.
 *
 * Gates:
 *   - GET p95   <= 500ms   (existing warm GET SLO, B7)
 *   - save p95  <= 500ms   (NEW warm-save SLO — prior doc's save was ~1s;
 *                           its 500ms gate was GET-only)
 *   - hard deadline 10s    (BRIDGE_REQUEST_TIMEOUT_MS — any save exceeding it
 *                           is the exact client abort path; retained)
 *
 * Save measurement POSTs {config, registry, expected_version} to
 * /projects/:slug/timelines/:ulid/save, advancing expected_version from the
 * response config_version after every POST (CAS), exactly like the editor's
 * save loop.
 *
 * Usage (self-contained; spawns its own bridge on a free port):
 *   node scripts/bridge-latency-report.mjs [--events 2000] [--samples 30] [--warmup 3]
 *
 * Usage (external bridge already running — GET-only, legacy ad-hoc):
 *   node scripts/bridge-latency-report.mjs --no-bridge --port 17333 \
 *     --project desert-plant-growth --timeline ed70ef66-43da-4182-9f14-69361c6c5e10
 *
 * Usage (external bridge serving a disposable fixture — save measurement):
 *   node scripts/bridge-latency-report.mjs --no-bridge --port 17334 \
 *     --fixture-root /tmp/latency-root --allow-save
 *
 * Transition tooling: --baseline records the save numbers without failing the
 * exit code (for the pre-fix baseline while T2.1 is landing). The SLO itself
 * is never weakened.
 *
 * Env/args:
 *   --port            bridge port (default: a free port when this script owns
 *                     the bridge; required with --no-bridge)
 *   --project         fixture project slug (default 'latency-fixture')
 *   --timeline        timeline ref (required with --no-bridge)
 *   --events          fixture event count (default 2000; must be even)
 *   --samples         measured samples per path (default 30)
 *   --warmup          warmup calls per path (default 3)
 *   --fixture-root    temp projects root to seed/use (default: fresh mkdtemp).
 *                     An externally supplied root is NEVER deleted at
 *                     teardown — only the mkdtemp root this script created.
 *   --no-bridge       bridge already running at --port
 *   --allow-save      allow save measurement against an external bridge
 *                     (refused for the known real project, desert-plant-growth)
 *   --keep-fixture    keep the fixture root + bridge after measuring
 *   --baseline        record save numbers without failing the gate (pre-fix
 *                     baseline; SLO unchanged)
 *   --python          python for seed + astrid serve (default: astrid venv
 *                     python at ../astrid/.venv/bin/python, else 'python3')
 *   --pythonpath      PYTHONPATH prefix for seed + bridge children
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const SEED_SCRIPT = join(SCRIPT_DIR, 'bridge-latency-seed.py');

const GET_SAVE_P95_SLO_MS = 500;
const HARD_DEADLINE_MS = 10_000;
const REAL_PROJECT_DENY_LIST = new Set(['desert-plant-growth']);

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith('--')) {
    const key = process.argv[i].slice(2);
    const next = process.argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i += 1;
    }
  }
}

const PORT = Number(args.get('port') ?? process.env.ASTRID_BRIDGE_PORT ?? 0);
const PROJECT = String(args.get('project') ?? 'latency-fixture');
const TIMELINE = args.get('timeline');
const EVENTS = Number(args.get('events') ?? 2000);
const SAMPLES = Number(args.get('samples') ?? 30);
const WARMUP = Number(args.get('warmup') ?? 3);
const NO_BRIDGE = args.get('no-bridge') === true;
const ALLOW_SAVE = args.get('allow-save') === true;
const KEEP_FIXTURE = args.get('keep-fixture') === true;
const BASELINE = args.get('baseline') === true;
const PYTHONPATH_PREFIX = args.get('pythonpath');
const FIXTURE_ROOT = args.get('fixture-root') ? resolve(String(args.get('fixture-root'))) : null;

function resolvePython() {
  const explicit = args.get('python') ?? process.env.ASTRID_PYTHON;
  if (explicit) {
    return String(explicit);
  }
  const siblingVenv = resolve(REPO_ROOT, '../astrid/.venv/bin/python');
  if (existsSync(siblingVenv)) {
    return siblingVenv;
  }
  return 'python3';
}
const PYTHON = resolvePython();

function childEnv() {
  const env = { ...process.env };
  if (PYTHONPATH_PREFIX) {
    env.PYTHONPATH = [PYTHONPATH_PREFIX, env.PYTHONPATH ?? ''].filter(Boolean).join(':');
  }
  return env;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return NaN;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function loadAvg() {
  try {
    if (process.platform !== 'linux') {
      return { one: NaN, five: NaN, fifteen: NaN };
    }
    const [one, five, fifteen] = readFileSync('/proc/loadavg', 'utf8')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map(Number);
    return { one, five, fifteen };
  } catch {
    return { one: NaN, five: NaN, fifteen: NaN };
  }
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function runSeed(fixtureRoot) {
  const result = spawnSync(
    PYTHON,
    [SEED_SCRIPT, '--root', fixtureRoot, '--project', PROJECT, '--events', String(EVENTS)],
    { encoding: 'utf8', env: childEnv(), timeout: 10 * 60_000 },
  );
  if (result.error) {
    throw new Error(`seed failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`seed failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
  const line = result.stdout.trim().split('\n').pop();
  let fixture;
  try {
    fixture = JSON.parse(line);
  } catch {
    throw new Error(`seed returned unparseable output: ${line}`);
  }
  if (!fixture.timeline_ulid || fixture.version === undefined) {
    throw new Error(`seed output missing fixture coordinates: ${line}`);
  }
  return fixture;
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
      lastError = `health status ${response.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`bridge at ${baseUrl} did not become healthy: ${lastError}`);
}

async function timedGet(url) {
  const start = performance.now();
  let status = 0;
  let body = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HARD_DEADLINE_MS) });
    status = response.status;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 0) {
      try {
        body = JSON.parse(Buffer.from(buffer).toString('utf8'));
      } catch {
        body = null;
      }
    }
  } catch (err) {
    return { ms: performance.now() - start, status, body, error: err.name };
  }
  return { ms: performance.now() - start, status, body };
}

async function timedSave(url, config, registry, expectedVersion) {
  const start = performance.now();
  let status = 0;
  let json = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, registry, expected_version: expectedVersion }),
      signal: AbortSignal.timeout(HARD_DEADLINE_MS),
    });
    status = response.status;
    if (status === 200) {
      json = await response.json();
    } else {
      await response.arrayBuffer();
    }
  } catch (err) {
    return { ms: performance.now() - start, status, json, error: err.name };
  }
  return { ms: performance.now() - start, status, json };
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 'no samples';
  }
  return (
    `min=${sorted[0].toFixed(1)}ms p50=${percentile(sorted, 50).toFixed(1)}ms ` +
    `p95=${percentile(sorted, 95).toFixed(1)}ms p99=${percentile(sorted, 99).toFixed(1)}ms ` +
    `max=${sorted[sorted.length - 1].toFixed(1)}ms`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let bridgeChild = null;
  let bridgePort = PORT;

  const measureSave = !(NO_BRIDGE && !ALLOW_SAVE);

  if (NO_BRIDGE && !ALLOW_SAVE && !TIMELINE) {
    throw new Error('--no-bridge requires --timeline (the timeline ref to measure)');
  }
  if (NO_BRIDGE && ALLOW_SAVE && !FIXTURE_ROOT) {
    throw new Error(
      '--no-bridge --allow-save requires --fixture-root: the external bridge must serve a ' +
        'disposable projects root this script can seed (never the real projects root)',
    );
  }
  if (NO_BRIDGE && ALLOW_SAVE && REAL_PROJECT_DENY_LIST.has(PROJECT)) {
    throw new Error(
      `refusing save measurement against the real project '${PROJECT}' — ` +
        'save measurement requires a disposable fixture (use the default self-contained mode)',
    );
  }
  if (measureSave && !NO_BRIDGE && REAL_PROJECT_DENY_LIST.has(PROJECT)) {
    // Self-contained mode seeds its own fixture under this slug in a temp root;
    // it can never touch the real project data. No guard needed beyond a note.
    console.log(`[latency] note: project slug '${PROJECT}' matches the real project name, but the ` +
      'fixture lives under a temp projects root owned by this script');
  }

  // The reporter owns ONLY the temp root it created itself via mkdtemp.
  // An externally supplied --fixture-root is never deleted (MUST-FIX 5: an
  // arbitrary user-supplied root must not be nuked), and the owned temp root
  // is only removed after re-verifying it is exactly the mkdtemp directory
  // this process created — never anything outside it.
  const fixtureRoot = FIXTURE_ROOT ?? mkdtempSync(join(tmpdir(), 'reigh-latency-'));
  const ownedFixtureRoot = FIXTURE_ROOT === null ? fixtureRoot : null;

  const teardown = () => {
    if (KEEP_FIXTURE) {
      // --keep-fixture: leave the spawned bridge AND the fixture root in
      // place for manual inspection (nothing is killed or deleted).
      return;
    }
    if (bridgeChild && bridgeChild.pid) {
      try {
        process.kill(-bridgeChild.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      try {
        bridgeChild.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    if (ownedFixtureRoot) {
      // Defense in depth: only ever delete the exact temp root this script
      // created (mkdtemp under the OS tmpdir with the reporter prefix).
      const tmpRoot = resolve(tmpdir());
      const owned = resolve(ownedFixtureRoot);
      if (owned.startsWith(tmpRoot + sep) && basename(owned).startsWith('reigh-latency-')) {
        rmSync(owned, { recursive: true, force: true });
      } else {
        console.error(
          `[latency] refusing to delete ${owned}: not a reporter-owned temp root ` +
            '(externally supplied --fixture-root is left intact)',
        );
      }
    }
  };

  process.on('SIGINT', () => {
    teardown();
    process.exit(130);
  });

  let fixture = null;
  try {
    if (NO_BRIDGE && !measureSave) {
      // Legacy ad-hoc GET-only mode against an external bridge.
      console.log(`[latency] GET-only mode (external bridge at :${bridgePort}, no save measurement)`);
    } else {
      fixture = runSeed(fixtureRoot);
      console.log(
        `[latency] fixture seeded: project=${fixture.project} ulid=${fixture.timeline_ulid} ` +
          `events=${fixture.event_count} version=${fixture.version}`,
      );
    }

    if (!NO_BRIDGE) {
      if (!bridgePort) {
        bridgePort = await findFreePort();
      }
      const pythonArgs = [
        '-m',
        'astrid',
        'serve',
        '--host',
        '127.0.0.1',
        '--port',
        String(bridgePort),
        '--projects-root',
        fixtureRoot,
      ];
      console.log(`[latency] starting bridge: ${PYTHON} ${pythonArgs.join(' ')}`);
      bridgeChild = spawn(PYTHON, pythonArgs, {
        env: childEnv(),
        detached: true,
        stdio: 'ignore',
      });
      // The bridge is a detached daemon this script manages by pid.  unref()
      // stops the parent from waiting on it, so the reporter exits even when
      // --keep-fixture leaves the bridge running (teardown still kills it by
      // pid when the flag is not set).
      bridgeChild.unref();
      await waitForHealth(`http://127.0.0.1:${bridgePort}`, 30_000);
      console.log(`[latency] bridge healthy at http://127.0.0.1:${bridgePort}`);
    }

    const baseUrl = `http://127.0.0.1:${bridgePort}`;
    const timelineRef = fixture ? fixture.timeline_ulid : TIMELINE;
    const timelineUrl = `${baseUrl}/projects/${encodeURIComponent(PROJECT)}/timelines/${encodeURIComponent(timelineRef)}`;

    // ---- GET path ---------------------------------------------------------
    console.log(`[latency] GET ${WARMUP}x warmup + ${SAMPLES}x samples (p95 target < ${GET_SAVE_P95_SLO_MS}ms warm)`);
    const getStatuses = new Set();
    const getSamples = [];
    for (let i = 0; i < WARMUP; i += 1) {
      const { status } = await timedGet(timelineUrl);
      getStatuses.add(status);
    }
    for (let i = 0; i < SAMPLES; i += 1) {
      const { ms, status } = await timedGet(timelineUrl);
      getStatuses.add(status);
      getSamples.push(ms);
    }
    const getP95 = percentile([...getSamples].sort((a, b) => a - b), 95);
    const getMax = Math.max(...getSamples);

    // ---- Save path ----------------------------------------------------------
    let saveP95 = NaN;
    let saveMax = 0;
    let saveStatuses = new Set();
    let saveOverDeadline = 0;
    let saveFailed = false;
    let saveSamples = [];

    if (measureSave) {
      const saveUrl = `${timelineUrl}/save`;
      const initial = await timedGet(timelineUrl);
      const config = initial.body?.config;
      const registry = initial.body?.registry;
      let expectedVersion = initial.body?.config_version;
      if (!config || typeof expectedVersion !== 'number') {
        throw new Error(`fixture load for save measurement failed (status ${initial.status}): ${initial.error ?? 'unexpected payload'}`);
      }
      console.log(
        `[latency] save ${WARMUP}x warmup + ${SAMPLES}x samples (p95 target < ${GET_SAVE_P95_SLO_MS}ms, hard deadline ${HARD_DEADLINE_MS}ms, CAS advancing)`,
      );

      const runSave = async (countSample) => {
        const { ms, status, json, error } = await timedSave(saveUrl, config, registry, expectedVersion);
        saveStatuses.add(status);
        if (status === 200 && json?.config_version !== undefined) {
          expectedVersion = json.config_version; // CAS: advance after every POST
        } else if (status === 409) {
          throw new Error(
            `save CAS rejected: expected_version ${expectedVersion} was stale — ` +
              `the bridge head advanced without this script (status 409)`,
          );
        } else if (status !== 200) {
          saveFailed = true;
          console.error(`[latency] save failed: status ${status}${error ? ` (${error})` : ''}`);
        }
        if (ms > HARD_DEADLINE_MS) {
          saveOverDeadline += 1;
          console.error(`[latency] save exceeded the ${HARD_DEADLINE_MS}ms hard deadline: ${ms.toFixed(1)}ms`);
        }
        if (countSample) {
          saveSamples.push(ms);
        }
        return ms;
      };

      for (let i = 0; i < WARMUP; i += 1) {
        await runSave(false);
      }
      for (let i = 0; i < SAMPLES; i += 1) {
        await runSave(true);
      }
      const sortedSaveSamples = [...saveSamples].sort((a, b) => a - b);
      saveP95 = percentile(sortedSaveSamples, 95);
      saveMax = sortedSaveSamples[sortedSaveSamples.length - 1];
    }

    // ---- Report + gates ------------------------------------------------------
    const load = loadAvg();
    console.log('');
    console.log(`[latency] fixture root ${fixtureRoot}  bridge :${bridgePort}  timeline ${timelineRef}`);
    console.log(`[latency] GET statuses: ${[...getStatuses].join(',')}  samples=${getSamples.length} ${summarize(getSamples)}`);
    if (measureSave) {
      console.log(`[latency] save statuses: ${[...saveStatuses].join(',')}  samples=${SAMPLES} ${summarize([...saveSamples])}`);
    } else {
      console.log('[latency] save path: not measured (external GET-only mode; use a disposable fixture for save gating)');
    }
    console.log(`[latency] load avg: 1m=${load.one} 5m=${load.five} 15m=${load.fifteen}`);

    let exitCode = 0;

    if (getP95 > GET_SAVE_P95_SLO_MS) {
      console.error(`[latency] FAIL: GET p95 ${getP95.toFixed(1)}ms exceeds the ${GET_SAVE_P95_SLO_MS}ms warm target`);
      exitCode = 1;
    } else {
      console.log(`[latency] PASS: GET p95 ${getP95.toFixed(1)}ms under the ${GET_SAVE_P95_SLO_MS}ms warm target`);
    }

    if (measureSave) {
      const saveViolations = [];
      if (saveOverDeadline > 0) {
        saveViolations.push(`${saveOverDeadline} save(s) exceeded the ${HARD_DEADLINE_MS}ms hard deadline (max ${saveMax.toFixed(1)}ms)`);
      }
      if (saveFailed) {
        saveViolations.push('at least one save returned a non-200 status');
      }
      if (saveP95 > GET_SAVE_P95_SLO_MS) {
        saveViolations.push(`save p95 ${saveP95.toFixed(1)}ms exceeds the ${GET_SAVE_P95_SLO_MS}ms warm-save SLO`);
      }
      if (saveViolations.length > 0) {
        console.error(`[latency] FAIL: ${saveViolations.join('; ')}`);
        if (BASELINE) {
          console.log(
            `[latency] baseline mode: recording save p95=${saveP95.toFixed(1)}ms max=${saveMax.toFixed(1)}ms ` +
              'as the pre-fix baseline; gate stays wired at 500ms',
          );
        } else {
          exitCode = 1;
        }
      } else {
        console.log(`[latency] PASS: save p95 ${saveP95.toFixed(1)}ms under the ${GET_SAVE_P95_SLO_MS}ms warm-save SLO, ` +
          `hard deadline ${HARD_DEADLINE_MS}ms respected (max ${saveMax.toFixed(1)}ms)`);
      }
    }

    process.exitCode = exitCode;
  } finally {
    teardown();
  }
}

main().catch((err) => {
  console.error(`[latency] error: ${err.message}`);
  process.exitCode = 1;
});
