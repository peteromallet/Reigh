import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  BASE_URL,
  BRIDGE_ORIGIN,
  CLIP_BODY_SELECTOR,
  PROJECT_SLUG,
  TIMELINE_SLUG,
} from './support.ts';

const MATRIX_CASES = [23.976, 24, 25, 29.97, 30, 48, 60] as const;
const MATRIX_DURATION_SECONDS = 1.25;
const MATRIX_WIDTH = 640;
const MATRIX_HEIGHT = 360;
const CAPTION_ROW_Y = Math.round(MATRIX_HEIGHT * 0.58);
const CAPTION_ROW_HEIGHT = Math.round(MATRIX_HEIGHT * 0.14);
const MIN_CAPTION_ROW_FOREGROUND_PIXELS = 100;
const EXPECTED_CAPTIONS = 4;
const EXPECTED_CAPTION_INTERVALS = [
  { start: 0, end: 0.205, row: 0 },
  { start: 0.167, end: 0.409, row: 1 },
  { start: 0.584, end: 0.792, row: 0 },
  { start: 0.73, end: 1.25, row: 1 },
] as const;
const EDITOR_URL = `${BASE_URL}/tools/video-editor?localProject=${PROJECT_SLUG}&localTimeline=${TIMELINE_SLUG}&localTest=1&transcriptLaneFixture=render-matrix&runawayTimelineProject=runaway-8085`;
const EVIDENCE = resolve(process.env.RENDER_MATRIX_EVIDENCE ?? 'artifacts/render-export-matrix');
const BRIDGE_TIMELINE = `${BRIDGE_ORIGIN}/projects/${PROJECT_SLUG}/timelines/${TIMELINE_SLUG}`;
const execFileAsync = promisify(execFile);

type ProbePacket = { pts_time?: string; duration_time?: string };
type ProbeStream = {
  codec_name?: string;
  codec_type?: string;
  sample_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  nb_frames?: string;
};

type MatrixResult = {
  fps: number;
  expectedFrames: number;
  videoPackets: number;
  encodedRate: string;
  videoEndSeconds: number;
  audioEndSeconds: number;
  audioVideoEndDriftSeconds: number;
  firstCaptionOccupancy: number;
  overlapOccupancy: number;
  gapOccupancy: number;
  lastCaptionOccupancy: number;
  overlapRowOccupancy: [number, number];
  lateOverlapRowOccupancy: [number, number];
  bytes: number;
  sha256: string;
};

type GitProvenance = {
  commit: string | null;
  dirty: boolean | null;
  statusSha256: string | null;
  capturedBeforeEvidenceWrite: true;
};

async function exec(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

async function execBuffer(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolveBuffer, rejectBuffer) => {
    execFile(command, args, {
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr;
        rejectBuffer(new Error(`${command} failed: ${detail || error.message}`));
        return;
      }
      resolveBuffer(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
    });
  });
}

async function readGitProvenance(): Promise<GitProvenance> {
  try {
    const commit = await exec('git', ['rev-parse', 'HEAD']);
    const status = await exec('git', ['status', '--porcelain=v1', '--untracked-files=all']);
    return {
      commit,
      dirty: status.length > 0,
      statusSha256: createHash('sha256').update(status).digest('hex'),
      capturedBeforeEvidenceWrite: true,
    };
  } catch {
    // Source archives and packaged test runners may not have a `.git`
    // directory. Provenance is best-effort metadata, never a local-dev gate.
    return {
      commit: null,
      dirty: null,
      statusSha256: null,
      capturedBeforeEvidenceWrite: true,
    };
  }
}

async function ffprobeJson(outputPath: string, args: string[]): Promise<Record<string, unknown>> {
  return JSON.parse(await exec('ffprobe', ['-v', 'error', ...args, '-of', 'json', outputPath])) as Record<string, unknown>;
}

function packetEnd(packets: ProbePacket[]): number {
  return Math.max(...packets.map((packet) => Number(packet.pts_time) + Number(packet.duration_time)));
}

function ratio(value: string): number {
  const [numerator, denominator] = value.split('/').map(Number);
  return numerator / denominator;
}

