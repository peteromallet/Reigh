import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { BASE_URL, BRIDGE_ORIGIN, PROJECT_SLUG, browserEvidencePath } from './support';

const execFileAsync = promisify(execFile);
const TIMELINE_SLUG = 'audio-reactive-colour-timeline';
const TIMELINE_URL = `${BRIDGE_ORIGIN}/projects/${PROJECT_SLUG}/timelines/${TIMELINE_SLUG}`;
const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&localBrowserRender=1`;
const FRAME_COUNT = 18;
const FPS = 30;
const COLOR_TOLERANCE = 10;

type ProbeStream = {
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  nb_read_frames?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
};

function expectedRgb(frame: number): readonly [number, number, number] {
  if (frame < 2) return [0, 0, 0];
  if (frame < 4) return [0x20, 0x30, 0x40];
  return [0x40, 0x50, 0x60];
}

async function ffprobeJson(outputPath: string, args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    ...args,
    '-of', 'json',
    outputPath,
  ]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function decodeCenterPixels(outputPath: string): Promise<Array<readonly [number, number, number]>> {
  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', outputPath,
    '-map', '0:v:0',
    '-an',
    '-vf', 'crop=8:8:316:176,format=rgb24',
    '-frames:v', String(FRAME_COUNT),
    '-f', 'rawvideo',
    'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  const pixelsPerFrame = 8 * 8;
  expect(bytes).toHaveLength(FRAME_COUNT * pixelsPerFrame * 3);
  return Array.from({ length: FRAME_COUNT }, (_, frame) => {
    const values = [[], [], []] as [number[], number[], number[]];
    const frameOffset = frame * pixelsPerFrame * 3;
    for (let pixel = 0; pixel < pixelsPerFrame; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        values[channel].push(bytes[frameOffset + (pixel * 3) + channel] ?? -1);
      }
    }
    return values.map((channel) => {
      channel.sort((left, right) => left - right);
      return channel[Math.floor(channel.length / 2)] ?? -1;
    }) as readonly [number, number, number];
  });
}

function withinExpectedColor(pixel: readonly number[], frame: number): boolean {
  const expected = expectedRgb(frame);
  return pixel.length === 3 && pixel.every((channel, index) => (
    Math.abs(channel - expected[index]) <= COLOR_TOLERANCE
  ));
}

async function assertDecodedFixture(outputPath: string): Promise<void> {
  const streamProbe = await ffprobeJson(outputPath, [
    '-count_frames',
    '-show_entries',
    'stream=codec_name,codec_type,width,height,r_frame_rate,nb_read_frames,duration,sample_rate,channels',
  ]);
  const streams = (streamProbe.streams ?? []) as ProbeStream[];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  expect(video).toMatchObject({
    codec_name: 'h264',
    width: 640,
    height: 360,
    r_frame_rate: '30/1',
    nb_read_frames: String(FRAME_COUNT),
  });
  expect(audio?.codec_name).toBe('aac');
  expect(audio?.sample_rate).toBe('44100');
  expect(audio?.channels).toBe(2);
  // ffprobe reports the final frame PTS as stream duration for this valid
  // CFR stream; packet end is the actual composition boundary (18 × 1/30s).
  const videoPacketsProbe = await ffprobeJson(outputPath, [
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,duration_time',
  ]);
  const videoPackets = (videoPacketsProbe.packets ?? []) as Array<{ pts_time?: string; duration_time?: string }>;
  const lastPacket = videoPackets.at(-1);
  const packetEnd = Number(lastPacket?.pts_time) + Number(lastPacket?.duration_time);
  expect(videoPackets).toHaveLength(FRAME_COUNT);
  expect(packetEnd).toBeCloseTo(FRAME_COUNT / FPS, 5);
  expect(Number(audio?.duration)).toBeGreaterThan(0.5);
  expect(Number(audio?.duration)).toBeLessThan(0.75);

  const { stdout: audioRaw } = await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', outputPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '2',
    '-ar', '44100',
    '-f', 's16le',
    'pipe:1',
  ], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
  const audioBytes = Buffer.isBuffer(audioRaw) ? audioRaw : Buffer.from(audioRaw);
  const samples = new Int16Array(audioBytes.buffer, audioBytes.byteOffset, Math.floor(audioBytes.byteLength / 2));
  const rms = Math.sqrt([...samples].reduce((sum, sample) => sum + (sample * sample), 0) / Math.max(1, samples.length));
  expect(rms).toBeGreaterThan(1);

  const pixels = await decodeCenterPixels(outputPath);
  expect(pixels).toHaveLength(FRAME_COUNT);
  for (const [frame, pixel] of pixels.entries()) {
    expect(
      withinExpectedColor(pixel, frame),
      `frame ${frame}: expected RGB ${expectedRgb(frame).join(',')}, decoded median RGB ${pixel.join(',')}`,
    ).toBe(true);
  }
  // Explicit boundary checks catch a one-frame shift even if the color
  // tolerance above is later widened for a different browser encoder.
  expect(withinExpectedColor(pixels[1] ?? [], 1)).toBe(true);
  expect(withinExpectedColor(pixels[2] ?? [], 2)).toBe(true);
  expect(withinExpectedColor(pixels[3] ?? [], 3)).toBe(true);
  expect(withinExpectedColor(pixels[4] ?? [], 4)).toBe(true);
}

test.describe('audio-reactive-colour browser export proof', () => {
  test.use({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

  test('renders the pinned Astrid marker fixture with exact decoded frame boundaries', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const forbiddenRequests: string[] = [];
    const saveRequests: string[] = [];
    const notFoundResponses: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      const url = request.url();
      if (/(supabase\.co|127\.0\.0\.1:54321|localhost:54321|\/auth\/v1\/|\/rest\/v1\/|\/functions\/v1\/)/.test(url)) {
        forbiddenRequests.push(url);
      }
      if (request.method() === 'POST' && /\/timelines\/[^/]+\/save$/.test(new URL(url).pathname)) {
        saveRequests.push(url);
      }
    });
    page.on('response', (response) => {
      if (response.status() === 404) notFoundResponses.push(response.url());
    });

    const reset = await fetch(`${BRIDGE_ORIGIN}/__test/reset`, { method: 'POST' });
    expect(reset.ok).toBe(true);
    const beforeResponse = await fetch(TIMELINE_URL);
    expect(beforeResponse.ok).toBe(true);
    const before = await beforeResponse.json() as {
      config: Record<string, unknown>;
      registry: Record<string, unknown>;
      config_version: number;
    };
    expect(before.config.output).toMatchObject({ resolution: '640x360', fps: FPS });
    expect(before.config.clips).toHaveLength(2);

    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const renderer = page.getByTestId('audio-reactive-colour-renderer');
    await expect(renderer).toBeVisible({ timeout: 30_000 });
    await expect(renderer).toHaveAttribute('data-frame', '0');
    await expect(renderer).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await page.screenshot({
      path: browserEvidencePath(testInfo, 'audio-reactive-colour/preview-frame-0.png'),
      fullPage: true,
    });

    const renderButton = page.getByRole('button', { name: /^Render(?: \d+%)?$/ });
    await expect(renderButton).toBeEnabled();
    await renderButton.click();
    const downloadLink = page.getByRole('link', { name: 'Download', exact: true });
    const renderBlocker = page.locator('[data-video-editor-render-blocker="true"]');
    await expect.poll(async () => {
      if (await downloadLink.isVisible()) return 'done';
      if (await renderBlocker.isVisible()) return `error:${(await renderBlocker.textContent())?.trim() ?? '<empty>'}`;
      return 'pending';
    }, { timeout: 120_000, message: 'browser render did not complete' }).toBe('done');

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await downloadLink.click();
    const download = await downloadPromise;
    const outputPath = browserEvidencePath(testInfo, 'audio-reactive-colour/browser-render.mp4');
    await download.saveAs(outputPath);
    expect((await stat(outputPath)).size).toBeGreaterThan(1_000);
    expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp');

    await assertDecodedFixture(outputPath);

    // Rendering is client-only and must not write the timeline. Repeat it to
    // prove idempotency and to catch accidental bridge persistence coupling.
    await expect(renderButton).toBeEnabled();
    const firstDownloadHref = await downloadLink.getAttribute('href');
    await renderButton.click();
    await expect(renderButton).toBeDisabled({ timeout: 5_000 });
    await expect(downloadLink).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => downloadLink.getAttribute('href')).not.toBe(firstDownloadHref);
    const secondDownloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await downloadLink.click();
    const secondDownload = await secondDownloadPromise;
    const secondOutputPath = browserEvidencePath(testInfo, 'audio-reactive-colour/browser-render-repeat.mp4');
    await secondDownload.saveAs(secondOutputPath);
    expect((await stat(secondOutputPath)).size).toBeGreaterThan(1_000);
    expect((await readFile(secondOutputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp');
    await assertDecodedFixture(secondOutputPath);
    const afterResponse = await fetch(TIMELINE_URL);
    expect(afterResponse.ok).toBe(true);
    const after = await afterResponse.json() as {
      config: Record<string, unknown>;
      registry: Record<string, unknown>;
      config_version: number;
    };
    expect(after.config_version).toBe(before.config_version);
    expect(after.config).toEqual(before.config);
    expect(after.registry).toEqual(before.registry);
    expect(saveRequests).toEqual([]);

    expect(forbiddenRequests).toEqual([]);
    expect(notFoundResponses.filter((url) => !url.includes('__reigh_capability_probe__'))).toEqual([]);
    expect(pageErrors).toEqual([]);
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource.*404/i.test(message));
    expect(unexpectedConsoleErrors).toEqual([]);
  });
});
