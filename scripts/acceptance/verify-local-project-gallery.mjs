import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_PROJECT = 'desert-plant-growth';
const DEFAULT_TIMELINE = '01KYPVKMW5STB4W6FE05ED8242';

/** Checked-in examples for explicit matrix mode; override with REIGH_LOCAL_PROJECT_MATRIX. */
export const DEFAULT_MATRIX = [
  { project: 'desert-plant-growth', timeline: '01KYPVKMW5STB4W6FE05ED8242' },
  { project: '2rp-launch-video', timeline: '01KZRNBQPERQB6KHBDZBZWEKZS' },
  { project: 'ados-talks', timeline: '01KTBWN632Z935SD2SRXAP70YJ' },
];

function rowFromValue(value, index) {
  if (typeof value === 'string') {
    const [project, timeline, expectedShots, expectedGenerations] = value.split(':').map((part) => part.trim());
    return { project, timeline, ...(expectedShots ? { expectedShots: Number(expectedShots) } : {}), ...(expectedGenerations ? { expectedGenerations: Number(expectedGenerations) } : {}) };
  }
  if (!value || typeof value !== 'object') throw new TypeError(`matrix row ${index + 1} must be an object or project:timeline string`);
  const project = typeof value.project === 'string' ? value.project.trim() : '';
  const timeline = typeof value.timeline === 'string' ? value.timeline.trim() : '';
  return { ...value, project, timeline, ...(value.expectedShots === undefined ? {} : { expectedShots: Number(value.expectedShots) }), ...(value.expectedGenerations === undefined ? {} : { expectedGenerations: Number(value.expectedGenerations) }) };
}

/** Parse JSON or `project:timeline[:expectedShots[:expectedGenerations]],...`. */
export function parseProjectMatrix(raw) {
  if (!raw || !raw.trim()) return [];
  let values;
  try {
    const parsed = JSON.parse(raw);
    values = Array.isArray(parsed) ? parsed : parsed?.projects;
  } catch {
    values = raw.split(',').map((row) => row.trim()).filter(Boolean);
  }
  if (!Array.isArray(values) || values.length === 0) throw new Error('REIGH_LOCAL_PROJECT_MATRIX must be a non-empty JSON array or comma-separated matrix');
  const rows = values.map(rowFromValue);
  rows.forEach((row, index) => {
    if (!row.project || !row.timeline) throw new Error(`matrix row ${index + 1} needs project and timeline`);
    for (const key of ['expectedShots', 'expectedGenerations']) {
      if (row[key] !== undefined && (!Number.isInteger(row[key]) || row[key] < 0)) throw new Error(`${key} on matrix row ${index + 1} must be a non-negative integer`);
    }
  });
  return rows;
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isAudioClip(clip, asset, track) {
  return track?.kind === 'audio' || (typeof asset?.type === 'string' && asset.type.toLowerCase().startsWith('audio/')) || clip?.clipType?.toLowerCase() === 'audio';
}

const firstNonEmptyString = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim();

/** Project the bridge document into the visual clip scope each card must render. */
export function deriveShotExpectations(timelinePayload) {
  const config = timelinePayload?.config ?? {};
  const registry = timelinePayload?.registry?.assets ?? {};
  const clipsById = new Map((Array.isArray(config.clips) ? config.clips : []).map((clip) => [clip.id, clip]));
  const tracksById = new Map((Array.isArray(config.tracks) ? config.tracks : []).map((track) => [track.id, track]));
  const groups = Array.isArray(config.pinnedShotGroups) ? config.pinnedShotGroups : [];
  return groups.flatMap((group, index) => {
    if (!isRecord(group) || typeof group.shotId !== 'string' || !group.shotId.trim()) return [];
    const clipIds = Array.isArray(group.clipIds) ? group.clipIds.filter((id) => typeof id === 'string') : [];
    const track = tracksById.get(group.trackId);
    const visualClipIds = clipIds.flatMap((clipId) => {
      const clip = clipsById.get(clipId);
      if (!clip || isAudioClip(clip, clip.asset ? registry[clip.asset] : undefined, track)) return [];
      return [clipId];
    });
    const labels = clipIds.map((id) => clipsById.get(id)?.label);
    const anchor = isRecord(group.emptyShotAnchor) ? firstNonEmptyString(group.emptyShotAnchor.name, group.emptyShotAnchor.label, group.emptyShotAnchor.title) : group.emptyShotAnchor;
    const name = firstNonEmptyString(group.name, anchor, labels.find((label) => typeof label === 'string' && label.trim()), `Shot ${index + 1}`);
    return [{ index, id: group.shotId, name, clipIds, visualClipIds, nonVisualClipCount: clipIds.length - visualClipIds.length }];
  });
}

const sorted = (values) => [...values].sort();
const unique = (values) => [...new Set(values)];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function waitUntil(predicate, timeout = 30_000, interval = 100) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await predicate(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, interval));
  }
  if (lastError) throw lastError;
  throw new Error(`timed out after ${timeout}ms`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
  return payload;
}

