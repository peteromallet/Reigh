#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const DEFAULT_MANIFEST_PATH = resolve(
  REPO_ROOT,
  'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-baseline-provenance.json',
);
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

class ProvenanceError extends Error {}

function fail(message) {
  throw new ProvenanceError(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readGitBlob(repoRoot, commit, path) {
  const result = spawnSync('git', ['show', `${commit}:${path}`], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(`could not read ${commit}:${path} from Git: ${result.stderr?.toString().trim() || result.error?.message || 'unknown error'}`);
  }
  return result.stdout;
}

function resolveCommit(repoRoot, ref, label) {
  if (!COMMIT.test(ref ?? '')) fail(`${label} must be a full lowercase commit pin`);
  const result = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== ref) {
    fail(`${label} is not available as the exact commit ${ref}`);
  }
  return ref;
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode the 8-bit PNG forms emitted by Playwright without adding a runtime
 * image dependency. The decoder also handles the other legal PNG colour
 * types so provenance remains useful if a browser changes screenshot alpha.
 */
function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) fail('baseline is not a PNG');
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colourType;
  let palette;
  let transparency;
  const idat = [];
  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) fail('baseline PNG contains a truncated chunk');
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colourType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        fail('baseline PNG uses unsupported compression, filter, or interlace');
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colourType)) {
    fail('baseline PNG is not a supported non-interlaced 8-bit image');
  }
  const channelCount = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  const bytesPerPixel = channelCount;
  const rowBytes = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const expectedBytes = height * (rowBytes + 1);
  if (inflated.length !== expectedBytes) fail('baseline PNG decompressed length is invalid');
  const rows = Buffer.alloc(height * rowBytes);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    const rowStart = y * rowBytes;
    const previousStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inputOffset++];
      const left = x >= bytesPerPixel ? rows[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? rows[previousStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? rows[previousStart + x - bytesPerPixel] : 0;
      if (filter === 0) rows[rowStart + x] = raw;
      else if (filter === 1) rows[rowStart + x] = (raw + left) & 0xff;
      else if (filter === 2) rows[rowStart + x] = (raw + up) & 0xff;
      else if (filter === 3) rows[rowStart + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) rows[rowStart + x] = (raw + paeth(left, up, upLeft)) & 0xff;
      else fail(`baseline PNG uses unknown row filter ${filter}`);
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  let outputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * rowBytes + x * bytesPerPixel;
      let red;
      let green;
      let blue;
      if (colourType === 0 || colourType === 4) {
        red = green = blue = rows[source];
      } else if (colourType === 2 || colourType === 6) {
        red = rows[source]; green = rows[source + 1]; blue = rows[source + 2];
      } else {
        const index = rows[source];
        if (!palette || index * 3 + 2 >= palette.length) fail('indexed baseline PNG has no valid palette entry');
        red = palette[index * 3]; green = palette[index * 3 + 1]; blue = palette[index * 3 + 2];
      }
      rgb[outputOffset++] = red;
      rgb[outputOffset++] = green;
      rgb[outputOffset++] = blue;
    }
  }
  return { width, height, rgb, channels: 3, transparency: Boolean(transparency) };
}

function calculateDiff(oldImage, newImage) {
  if (oldImage.width !== newImage.width || oldImage.height !== newImage.height) {
    fail(`baseline dimensions changed: ${oldImage.width}x${oldImage.height} -> ${newImage.width}x${newImage.height}`);
  }
  const totalPixels = oldImage.width * oldImage.height;
  let changedPixels = 0;
  let absoluteChannelDifference = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < oldImage.rgb.length; index += 3) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(oldImage.rgb[index + channel] - newImage.rgb[index + channel]);
      if (delta > 0) pixelChanged = true;
      absoluteChannelDifference += delta;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
    if (pixelChanged) changedPixels += 1;
  }
  const channelDenominator = totalPixels * 3 * 255;
  return {
    width: oldImage.width,
    height: oldImage.height,
    totalPixels,
    changedPixels,
    pixelDiffRatio: changedPixels / totalPixels,
    absoluteChannelDifference,
    channelDifferenceDenominator: channelDenominator,
    channelDiffRatio: absoluteChannelDifference / channelDenominator,
    maxChannelDelta,
  };
}

