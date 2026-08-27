import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = (process.env.REIGH_LIVE_ORIGIN || 'http://127.0.0.1:2222').replace(/\/$/, '');
const project = process.env.REIGH_LOCAL_PROJECT || 'desert-plant-growth';
const timeline = process.env.REIGH_LOCAL_TIMELINE || '01KYPVKMW5STB4W6FE05ED8242';
const expectedShots = Number(process.env.REIGH_EXPECTED_SHOTS || 5);
const expectedGenerations = Number(process.env.REIGH_EXPECTED_GENERATIONS || 35);
const evidenceDir = resolve(process.env.REIGH_ACCEPTANCE_EVIDENCE || `/tmp/reigh-local-project-${process.pid}`);
mkdirSync(evidenceDir, { recursive: true });

const localQuery = new URLSearchParams({ localProject: project, localTimeline: timeline }).toString();
const travelUrl = `${origin}/tools/travel-between-images?${localQuery}`;
const expectedGenerationPrefix = `${origin}/api/astrid/projects/${encodeURIComponent(project)}/generations/`;
const forbiddenRequests = [];
const failedResponses = [];
const pageErrors = [];
const consoleErrors = [];
const generationDetailRequests = [];

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on('request', (request) => {
  const url = request.url();
  if (/127\.0\.0\.1:54321|localhost:54321|supabase\.(?:co|in)/i.test(url)) {
    forbiddenRequests.push(`${request.method()} ${url}`);
  }
  if (url.startsWith(expectedGenerationPrefix) && !url.includes('?')) {
    generationDetailRequests.push(`${request.method()} ${url}`);
  }
});
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

try {
  await page.goto(travelUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.getByRole('heading', { name: 'Timeline shots' }).waitFor({ timeout: 30_000 });

  const shotCards = page.getByRole('button', { name: /^Select shot / });
  assert.equal(await shotCards.count(), expectedShots, 'document-derived shot count');
  for (let index = 0; index < expectedShots; index += 1) {
    const card = shotCards.nth(index);
    assert.equal(await card.getByRole('img', { name: /visual timeline:/i }).count(), 1, `shot ${index + 1} owns one mini timeline`);
    const visibleClipCount = await card.locator('[title*=": "]').count();
    const cardText = await card.innerText();
    assert.match(cardText, new RegExp(`${visibleClipCount} visual clip${visibleClipCount === 1 ? '' : 's'}`), `shot ${index + 1} status matches its scoped clips`);
  }

  const firstShot = shotCards.first();
  await firstShot.click();
  assert.equal(await firstShot.getAttribute('aria-pressed'), 'true', 'shot selection is visibly exposed');
  const selectedHash = new URL(page.url()).hash;
  assert.notEqual(selectedHash, '', 'shot selection is linkable');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Timeline shots' }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByRole('button', { name: /^Select shot / }).first().getAttribute('aria-pressed'), 'true', 'shot selection survives refresh');
  await page.screenshot({ path: resolve(evidenceDir, 'travel-shot-timelines.png'), fullPage: true });

  await page.getByRole('button', { name: 'Go to Image Generation tool' }).click();
  await page.getByRole('heading', { name: 'Image Generation' }).waitFor({ timeout: 30_000 });
  const destination = new URL(page.url());
  assert.equal(destination.searchParams.get('localProject'), project, 'tool navigation preserves local project');
  assert.equal(destination.searchParams.get('localTimeline'), timeline, 'tool navigation preserves local timeline');

  const generationPage = await page.evaluate(async ({ projectSlug }) => {
    const response = await fetch(`/api/astrid/projects/${encodeURIComponent(projectSlug)}/generations?limit=200`);
    if (!response.ok) throw new Error(`generation list returned ${response.status}`);
    return response.json();
  }, { projectSlug: project });
  assert.equal(generationPage.generations.length, expectedGenerations, 'all project generations are available');
  assert.ok(generationPage.generations.every((generation) => generation.variant_count >= 1), 'every migrated generation exposes a variant association');

  const expectedImages = generationPage.generations.filter((generation) => generation.type === 'image').length;
  const galleryImages = page.locator(`img[src*="/api/astrid/projects/${project}/media/"]`);
  await galleryImages.first().waitFor({ timeout: 30_000 });
  assert.equal(await galleryImages.count(), expectedImages, 'Image Generation gallery shows every image generation for the project');

  generationDetailRequests.length = 0;
  await galleryImages.first().dblclick();
  const lightbox = page.getByRole('dialog');
  await lightbox.waitFor({ timeout: 30_000 });
  await lightbox.getByText(/variants \(\d+\)/i).waitFor({ timeout: 30_000 });
  assert.match(await lightbox.innerText(), /variants \([1-9]\d*\)/i, 'variant association is visible in the lightbox');
  await page.waitForTimeout(500);
  assert.equal(generationDetailRequests.length, 1, 'opening one generation performs one shared detail request');
  await page.screenshot({ path: resolve(evidenceDir, 'image-gallery-variants.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Image Generation' }).waitFor({ timeout: 30_000 });
  await page.locator(`img[src*="/api/astrid/projects/${project}/media/"]`).first().waitFor({ timeout: 30_000 });
  assert.equal(await page.locator(`img[src*="/api/astrid/projects/${project}/media/"]`).count(), expectedImages, 'gallery survives refresh');

  assert.deepEqual(forbiddenRequests, [], 'local Astrid journey must not contact Supabase');
  assert.deepEqual(pageErrors, [], 'local Astrid journey must not throw page errors');
  const unexpectedFailures = failedResponses.filter((line) => !line.includes('/media/__reigh_capability_probe__/content'));
  assert.deepEqual(unexpectedFailures, [], 'local Astrid journey must not receive unexpected HTTP failures');
  const expectedProbeFailures = failedResponses.filter((line) => line.includes('/media/__reigh_capability_probe__/content'));
  assert.ok(expectedProbeFailures.length <= 6, 'capability sentinel failures remain bounded');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    origin,
    project,
    timeline,
    shots: expectedShots,
    generations: generationPage.generations.length,
    imageGenerations: expectedImages,
    detailRequestsOnOpen: generationDetailRequests.length,
    expectedCapabilityProbeFailures: expectedProbeFailures.length,
    consoleErrors: [...new Set(consoleErrors)],
    evidenceDir,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