async function fetchGenerations(origin, project) {
  const all = [];
  let cursor = null;
  for (let request = 0; request < 20; request += 1) {
    const url = new URL(`/api/astrid/projects/${encodeURIComponent(project)}/generations`, origin);
    url.searchParams.set('limit', '500');
    if (cursor) url.searchParams.set('cursor', cursor);
    const payload = await fetchJson(url);
    assert.ok(Array.isArray(payload?.generations), `generation list for ${project} has a generations array`);
    all.push(...payload.generations);
    if (!payload.next_cursor) return all;
    cursor = payload.next_cursor;
  }
  throw new Error(`generation pagination exceeded 20 pages for ${project}`);
}

function makeDiagnostics() {
  return { forbiddenRequests: [], failedResponses: [], failedRequests: [], pageErrors: [], consoleErrors: [], generationDetailRequests: [] };
}

function diagnosticsForPage(page, diagnostics, origin, project) {
  const generationPrefix = `${origin}/api/astrid/projects/${encodeURIComponent(project)}/generations/`;
  page.on('request', (request) => {
    const url = request.url();
    if (/127\.0\.0\.1:54321|localhost:54321|supabase\.(?:co|in)/i.test(url)) diagnostics.forbiddenRequests.push(`${request.method()} ${url}`);
    if (url.startsWith(generationPrefix) && !url.includes('?')) diagnostics.generationDetailRequests.push(`${request.method()} ${url}`);
  });
  page.on('requestfailed', (request) => diagnostics.failedRequests.push(`${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`));
  page.on('response', (response) => { if (response.status() >= 400) diagnostics.failedResponses.push(`${response.status()} ${response.url()}`); });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
}

function assertDiagnostics(diagnostics) {
  assert.deepEqual(unique(diagnostics.forbiddenRequests), [], 'local Astrid journey must not contact Supabase');
  assert.deepEqual(unique(diagnostics.pageErrors), [], 'local Astrid journey must not throw page errors');
  assert.deepEqual(unique(diagnostics.consoleErrors), [], 'local Astrid journey must not emit browser console errors');
  const unexpectedResponses = diagnostics.failedResponses.filter((line) => !line.includes('/media/__reigh_capability_probe__/content'));
  const unexpectedRequests = diagnostics.failedRequests.filter((line) => !line.includes('/media/__reigh_capability_probe__/content'));
  assert.deepEqual(unique(unexpectedResponses), [], 'local Astrid journey must not receive unexpected HTTP failures');
  assert.deepEqual(unique(unexpectedRequests), [], 'local Astrid journey must not have failed network requests');
  const probes = diagnostics.failedResponses.filter((line) => line.includes('/media/__reigh_capability_probe__/content'));
  assert.ok(probes.length <= 6, 'capability sentinel failures remain bounded');
}

async function readCardClipIds(locator) {
  const timeline = locator.getByRole('img', { name: /visual timeline:/i });
  assert.equal(await timeline.count(), 1, 'shot owns one mini timeline');
  return timeline.locator('[title]').evaluateAll((elements) => elements.map((element) => element.getAttribute('title')?.split(':')[0]).filter(Boolean));
}

