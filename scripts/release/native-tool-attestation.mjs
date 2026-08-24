import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { delimiter, isAbsolute, resolve } from 'node:path';

export const NATIVE_TOOL_NAMES = Object.freeze(['ffmpeg', 'ffprobe', 'tesseract', 'imageMagick']);

function fail(message) {
  throw new Error(message);
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function resolvePinnedExecutable(command, { pathValue = process.env.PATH } = {}) {
  if (!/^[A-Za-z0-9._+-]+$/.test(command ?? '')) fail(`native executable name is unsafe: ${command}`);
  if (typeof pathValue !== 'string' || pathValue.length === 0) fail(`PATH is missing while resolving ${command}`);
  const candidates = [];
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const candidate = isAbsolute(command) ? command : resolve(entry, command);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    try { accessSync(candidate, constants.X_OK); } catch { continue; }
    const canonical = realpathSync(candidate);
    if (!candidates.includes(canonical)) candidates.push(canonical);
  }
  if (candidates.length === 0) fail(`pinned native executable is missing from PATH: ${command}`);
  return candidates[0];
}

function configFor(manifest, name) {
  const verification = manifest?.verification;
  const config = verification?.nativeTools?.[name] ?? verification?.[name];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail(`manifest is missing verification.${name} native-tool pins`);
  }
  return config;
}

function expectedSha(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? '')) fail(`${label} must be a full sha256 digest`);
  return value;
}

function toolVersion(name, output) {
  if (name === 'ffmpeg' || name === 'ffprobe') {
    return output.match(new RegExp(`(?:^|\\n)${name} version ([0-9]+\\.[0-9]+\\.[0-9]+)(?:[ -]|\\n|$)`))?.[1] ?? null;
  }
  if (name === 'tesseract') return output.match(/(?:^|\n)tesseract ([^\s]+)/)?.[1] ?? null;
  return output.match(/^Version: ImageMagick ([^\s]+)/m)?.[1] ?? null;
}

function buildIdentity(output) {
  return String(output).trim().split(/\r?\n/).slice(0, 3).join('\n');
}

function runProbe(run, executable, args, label) {
  const result = run(executable, args, label);
  if (!result || result.status !== 0 || result.error) {
    fail(`${label} identity probe failed: ${result?.error?.message ?? result?.stderr ?? `exit ${result?.status ?? 'unknown'}`}`);
  }
  return result.stdout ?? '';
}

/**
 * Resolve and byte-attest every native executable before provisioning/building.
 * `run` is injected by the caller so this helper remains shell-free and uses
 * the release gate's bounded command runner.
 */
export function attestNativeTools({ manifest, pathValue, run }) {
  if (typeof run !== 'function') fail('native-tool attestation requires a bounded probe runner');
  const tools = {};
  for (const name of NATIVE_TOOL_NAMES) {
    const config = configFor(manifest, name);
    const command = config.executable ?? (name === 'imageMagick' ? 'magick' : name);
    const executable = resolvePinnedExecutable(command, { pathValue });
    const executableSha256 = `sha256:${sha256File(executable)}`;
    if (executableSha256 !== expectedSha(config.executableSha256, `verification.${name}.executableSha256`)) {
      fail(`${name} executable hash mismatch: expected ${config.executableSha256}, got ${executableSha256} (${executable})`);
    }
    const output = runProbe(run, executable, [name === 'ffmpeg' || name === 'ffprobe' ? '-version' : '--version'], `${name} identity`);
    const version = toolVersion(name, output);
    if (version !== config.version) {
      fail(`${name} version mismatch: expected ${config.version}, got ${version ?? '<invalid>'} from ${executable}`);
    }
    const identity = buildIdentity(output);
    if (identity !== config.buildIdentity) {
      fail(`${name} build identity mismatch: expected ${JSON.stringify(config.buildIdentity)}, got ${JSON.stringify(identity)}`);
    }
    tools[name] = { executable, executableSha256, version, buildIdentity: identity };
  }

  const tesseract = tools.tesseract;
  const languagesOutput = runProbe(run, tesseract.executable, ['--list-langs'], 'tesseract language-data identity');
  if (!/^eng$/m.test(languagesOutput)) fail('deterministic caption OCR requires the pinned Tesseract eng language data');
  const dataDirectory = languagesOutput.match(/List of available languages in "([^"]+)"/)?.[1];
  if (!dataDirectory || !isAbsolute(dataDirectory)) fail('Tesseract did not disclose an absolute language-data directory');
  const engDataPath = resolve(dataDirectory, 'eng.traineddata');
  if (!existsSync(engDataPath) || !statSync(engDataPath).isFile()) fail(`Tesseract eng language data is missing: ${engDataPath}`);
  const engDataSha256 = `sha256:${sha256File(engDataPath)}`;
  const expectedEng = expectedSha(configFor(manifest, 'tesseract').engDataSha256, 'verification.tesseract.engDataSha256');
  if (engDataSha256 !== expectedEng) fail(`Tesseract eng language data hash mismatch: expected ${expectedEng}, got ${engDataSha256} (${realpathSync(engDataPath)})`);
  tesseract.engDataPath = realpathSync(engDataPath);
  tesseract.engDataSha256 = engDataSha256;

  return Object.freeze({
    tools: Object.freeze(tools),
    platform: Object.freeze({ os: platform(), arch: arch(), release: release() }),
    path: pathValue,
  });
}

export function assertPinnedPlatform(manifest, actual = { os: platform(), arch: arch(), release: release() }) {
  const expected = manifest?.verification?.platform;
  if (!expected || typeof expected !== 'object') fail('manifest is missing verification.platform pins');
  for (const key of ['os', 'arch', 'release']) {
    if (actual[key] !== expected[key]) {
      fail(`platform mismatch for ${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
  return Object.freeze({ ...actual });
}

export function buildContainerBoundaryAttestation(manifest) {
  return Object.freeze({
    used: false,
    digest: null,
    expectedNodeImageDigest: manifest?.verification?.nodeImageDigest ?? null,
    note: 'standalone paired gate runs directly on the attested host; no Node container is used',
  });
}
