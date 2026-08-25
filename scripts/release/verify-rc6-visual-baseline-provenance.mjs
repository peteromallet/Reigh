#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { runBoundedCommand } from './bounded-command.mjs';

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(moduleDir, '..', '..');
export const DEFAULT_MANIFEST_PATH = resolve(
  REPO_ROOT,
  'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-baseline-provenance.json',
);
export const EXPECTED_BASELINE_PATHS = Object.freeze([
  'tests/e2e/visual-snapshots/composed-desktop.png',
  'tests/e2e/visual-snapshots/composed-tablet.png',
  'tests/e2e/visual-snapshots/composed-phone.png',
  'tests/e2e/visual-snapshots/runaway-loading.png',
  'tests/e2e/visual-snapshots/runaway-empty.png',
  'tests/e2e/visual-snapshots/runaway-error.png',
]);
export const VISUAL_DIFF_ARTIFACT_ROOT =
  'docs/extensions/evidence/releases/extension-ship-quality-rc6/visual-diffs';
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PROBE_TIMEOUT_MS = 60 * 1_000;
const GIT_OUTPUT_MAX_BUFFER = 32 * 1024 * 1024;

class ProvenanceError extends Error {}

function fail(message) {
  throw new ProvenanceError(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readGitBlob(repoRoot, commit, path) {
  const result = runBoundedCommand('git', ['show', `${commit}:${path}`], {
    cwd: repoRoot,
    encoding: null,
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
    killSignal: 'SIGKILL',
    label: `git show ${commit}:${path}`,
    allowFailure: true,
  });
  if (result.error || result.status !== 0) {
    fail(`could not read ${commit}:${path} from Git: ${result.stderr?.toString().trim() || result.error?.message || 'unknown error'}`);
  }
  return result.stdout;
}

function resolveCommit(repoRoot, ref, label) {
  if (!COMMIT.test(ref ?? '')) fail(`${label} must be a full lowercase commit pin`);
  const result = runBoundedCommand('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
    cwd: repoRoot,
    timeoutMs: PROBE_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    killSignal: 'SIGKILL',
    label: `${label} git rev-parse`,
    allowFailure: true,
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
  const rgba = Buffer.alloc(width * height * 4);
  let outputOffset = 0;
  let rgbaOffset = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = y * rowBytes + x * bytesPerPixel;
      let red;
      let green;
      let blue;
      let alpha = 255;
      if (colourType === 0 || colourType === 4) {
        red = green = blue = rows[source];
        if (colourType === 4) alpha = rows[source + 1];
      } else if (colourType === 2 || colourType === 6) {
        red = rows[source]; green = rows[source + 1]; blue = rows[source + 2];
        if (colourType === 6) alpha = rows[source + 3];
      } else {
        const index = rows[source];
        if (!palette || index * 3 + 2 >= palette.length) fail('indexed baseline PNG has no valid palette entry');
        red = palette[index * 3]; green = palette[index * 3 + 1]; blue = palette[index * 3 + 2];
        if (transparency && index < transparency.length) alpha = transparency[index];
      }
      rgb[outputOffset++] = red;
      rgb[outputOffset++] = green;
      rgb[outputOffset++] = blue;
      rgba[rgbaOffset++] = red;
      rgba[rgbaOffset++] = green;
      rgba[rgbaOffset++] = blue;
      rgba[rgbaOffset++] = alpha;
    }
  }
  return { width, height, rgb, rgba, channels: 3, transparency: Boolean(transparency) };
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

/**
 * Resolve a reviewed artifact only after proving it is a canonical,
 * repository-relative regular file below the release evidence directory.
 * lstat is intentionally used for every path component: a symlinked parent
 * is just as capable of escaping the evidence directory as a symlink target.
 */
function assertSafeVisualDiffArtifactPath(repoRoot, artifactPath, label) {
  assertString(artifactPath, label);
  if (isAbsolute(artifactPath) || artifactPath.includes('\\') || artifactPath.includes('\0')) {
    fail(`${label} must be a canonical repository-relative path under ${VISUAL_DIFF_ARTIFACT_ROOT}`);
  }
  const segments = artifactPath.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} must not contain empty, current-directory, or traversal segments`);
  }
  if (!artifactPath.startsWith(`${VISUAL_DIFF_ARTIFACT_ROOT}/`)
    || normalize(artifactPath) !== artifactPath) {
    fail(`${label} must be a canonical repository-relative path under ${VISUAL_DIFF_ARTIFACT_ROOT}`);
  }
  const repoAbsolute = resolve(repoRoot);
  const absolute = resolve(repoAbsolute, artifactPath);
  const repoRelative = relative(repoAbsolute, absolute);
  if (repoRelative !== artifactPath || repoRelative.startsWith(`..${sep}`) || isAbsolute(repoRelative)) {
    fail(`${label} must remain strictly under ${VISUAL_DIFF_ARTIFACT_ROOT}`);
  }

  let current = repoAbsolute;
  for (const segment of repoRelative.split(sep)) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      fail(`${label} does not exist as a checked-out repository path: ${error.message}`);
    }
    if (stats.isSymbolicLink()) fail(`${label} must not contain symlinks`);
    const isFinal = current === absolute;
    if (!isFinal && !stats.isDirectory()) fail(`${label} has a non-directory parent`);
    if (isFinal && !stats.isFile()) fail(`${label} must be a regular file`);
  }
  return absolute;
}

function deriveDiffMask(oldImage, newImage) {
  const expected = Buffer.alloc(newImage.width * newImage.height * 4);
  let outputOffset = 0;
  for (let index = 0; index < oldImage.rgb.length; index += 3) {
    const changed = oldImage.rgb[index] !== newImage.rgb[index]
      || oldImage.rgb[index + 1] !== newImage.rgb[index + 1]
      || oldImage.rgb[index + 2] !== newImage.rgb[index + 2];
    if (changed) {
      expected[outputOffset++] = 255;
      expected[outputOffset++] = 0;
      expected[outputOffset++] = 0;
    } else {
      // This is the canonical mask rendering used for the retained review
      // artifacts: unchanged final-baseline pixels are blended 20% over white.
      expected[outputOffset++] = Math.round(204 + newImage.rgb[index] * 0.2);
      expected[outputOffset++] = Math.round(204 + newImage.rgb[index + 1] * 0.2);
      expected[outputOffset++] = Math.round(204 + newImage.rgb[index + 2] * 0.2);
    }
    expected[outputOffset++] = 255;
  }
  return expected;
}

function assertDiffMaskPixels(actualImage, oldImage, newImage, path) {
  const expected = deriveDiffMask(oldImage, newImage);
  if (actualImage.rgba.length !== expected.length) {
    fail(`${path} reviewed diff artifact pixel buffer length mismatch`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (actualImage.rgba[index] !== expected[index]) {
      const pixel = Math.floor(index / 4);
      fail(
        `${path} reviewed diff artifact pixels mismatch at pixel ${pixel}: `
        + `expected ${Array.from(expected.subarray(pixel * 4, pixel * 4 + 4)).join(',')}, `
        + `got ${Array.from(actualImage.rgba.subarray(pixel * 4, pixel * 4 + 4)).join(',')}`,
      );
    }
  }
}

export function verifyVisualBaselineProvenance({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  readWorktreeArtifact = readFileSync,
} = {}) {
  if (typeof readWorktreeArtifact !== 'function') {
    throw new TypeError('readWorktreeArtifact must be a function');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) fail('visual baseline provenance schemaVersion must be 1');
  if (manifest.release !== 'extension-ship-quality-rc6') fail('visual baseline provenance is not bound to RC6');
  const refresh = manifest.refresh;
  if (!refresh || !Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('visual baseline provenance must include refresh metadata and entries');
  }
  if (manifest.entries.length !== EXPECTED_BASELINE_PATHS.length) {
    fail(
      `visual baseline provenance must contain exactly ${EXPECTED_BASELINE_PATHS.length} entries, `
      + `got ${manifest.entries.length}`,
    );
  }
  const expectedPathSet = new Set(EXPECTED_BASELINE_PATHS);
  const declaredPaths = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const path = entry?.path;
    assertString(path, `entries[${index}].path`);
    if (declaredPaths.includes(path)) fail(`duplicate visual baseline path: ${path}`);
    declaredPaths.push(path);
  }
  const missingPaths = EXPECTED_BASELINE_PATHS.filter((path) => !declaredPaths.includes(path));
  const unexpectedPaths = declaredPaths.filter((path) => !expectedPathSet.has(path));
  if (missingPaths.length > 0 || unexpectedPaths.length > 0) {
    fail(
      `visual baseline paths must exactly match the RC6 set; `
      + `missing: ${missingPaths.join(', ') || '<none>'}; `
      + `unexpected: ${unexpectedPaths.join(', ') || '<none>'}`,
    );
  }
  const oldCommit = resolveCommit(repoRoot, refresh.oldSourceCommit, 'refresh.oldSourceCommit');
  const newCommit = resolveCommit(repoRoot, refresh.newSourceCommit, 'refresh.newSourceCommit');
  if (oldCommit === newCommit) fail('visual baseline refresh must have distinct old/new source commits');
  if (!Array.isArray(refresh.history) || refresh.history.length < 2) {
    fail('refresh.history must preserve the initial refresh and final correction stages');
  }
  for (const [index, stage] of refresh.history.entries()) {
    resolveCommit(repoRoot, stage?.commit, `refresh.history[${index}].commit`);
    assertString(stage?.role, `refresh.history[${index}].role`);
    assertString(stage?.rationale, `refresh.history[${index}].rationale`);
  }
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
  const seenArtifactPaths = new Set();
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
    if (diff.changedPixels > 0) {
      const artifact = entry.reviewedDiffArtifact;
      if (!artifact || !SHA256.test(artifact.sha256)
        || artifact.oldSourceCommit !== oldCommit
        || artifact.newSourceCommit !== newCommit
        || !COMMIT.test(artifact.commit ?? '')) {
        fail(`${path} changed pixels require a hashed reviewed diff artifact bound to both source commits`);
      }
      assertString(artifact.path, `${path}.reviewedDiffArtifact.path`);
      const artifactPath = assertSafeVisualDiffArtifactPath(
        repoRoot,
        artifact.path,
        `${path}.reviewedDiffArtifact.path`,
      );
      if (seenArtifactPaths.has(artifact.path)) {
        fail(`duplicate reviewed diff artifact path: ${artifact.path}`);
      }
      seenArtifactPaths.add(artifact.path);
      const artifactCommit = resolveCommit(
        repoRoot,
        artifact.commit,
        `${path}.reviewedDiffArtifact.commit`,
      );
      const committedArtifactBytes = readGitBlob(repoRoot, artifactCommit, artifact.path);
      if (sha256(committedArtifactBytes) !== artifact.sha256) {
        fail(`${path} reviewed diff artifact hash does not match ${artifactCommit}:${artifact.path}`);
      }
      const currentArtifactBytes = readWorktreeArtifact(artifactPath);
      if (!Buffer.isBuffer(currentArtifactBytes)) {
        fail(`${path} reviewed diff artifact reader must return a Buffer`);
      }
      if (!currentArtifactBytes.equals(committedArtifactBytes)) {
        fail(`${path} reviewed diff artifact worktree bytes do not match ${artifactCommit}:${artifact.path}`);
      }
      const artifactImage = decodePng(committedArtifactBytes);
      expectEqual(
        { width: artifactImage.width, height: artifactImage.height },
        { width: diff.width, height: diff.height },
        `${path}.reviewedDiffArtifact.dimensions`,
      );
      assertDiffMaskPixels(artifactImage, decodePng(oldBytes), decodePng(newBytes), path);
    }
    verifiedEntries.push({
      path,
      oldSha256: oldMeta.sha256,
      newSha256: newMeta.sha256,
      diff,
      ...(entry.reviewedDiffArtifact ? { reviewedDiffArtifact: entry.reviewedDiffArtifact } : {}),
    });
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
