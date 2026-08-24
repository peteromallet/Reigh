import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  BASE_URL,
  CLIP_BODY_SELECTOR,
  PROJECT_SLUG,
  TIMELINE_SLUG,
  resetBridgeBaseline,
} from './support';

const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=1`;
const TRANSCRIPT_CAPTION_BODY_SELECTOR = `${CLIP_BODY_SELECTOR}[data-clip-id^="transcript-caption-"]`;
const EVIDENCE = resolve(process.cwd(), 'docs/extensions/evidence/chrome-acceptance');
const execFileAsync = promisify(execFile);

type ProbeStream = {
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  time_base?: string;
};

type ProbePacket = {
  pts_time?: string;
  duration_time?: string;
};

async function ffprobeJson(outputPath: string, args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    ...args,
    '-of', 'json',
    outputPath,
  ]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

test.describe('caption materialization render and export', () => {
  test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

  test('renders the materialized transcript into a downloadable MP4 without font-stretch warning flood', async ({ page }) => {
    test.setTimeout(300_000);
    await mkdir(EVIDENCE, { recursive: true });
    expect(await resetBridgeBaseline()).toBeNull();

    const consoleWarnings: Array<{
      type: string;
      text: string;
      location: { url: string; lineNumber: number; columnNumber: number };
    }> = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleWarnings.push({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // CDP log metadata makes an upstream warning actionable if Chromium emits it.
    const cdp = await page.context().newCDPSession(page);
    const cdpLogEntries: Array<{
      source: string;
      level: string;
      text: string;
      url?: string;
      lineNumber?: number;
      stackTrace?: unknown;
    }> = [];
    await cdp.send('Log.enable');
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (/fontstretch|canvasfontstretch/i.test(entry.text)) {
        cdpLogEntries.push({
          source: entry.source,
          level: entry.level,
          text: entry.text,
          url: entry.url,
          lineNumber: entry.lineNumber,
          stackTrace: entry.stackTrace,
        });
      }
    });

    await page.addInitScript(() => {
      localStorage.removeItem('reigh.dev-extensions.disabled');
    });
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const transcriptRow = page.locator('[data-lane-kind="reigh.transcript"]');
    const actions = transcriptRow.getByRole('button', { name: 'Transcript actions' });
    await expect(actions).toBeVisible({ timeout: 20_000 });
    await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await actions.click();
    await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();

    // Each logical caption can appear in several synchronized editor surfaces;
    // assert materialization, not an implementation-specific DOM multiplier.
    await expect.poll(
      () => page.locator(TRANSCRIPT_CAPTION_BODY_SELECTOR).count(),
      { timeout: 20_000 },
    ).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Render', exact: true }).click();

    const downloadLink = page.getByRole('link', { name: /download/i });
    await expect(downloadLink).toBeVisible({ timeout: 240_000 });
    await page.screenshot({
      path: resolve(EVIDENCE, '28-headless-remotion-4.0.503-render-complete.png'),
      fullPage: true,
    });

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await downloadLink.click();
    const download = await downloadPromise;
    const outputPath = resolve(EVIDENCE, '28-headless-caption-render-remotion-4.0.503.mp4');
    await download.saveAs(outputPath);
    expect((await stat(outputPath)).size).toBeGreaterThan(100_000);
    expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp');

    // Validate the encoded media, not only that the browser produced an MP4-shaped blob.
    // 315 frames is the deterministic 10.5 s fixture horizon at 30 fps. AAC encoders
    // may retain a handful of priming/padding blocks, so compare the packet end against
    // the composition boundary and cap that codec allowance at five 1024-sample blocks.
    const streamProbe = await ffprobeJson(outputPath, [
      '-show_entries',
      'stream=codec_name,codec_type,width,height,r_frame_rate,nb_frames,duration,time_base',
    ]);
    const streams = (streamProbe.streams ?? []) as ProbeStream[];
    const video = streams.find((stream) => stream.codec_type === 'video');
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    expect(video).toMatchObject({
      codec_name: 'h264',
      width: 1280,
      height: 720,
      r_frame_rate: '30/1',
      nb_frames: '315',
    });
    expect(audio?.codec_name).toBe('aac');

    const videoPacketsProbe = await ffprobeJson(outputPath, [
      '-select_streams', 'v:0',
      '-show_entries', 'packet=pts_time,duration_time',
    ]);
    const videoPackets = (videoPacketsProbe.packets ?? []) as ProbePacket[];
    const lastVideoPacket = videoPackets.at(-1);
    const videoPacketEnd = Number(lastVideoPacket?.pts_time) + Number(lastVideoPacket?.duration_time);
    const nominalDuration = 315 / 30;
    expect(videoPackets).toHaveLength(315);
    expect(videoPacketEnd).toBeCloseTo(nominalDuration, 5);

    const audioDuration = Number(audio?.duration);
    const maxAacPaddingSeconds = (5 * 1024) / 48_000;
    expect(audioDuration).toBeGreaterThanOrEqual(nominalDuration);
    expect(audioDuration - nominalDuration).toBeLessThanOrEqual(maxAacPaddingSeconds);

    const fontStretchWarnings = consoleWarnings.filter((message) => /fontstretch|canvasfontstretch/i.test(message.text));
    await writeFile(
      resolve(EVIDENCE, '28-render-console-diagnostics.json'),
      `${JSON.stringify({
        node: process.version,
        consoleWarnings,
        pageErrors,
        fontStretchWarnings,
        cdpFontStretchLogEntries: cdpLogEntries,
      }, null, 2)}\n`,
      'utf8',
    );
    expect(
      fontStretchWarnings,
      JSON.stringify({ fontStretchWarnings, cdpLogEntries }, null, 2),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
