#!/usr/bin/env node
/**
 * Nightly bridge latency report (plan-v5 B5).
 *
 * Measures GET timeline steady-state latency against the Astrid local bridge:
 * 3 warmups, then N samples → p50 / p95 / p99, plus machine load at sample
 * time. Intended for the nightly Linux job; also runs ad-hoc:
 *
 *   node scripts/bridge-latency-report.mjs \
 *     --port 17333 --project desert-plant-growth \
 *     --timeline ed70ef66-43da-4182-9f14-69361c6c5e10 --samples 30
 */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith('--')) {
    const key = process.argv[i].slice(2);
    args.set(key, process.argv[i + 1]);
  }
}

const PORT = Number(args.get('port') ?? process.env.ASTRID_BRIDGE_PORT ?? 17333);
const PROJECT = args.get('project') ?? 'desert-plant-growth';
const TIMELINE = args.get('timeline') ?? 'ed70ef66-43da-4182-9f14-69361c6c5e10';
const SAMPLES = Number(args.get('samples') ?? 30);
const WARMUP = Number(args.get('warmup') ?? 3);
const BRIDGE_URL = `http://127.0.0.1:${PORT}`;
const TIMELINE_URL = `${BRIDGE_URL}/projects/${PROJECT}/timelines/${TIMELINE}`;

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return NaN;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function loadAvg() {
  try {
    const [one, five, fifteen] = statSync('/proc/loadavg')
      ? process.platform === 'linux'
        ? require('node:fs').readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).slice(0, 3).map(Number)
        : [NaN, NaN, NaN]
      : [NaN, NaN, NaN];
    return { one, five, fifteen };
  } catch {
    return { one: NaN, five: NaN, fifteen: NaN };
  }
}

async function timedGet(url) {
  const start = performance.now();
  const response = await fetch(url);
  await response.arrayBuffer();
  return { ms: performance.now() - start, status: response.status };
}

const samples = [];
let statuses = new Set();

console.log(`[latency] bridge ${BRIDGE_URL}  timeline ${TIMELINE_URL}`);
console.log(`[latency] warmup ${WARMUP}×  samples ${SAMPLES}  (p95 target < 500ms warm)`);

for (let i = 0; i < WARMUP; i += 1) {
  const { status } = await timedGet(TIMELINE_URL);
  statuses.add(status);
}
for (let i = 0; i < SAMPLES; i += 1) {
  const { ms, status } = await timedGet(TIMELINE_URL);
  statuses.add(status);
  samples.push(ms);
}

samples.sort((a, b) => a - b);
const load = loadAvg();
console.log(`[latency] statuses: ${[...statuses].join(',')}`);
console.log(`[latency] samples=${samples.length} min=${samples[0].toFixed(1)}ms ` +
  `p50=${percentile(samples, 50).toFixed(1)}ms p95=${percentile(samples, 95).toFixed(1)}ms ` +
  `p99=${percentile(samples, 99).toFixed(1)}ms max=${samples[samples.length - 1].toFixed(1)}ms`);
console.log(`[latency] load avg: 1m=${load.one} 5m=${load.five} 15m=${load.fifteen}`);

const p95 = percentile(samples, 95);
if (p95 > 500) {
  console.error(`[latency] FAIL: p95 ${p95.toFixed(1)}ms exceeds the 500ms warm target`);
  process.exitCode = 1;
} else {
  console.log(`[latency] PASS: p95 ${p95.toFixed(1)}ms under the 500ms warm target`);
}