async function runRow(page, origin, row, evidenceRoot, rowNumber) {
  const { project, timeline } = row;
  const query = new URLSearchParams({ localProject: project, localTimeline: timeline }).toString();
  const travelUrl = `${origin}/tools/travel-between-images?${query}`;
  const timelinePayload = await fetchJson(`${origin}/api/astrid/projects/${encodeURIComponent(project)}/timelines/${encodeURIComponent(timeline)}`);
  const generations = await fetchGenerations(origin, project);
  const shots = deriveShotExpectations(timelinePayload);
  const imageGenerations = generations.filter((generation) => generation.type === 'image');
  const expectedImageIds = imageGenerations.map((generation) => generation.generation_id);
  assert.ok(shots.length > 0, `${project} timeline must expose pinnedShotGroups`);
  assert.ok(imageGenerations.length > 0, `${project} must expose at least one image generation`);
  if (row.expectedShots !== undefined) assert.equal(shots.length, row.expectedShots, `${project} document-derived shot count`);
  if (row.expectedGenerations !== undefined) assert.equal(generations.length, row.expectedGenerations, `${project} generation count`);
  assert.ok(generations.every((generation) => Number(generation.variant_count) >= 1), `${project} generations expose variant associations`);

  const diagnostics = makeDiagnostics();
  diagnosticsForPage(page, diagnostics, origin, project);
  await page.goto(travelUrl, { waitUntil: 'commit', timeout: 45_000 });
  await page.getByRole('heading', { name: 'Timeline shots' }).waitFor({ timeout: 30_000 });
  const shotCards = page.getByRole('button', { name: /^Select shot / });
  await waitUntil(async () => (await shotCards.count()) === shots.length);
  assert.equal(await shotCards.count(), shots.length, `${project} timeline overview matches pinnedShotGroups`);
  for (let index = 0; index < shots.length; index += 1) {
    const expected = shots[index];
    const card = shotCards.nth(index);
    assert.equal(await card.getAttribute('aria-label'), `Select shot ${expected.name}`, `${project} shot ${index + 1} name is document-derived`);
    assert.deepEqual(sorted(unique(await readCardClipIds(card))), sorted(unique(expected.visualClipIds)), `${project} shot ${index + 1} mini timeline is scoped to its pinned clipIds`);
  }

  const representativeShot = shots.find((shot) => shot.visualClipIds.length > 0) ?? shots[0];
  const representativeIndex = shots.indexOf(representativeShot);
  await shotCards.nth(representativeIndex).click();
  const selectedHash = new URL(page.url()).hash;
  assert.notEqual(selectedHash, '', `${project} shot selection is linkable`);
  const detail = page.getByLabel(`Shot detail: ${representativeShot.name}`);
  await detail.waitFor({ timeout: 30_000 });
  const focusedTimeline = detail.getByRole('img', { name: new RegExp(`${escapeRegExp(representativeShot.name)} focused visual timeline`, 'i') });
  assert.equal(await focusedTimeline.count(), 1, `${project} focused shot has one detail timeline`);
  const focusedClipIds = await focusedTimeline.locator('[title]').evaluateAll((elements) => elements.map((element) => element.getAttribute('title')?.split(':')[0]).filter(Boolean));
  assert.deepEqual(sorted(unique(focusedClipIds)), sorted(unique(representativeShot.visualClipIds)), `${project} focused shot only renders that shot's clips`);

  await page.reload({ waitUntil: 'commit', timeout: 45_000 });
  await waitUntil(async () => (await page.getByLabel(`Shot detail: ${representativeShot.name}`).count()) > 0, 60_000);
  assert.equal(new URL(page.url()).hash, selectedHash, `${project} deep-link survives refresh`);
  await page.goBack({ waitUntil: 'commit', timeout: 45_000 });
  await page.getByRole('heading', { name: 'Timeline shots' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByRole('button', { name: /^Select shot / }).count(), shots.length, `${project} browser back returns to shot overview`);
  assert.equal(await page.getByLabel(`Shot detail: ${representativeShot.name}`).count(), 0, `${project} browser back leaves shot detail`);

  await page.getByRole('button', { name: 'Go to Image Generation tool' }).click();
  await page.getByRole('heading', { name: 'Image Generation' }).waitFor({ timeout: 30_000 });
  const destination = new URL(page.url());
  assert.equal(destination.searchParams.get('localProject'), project, `${project} tool navigation preserves local project`);
  assert.equal(destination.searchParams.get('localTimeline'), timeline, `${project} tool navigation preserves local timeline`);
  const galleryItems = page.locator('[data-gallery-item-id]');
  await waitUntil(async () => (await galleryItems.count()) >= Math.min(expectedImageIds.length, 45));
  const visibleIds = await galleryItems.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-gallery-item-id')).filter(Boolean));
  assert.equal(visibleIds.length, Math.min(expectedImageIds.length, 45), `${project} gallery renders the expected page size`);
  assert.ok(visibleIds.every((id) => expectedImageIds.includes(id)), `${project} gallery items belong to authoritative image generations`);
  if (expectedImageIds.length <= 45) assert.deepEqual(sorted(visibleIds), sorted(expectedImageIds), `${project} gallery shows every image generation`);

  const representativeGeneration = imageGenerations.find((generation) => generation.generation_id === visibleIds[0]) ?? imageGenerations[0];
  const authoritativeDetail = await fetchJson(`${origin}/api/astrid/projects/${encodeURIComponent(project)}/generations/${encodeURIComponent(representativeGeneration.generation_id)}`);
  const authoritativeVariants = authoritativeDetail?.generation?.variants ?? authoritativeDetail?.variants;
  assert.ok(Array.isArray(authoritativeVariants), `${project} generation detail exposes variants`);
  const expectedVariantCount = authoritativeVariants.length;
  assert.equal(Number(representativeGeneration.variant_count), expectedVariantCount, `${project} list and detail variant counts agree`);
  diagnostics.generationDetailRequests.length = 0;
  await galleryItems.filter({ has: page.locator(`img[src*="${representativeGeneration.primary?.media_id}"]`) }).first().dblclick();
  const lightbox = page.getByRole('dialog');
  await lightbox.waitFor({ timeout: 30_000 });
  await waitUntil(async () => /variants\s*\(\d+\)/i.test(await lightbox.innerText()));
  const variantMatch = /variants\s*\((\d+)\)/i.exec(await lightbox.innerText());
  assert.equal(Number(variantMatch?.[1]), expectedVariantCount, `${project} lightbox variant count matches bridge detail`);
  const matchingDetailRequests = diagnostics.generationDetailRequests.filter((request) => request.endsWith(`/${representativeGeneration.generation_id}`));
  assert.ok(matchingDetailRequests.length >= 1, `${project} lightbox requests representative generation detail`);
  assert.equal(new Set(matchingDetailRequests).size, 1, `${project} lightbox detail requests stay scoped to one generation`);
  await page.screenshot({ path: resolve(evidenceRoot, `${String(rowNumber).padStart(2, '0')}-${project}-gallery.png`), fullPage: true });

  // We are already on this exact URL. A same-URL goto can be a no-op and
  // leave the modal mounted, so use a true document reload for persistence.
  await page.reload({ waitUntil: 'commit', timeout: 45_000 });
  await page.getByRole('heading', { name: 'Image Generation' }).waitFor({ timeout: 30_000 });
  await waitUntil(async () => (await page.locator('[data-gallery-item-id]').count()) >= Math.min(expectedImageIds.length, 45));
  assertDiagnostics(diagnostics);
  return { project, timeline, shots: shots.length, generations: generations.length, imageGenerations: imageGenerations.length, representativeShot: representativeShot.id, representativeGeneration: representativeGeneration.generation_id, variantCount: expectedVariantCount, detailRequestsOnOpen: diagnostics.generationDetailRequests.length, diagnostics: { failedResponses: unique(diagnostics.failedResponses), failedRequests: unique(diagnostics.failedRequests), consoleErrors: unique(diagnostics.consoleErrors) } };
}

export async function runAcceptance({ origin, rows, evidenceDir, headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const results = [];
  try {
    for (let index = 0; index < rows.length; index += 1) results.push(await runRow(page, origin, rows[index], evidenceDir, index + 1));
  } finally { await browser.close(); }
  return results;
}

async function main() {
  const origin = (process.env.REIGH_LIVE_ORIGIN || 'http://127.0.0.1:2222').replace(/\/$/, '');
  const matrixRequested = process.env.REIGH_ACCEPTANCE_MATRIX === '1' || Boolean(process.env.REIGH_LOCAL_PROJECT_MATRIX);
  const rows = process.env.REIGH_LOCAL_PROJECT_MATRIX
    ? parseProjectMatrix(process.env.REIGH_LOCAL_PROJECT_MATRIX)
    : matrixRequested ? DEFAULT_MATRIX : [{ project: process.env.REIGH_LOCAL_PROJECT || DEFAULT_PROJECT, timeline: process.env.REIGH_LOCAL_TIMELINE || DEFAULT_TIMELINE, expectedShots: Number(process.env.REIGH_EXPECTED_SHOTS || 5), expectedGenerations: Number(process.env.REIGH_EXPECTED_GENERATIONS || 35) }];
  if (matrixRequested) assert.ok(rows.length >= 3, 'matrix acceptance requires at least three configured projects');
  const evidenceDir = resolve(process.env.REIGH_ACCEPTANCE_EVIDENCE || `/tmp/reigh-local-project-${process.pid}`);
  mkdirSync(evidenceDir, { recursive: true });
  const results = await runAcceptance({ origin, rows, evidenceDir, headed: process.env.HEADED === '1' });
  process.stdout.write(`${JSON.stringify({ ok: true, mode: matrixRequested ? 'matrix' : 'single-project', origin, rows: results, evidenceDir }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { process.stderr.write(`${error?.stack || error}\n`); process.exitCode = 1; }
}