function expectEqual(actual, expected, path) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${path} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertString(value, path, pattern = /.+/) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${path} must be a valid string`);
}

export function verifyVisualBaselineProvenance({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) fail('visual baseline provenance schemaVersion must be 1');
  if (manifest.release !== 'extension-ship-quality-rc6') fail('visual baseline provenance is not bound to RC6');
  const refresh = manifest.refresh;
  if (!refresh || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('visual baseline provenance must include refresh metadata and entries');
  }
  const oldCommit = resolveCommit(repoRoot, refresh.oldSourceCommit, 'refresh.oldSourceCommit');
  const newCommit = resolveCommit(repoRoot, refresh.newSourceCommit, 'refresh.newSourceCommit');
  if (oldCommit === newCommit) fail('visual baseline refresh must have distinct old/new source commits');
  if (!refresh.browser || !refresh.browser.name || !refresh.browser.version || !refresh.browser.playwrightVersion) {
    fail('refresh.browser must include name, version, and playwrightVersion');
  }
  if (!refresh.config || !refresh.config.path || !SHA256.test(refresh.config.sha256)) {
    fail('refresh.config must include a SHA-256 hash');
  }
  if (!refresh.spec || !refresh.spec.path || !SHA256.test(refresh.spec.sha256)) {
    fail('refresh.spec must include a SHA-256 hash');
  }
  if (!refresh.review || !refresh.review.agent || !refresh.review.human) {
    fail('refresh.review must include agent and human metadata');
  }
  assertString(refresh.review.agent.name, 'refresh.review.agent.name');
  assertString(refresh.review.agent.reviewedAt, 'refresh.review.agent.reviewedAt');
  assertString(refresh.review.human.status, 'refresh.review.human.status');
  const configBytes = readGitBlob(repoRoot, newCommit, refresh.config.path);
  if (sha256(configBytes) !== refresh.config.sha256) fail('refresh.config hash does not match the source commit');
  const specBytes = readGitBlob(repoRoot, newCommit, refresh.spec.path);
  if (sha256(specBytes) !== refresh.spec.sha256) fail('refresh.spec hash does not match the source commit');
  const seenPaths = new Set();
  const verifiedEntries = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const path = entry?.path;
    assertString(path, `entries[${index}].path`);
    if (seenPaths.has(path)) fail(`duplicate visual baseline path: ${path}`);
    seenPaths.add(path);
    const oldMeta = entry.old;
    const newMeta = entry.new;
    if (!oldMeta || !newMeta || oldMeta.sourceCommit !== oldCommit || newMeta.sourceCommit !== newCommit) {
      fail(`${path} must bind old/new hashes to the refresh source commits`);
    }
    if (!SHA256.test(oldMeta.sha256) || !SHA256.test(newMeta.sha256)) fail(`${path} has an invalid image hash`);
    const oldBytes = readGitBlob(repoRoot, oldCommit, path);
    const newBytes = readFileSync(resolve(repoRoot, path));
    const committedNewBytes = readGitBlob(repoRoot, newCommit, path);
    if (sha256(oldBytes) !== oldMeta.sha256) fail(`${path} old image hash does not match ${oldCommit}`);
    if (sha256(newBytes) !== newMeta.sha256) fail(`${path} current image hash does not match provenance`);
    if (sha256(committedNewBytes) !== newMeta.sha256) fail(`${path} current image is not the committed refresh image`);
    const diff = calculateDiff(decodePng(oldBytes), decodePng(newBytes));
    expectEqual(diff, entry.diff, `${path}.diff`);
    expectEqual({ width: diff.width, height: diff.height }, entry.image, `${path}.image`);
    if (!entry.viewport || !Number.isInteger(entry.viewport.width) || !Number.isInteger(entry.viewport.height)) {
      fail(`${path} must include an integer viewport width/height`);
    }
    if (!entry.config || typeof entry.config !== 'string') fail(`${path} must include the visual config name`);
    verifiedEntries.push({ path, oldSha256: oldMeta.sha256, newSha256: newMeta.sha256, diff });
  }
  return Object.freeze({
    release: manifest.release,
    oldSourceCommit: oldCommit,
    newSourceCommit: newCommit,
    browser: refresh.browser,
    review: refresh.review,
    entries: verifiedEntries,
  });
}

export function main({ manifestPath = DEFAULT_MANIFEST_PATH, repoRoot = REPO_ROOT } = {}) {
  const result = verifyVisualBaselineProvenance({ manifestPath, repoRoot });
  console.log(`[rc6-visual-provenance] PASS: verified ${result.entries.length} baselines`);
  for (const entry of result.entries) {
    console.log(`[rc6-visual-provenance] ${entry.path} pixelDiffRatio=${entry.diff.pixelDiffRatio}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(`[rc6-visual-provenance] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