function roundedOverlapFrame(
  fps: number,
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  const intersectionStart = Math.max(
    Math.round(left.start * fps),
    Math.round(right.start * fps),
  );
  const intersectionEnd = Math.min(
    Math.round(left.end * fps),
    Math.round(right.end * fps),
  );
  if (intersectionStart >= intersectionEnd) {
    throw new Error(`No encoded overlap frame at ${fps}fps: ${intersectionStart}..${intersectionEnd}`);
  }
  return intersectionStart;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function extractFrame(videoPath: string, frame: number, outputPath: string): Promise<void> {
  await exec('ffmpeg', [
    '-y', '-v', 'error', '-i', videoPath,
    '-vf', `select=eq(n\\,${frame})`,
    '-frames:v', '1', outputPath,
  ]);
}

async function occupancy(path: string, crop?: string): Promise<number> {
  return Number(await exec('magick', [
    path,
    ...(crop ? ['-crop', crop, '+repage'] : []),
    '-colorspace', 'gray',
    '-threshold', '8%',
    '-format', '%[fx:mean]',
    'info:',
  ]));
}

function expectedCaptionRowPresence(fps: number, frame: number): [boolean, boolean] {
  return [0, 1].map((row) => EXPECTED_CAPTION_INTERVALS.some((interval) => (
    interval.row === row
    && frame >= Math.round(interval.start * fps)
    && frame < Math.round(interval.end * fps)
  ))) as [boolean, boolean];
}

async function decodedCaptionRowPresence(
  videoPath: string,
  expectedFrames: number,
): Promise<Array<[boolean, boolean]>> {
  const rawFrames = await execBuffer('ffmpeg', [
    '-v', 'error', '-i', videoPath,
    '-map', '0:v:0',
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1',
  ]);
  const bytesPerFrame = MATRIX_WIDTH * MATRIX_HEIGHT;
  expect(rawFrames).toHaveLength(expectedFrames * bytesPerFrame);

  return Array.from({ length: expectedFrames }, (_, frame) => {
    const frameOffset = frame * bytesPerFrame;
    return [0, 1].map((row) => {
      const rowStart = CAPTION_ROW_Y + (row * CAPTION_ROW_HEIGHT);
      let foregroundPixels = 0;
      for (let y = rowStart; y < rowStart + CAPTION_ROW_HEIGHT; y += 1) {
        const scanlineStart = frameOffset + (y * MATRIX_WIDTH);
        for (let x = 0; x < MATRIX_WIDTH; x += 1) {
          if (rawFrames[scanlineStart + x]! > 20) foregroundPixels += 1;
        }
      }
      return foregroundPixels > MIN_CAPTION_ROW_FOREGROUND_PIXELS;
    }) as [boolean, boolean];
  });
}

async function installMatrixConfig(fps: number): Promise<void> {
  const current = await (await fetch(BRIDGE_TIMELINE)).json() as { config: Record<string, unknown> };
  const response = await fetch(`${BRIDGE_TIMELINE}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        ...current.config,
        output: {
          resolution: '640x360',
          fps,
          file: `caption-matrix-${fps}.mp4`,
          background: '#000000',
          background_scale: null,
        },
        tracks: [
          { id: 'V1', kind: 'visual', label: 'Transcript carrier', opacity: 0, scale: 1, fit: 'contain', blendMode: 'normal' },
          { id: 'A1', kind: 'audio', label: 'Matrix audio', muted: false, volume: 1, scale: 1, fit: 'contain', opacity: 1, blendMode: 'normal' },
        ],
        clips: [
          { id: 'matrix-carrier', at: 0, track: 'V1', asset: 'demo-clip', clipType: 'media', from: 0, to: MATRIX_DURATION_SECONDS, opacity: 0 },
          { id: 'matrix-audio', at: 0, track: 'A1', asset: 'matrix-audio', clipType: 'media', from: 0, to: MATRIX_DURATION_SECONDS, volume: 1 },
        ],
      },
    }),
  });
  expect(response.ok, await response.text()).toBe(true);
}

test.describe.serial('real caption render/export release matrix', () => {
  test.use({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });

  test('derives both overlap probes from encoded interval intersections at every release rate', () => {
    for (const fps of MATRIX_CASES) {
      const early = roundedOverlapFrame(fps, { start: 0, end: 0.205 }, { start: 0.167, end: 0.409 });
      const late = roundedOverlapFrame(fps, { start: 0.584, end: 0.792 }, { start: 0.73, end: 1.25 });
      expect(early).toBe(Math.round(0.167 * fps));
      expect(late).toBe(Math.round(0.73 * fps));
    }
  });

  test('exports and probes every release frame rate', async ({ page }) => {
    test.setTimeout(1_200_000);
    const provenance = await readGitProvenance();
    await mkdir(EVIDENCE, { recursive: true });
    const results: MatrixResult[] = [];

    for (const fps of MATRIX_CASES) {
      await installMatrixConfig(fps);
      await page.addInitScript(() => localStorage.removeItem('reigh.dev-extensions.disabled'));
      await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      const transcriptRow = page.locator('[data-lane-kind="reigh.transcript"]');
      const actions = transcriptRow.getByRole('button', { name: 'Transcript actions' });
      await expect(actions).toBeVisible({ timeout: 30_000 });

      if (fps === MATRIX_CASES[0]) {
        const runaway = page.getByTestId('runaway-timeline-lane');
        await expect(runaway).toHaveAttribute('data-total-items', '566', { timeout: 30_000 });
        await expect(page.getByTestId('runaway-lane-summary')).toContainText('566 transitions');
        const mountedRunaway = page.getByTestId('runaway-transition-chip').first();
        await expect(mountedRunaway).toBeVisible();
        await mountedRunaway.click();
        await mountedRunaway.press('Home');
        const firstRunaway = page.getByRole('button', { name: /^T0001,/ });
        await expect(firstRunaway).toBeFocused();
        await firstRunaway.press('End');
        const lastRunaway = page.getByRole('button', { name: /^T0566,/ });
        await expect(lastRunaway).toBeFocused();
        await expect(page.getByTestId('runaway-transition-inspector')).toContainText('frame 8084 @ 48fps');
      }

      await page.locator('.timeline-canvas-edit-area').evaluate((scroller) => {
        scroller.scrollTop = scroller.scrollHeight;
      });
      await actions.click();
      await page.getByRole('menuitem', { name: 'Render transcript as editable video text' }).click();
      await expect.poll(async () => page.evaluate((clipBodySelector) => new Set(
        Array.from(document.querySelectorAll(`${clipBodySelector}[data-clip-id^="transcript-caption-"]`))
          .map((element) => element.getAttribute('data-clip-id')),
      ).size, CLIP_BODY_SELECTOR), { timeout: 20_000 }).toBe(EXPECTED_CAPTIONS);

      await page.getByRole('button', { name: 'Render', exact: true }).click();
      const downloadLink = page.getByRole('link', { name: /download/i });
      await expect(downloadLink).toBeVisible({ timeout: 240_000 });
      const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
      await downloadLink.click();
      const download = await downloadPromise;
      const label = String(fps).replace('.', '_');
      const outputPath = resolve(EVIDENCE, `caption-matrix-${label}fps.mp4`);
      await download.saveAs(outputPath);

      const bytes = (await stat(outputPath)).size;
      expect(bytes).toBeGreaterThan(10_000);
      expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp');

      const expectedFrames = Math.round(MATRIX_DURATION_SECONDS * fps);
      const streamsProbe = await ffprobeJson(outputPath, [
        '-show_entries', 'stream=codec_name,codec_type,sample_rate,avg_frame_rate,r_frame_rate,nb_frames',
      ]);
      const streams = (streamsProbe.streams ?? []) as ProbeStream[];
      const video = streams.find((stream) => stream.codec_type === 'video');
      const audio = streams.find((stream) => stream.codec_type === 'audio');
      expect(video?.codec_name).toBe('h264');
      expect(audio?.codec_name).toBe('aac');
      expect(audio?.sample_rate).toBe('48000');

      const videoProbe = await ffprobeJson(outputPath, [
        '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,duration_time',
      ]);
      const audioProbe = await ffprobeJson(outputPath, [
        '-select_streams', 'a:0', '-show_entries', 'packet=pts_time,duration_time',
      ]);
      const videoPackets = (videoProbe.packets ?? []) as ProbePacket[];
      const audioPackets = (audioProbe.packets ?? []) as ProbePacket[];
      const videoEndSeconds = packetEnd(videoPackets);
      const audioEndSeconds = packetEnd(audioPackets);
      // `avg_frame_rate` in short Mediabunny MP4s is derived from the stream
      // duration field, which omits the final packet duration.  The packet
      // cadence and `r_frame_rate` are the authoritative encoded rate.
      const encodedRate = video?.r_frame_rate ?? video?.avg_frame_rate ?? '0/1';
      const drift = audioEndSeconds - videoEndSeconds;

      expect(videoPackets).toHaveLength(expectedFrames);
      expect(ratio(encodedRate)).toBeCloseTo(fps, 3);
      expect(videoEndSeconds).toBeCloseTo(expectedFrames / fps, 4);
      // Browser AAC may retain codec priming/padding, but it must finish within
      // five 1024-sample blocks of the last video packet.
      expect(Math.abs(drift)).toBeLessThanOrEqual((5 * 1024) / 48_000);

      const rowPresence = await decodedCaptionRowPresence(outputPath, expectedFrames);
      for (const [frame, actual] of rowPresence.entries()) {
        expect(actual, `${fps}fps encoded frame ${frame} caption-row presence`).toEqual(
          expectedCaptionRowPresence(fps, frame),
        );
      }

      const firstPath = resolve(EVIDENCE, `caption-matrix-${label}fps-first.png`);
      const overlapPath = resolve(EVIDENCE, `caption-matrix-${label}fps-overlap.png`);
      const lateOverlapPath = resolve(EVIDENCE, `caption-matrix-${label}fps-overlap-late.png`);
      const gapPath = resolve(EVIDENCE, `caption-matrix-${label}fps-gap.png`);
      const lastPath = resolve(EVIDENCE, `caption-matrix-${label}fps-last.png`);
      await extractFrame(outputPath, 0, firstPath);
      await extractFrame(
        outputPath,
        roundedOverlapFrame(fps, { start: 0, end: 0.205 }, { start: 0.167, end: 0.409 }),
        overlapPath,
      );
      await extractFrame(
        outputPath,
        roundedOverlapFrame(fps, { start: 0.584, end: 0.792 }, { start: 0.73, end: 1.25 }),
        lateOverlapPath,
      );
      await extractFrame(outputPath, Math.round(0.5 * fps), gapPath);
      await extractFrame(outputPath, expectedFrames - 1, lastPath);
      const firstCaptionOccupancy = await occupancy(firstPath);
      const overlapOccupancy = await occupancy(overlapPath);
      const gapOccupancy = await occupancy(gapPath);
      const lastCaptionOccupancy = await occupancy(lastPath);
      const rowCrops = [0, 1].map((row) => (
        `${MATRIX_WIDTH}x${CAPTION_ROW_HEIGHT}+0+${CAPTION_ROW_Y + row * CAPTION_ROW_HEIGHT}`
      ));
      const overlapRowOccupancy = await Promise.all(
        rowCrops.map((crop) => occupancy(overlapPath, crop)),
      ) as [number, number];
      const lateOverlapRowOccupancy = await Promise.all(
        rowCrops.map((crop) => occupancy(lateOverlapPath, crop)),
      ) as [number, number];
      expect(firstCaptionOccupancy).toBeGreaterThan(gapOccupancy + 0.0005);
      expect(overlapOccupancy).toBeGreaterThan(firstCaptionOccupancy + 0.0005);
      expect(lastCaptionOccupancy).toBeGreaterThan(gapOccupancy + 0.0005);
      // Whole-frame occupancy allowed two captions painted into the same pixels
      // to pass. Both overlap probes must contain text in each distinct row.
      for (const rowOccupancy of [...overlapRowOccupancy, ...lateOverlapRowOccupancy]) {
        expect(rowOccupancy).toBeGreaterThan(0.001);
      }

      results.push({
        fps,
        expectedFrames,
        videoPackets: videoPackets.length,
        encodedRate,
        videoEndSeconds,
        audioEndSeconds,
        audioVideoEndDriftSeconds: drift,
        firstCaptionOccupancy,
        overlapOccupancy,
        gapOccupancy,
        lastCaptionOccupancy,
        overlapRowOccupancy,
        lateOverlapRowOccupancy,
        bytes,
        sha256: await sha256(outputPath),
      });
    }

    await writeFile(resolve(EVIDENCE, 'matrix-report.json'), `${JSON.stringify({
      node: process.version,
      npmUserAgent: process.env.npm_config_user_agent ?? null,
      chromium: page.context().browser()?.version() ?? null,
      provenance,
      verification: {
        allEncodedFramesCaptionRowPresence: true,
      },
      transcript: {
        sourceSegments: 5,
        materializedCaptions: EXPECTED_CAPTIONS,
        cases: ['first-frame', 'last-frame', 'fractional-boundaries', 'gap', 'overlap-lane-separation', 'Unicode', 'multi-speaker labels', 'empty-text filter'],
      },
      runaway: { transitions: 566, fps: 48, frameCount: 8085, firstFrame: 0, lastFrame: 8084 },
      passed: results.length,
      total: MATRIX_CASES.length,
      results,
    }, null, 2)}\n`, 'utf8');
    expect(results).toHaveLength(MATRIX_CASES.length);
  });
});
