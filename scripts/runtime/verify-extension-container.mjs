#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const DOCKERFILE_PATH = resolve(REPO_ROOT, 'Dockerfile');
export const DOCKER_COMMAND = 'docker';
export const CONTAINER_PORT = 8080;
export const RUNTIME_CONFIG_PATH = '/runtime-config/v1/extensions.json';
export const POLL_INTERVAL_MS = 500;
export const POLL_TIMEOUT_MS = 90_000;

const IMAGE_REPOSITORY = 'reigh-extension-container-gate';
const IMAGE_TAG = `${IMAGE_REPOSITORY}:local-${process.pid}`;
const CONTAINER_PREFIX = `${IMAGE_REPOSITORY}-${process.pid}`;
const PUBLIC_BUILD_ARGS = Object.freeze([
  'VITE_SUPABASE_URL=https://example.invalid',
  'VITE_SUPABASE_ANON_KEY=container-gate-public',
  'VITE_API_TARGET_URL=https://example.invalid',
  'VITE_APP_ENV=production',
]);

export const ROLLOUT_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'smoke',
    containerNameSuffix: 'smoke',
    expected: Object.freeze({
      schemaVersion: 1,
      revision: 'smoke',
      extensions: Object.freeze({
        hostEnabled: true,
        transcriptCaptionFoundryEnabled: true,
        runawayTypedTimelineEnabled: false,
      }),
    }),
    env: Object.freeze({
      EXTENSION_HOST_ENABLED: 'true',
      TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'true',
      RUNAWAY_TYPED_TIMELINE_ENABLED: 'false',
      EXTENSION_RELEASE_CONFIG_REVISION: 'smoke',
    }),
  }),
  Object.freeze({
    id: 'rollback',
    containerNameSuffix: 'rollback',
    expected: Object.freeze({
      schemaVersion: 1,
      revision: 'rollback',
      extensions: Object.freeze({
        hostEnabled: false,
        transcriptCaptionFoundryEnabled: false,
        runawayTypedTimelineEnabled: false,
      }),
    }),
    env: Object.freeze({
      EXTENSION_HOST_ENABLED: 'false',
      TRANSCRIPT_CAPTION_FOUNDRY_ENABLED: 'false',
      RUNAWAY_TYPED_TIMELINE_ENABLED: 'false',
      EXTENSION_RELEASE_CONFIG_REVISION: 'rollback',
    }),
  }),
]);

function dockerError(args, result) {
  const renderedArgs = args.map((arg) => JSON.stringify(arg)).join(' ');
  const output = `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim();
  return new Error(
    `docker ${renderedArgs} failed with status ${result?.status ?? 'unknown'}${output ? `: ${output.slice(-4000)}` : ''}`,
  );
}

/** Run Docker with an explicit argv vector. Shell interpolation is forbidden. */
export function runDocker(args, { allowFailure = false } = {}) {
  const result = spawnSync(DOCKER_COMMAND, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    if (allowFailure) return result;
    throw result.error ?? dockerError(args, result);
  }
  return result;
}

function parseJsonOutput(args) {
  const result = runDocker(args);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`docker ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

export function buildDockerArgv(imageTag = IMAGE_TAG) {
  const args = [
    'build',
    '--file',
    'Dockerfile',
    '--tag',
    imageTag,
    '--pull=false',
    '--progress=plain',
  ];
  for (const buildArg of PUBLIC_BUILD_ARGS) {
    args.push('--build-arg', buildArg);
  }
  args.push('.');
  return args;
}

export function validateDigestPinnedDockerfile(source = readFileSync(DOCKERFILE_PATH, 'utf8')) {
  const fromLines = source.match(/^FROM node:[^\n]+$/gm) ?? [];
  if (fromLines.length !== 2) {
    throw new Error('Dockerfile must have exactly two pinned Node FROM lines');
  }
  const digests = fromLines.map((line) => line.match(/@sha256:[0-9a-f]{64}/)?.[0]);
  if (digests.some((digest) => !digest) || digests[0] !== digests[1]) {
    throw new Error('Dockerfile build/runtime stages must use the same full sha256-pinned image');
  }
  if (!/^USER node$/m.test(source)) {
    throw new Error('Dockerfile runtime stage must run as the node user');
  }
  if (!source.includes(`'/runtime-config/v1/extensions.json'`)
    && !source.includes('"/runtime-config/v1/extensions.json"')) {
    throw new Error('Dockerfile healthcheck must probe the runtime config endpoint');
  }
  return Object.freeze({ baseImage: fromLines[0].replace(/^FROM\s+|\s+AS\s+\w+$/g, ''), digest: digests[0] });
}

export function assertNonRootConfigUser(configUser) {
  const user = String(configUser ?? '').trim();
  if (!user || user === '0' || /^root(?::|$)/i.test(user)) {
    throw new Error(`production image Config.User must be non-root; received ${JSON.stringify(configUser)}`);
  }
  return user;
}

export function parsePublishedPort(containerInspect) {
  const bindings = containerInspect?.NetworkSettings?.Ports?.[`${CONTAINER_PORT}/tcp`];
  const hostPort = bindings?.find((binding) => binding?.HostPort)?.HostPort;
  const port = Number(hostPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`container did not publish an ephemeral localhost port for ${CONTAINER_PORT}/tcp`);
  }
  return port;
}

export function assertRuntimeConfig(actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`runtime config mismatch: expected ${expectedJson}, received ${actualJson}`);
  }
  return actual;
}

function inspectImage(imageTag) {
  const [image] = parseJsonOutput(['image', 'inspect', imageTag]);
  if (!image) throw new Error(`Docker image ${imageTag} was not found after build`);
  assertNonRootConfigUser(image.Config?.User);
  return image;
}

function inspectContainer(containerName) {
  const [container] = parseJsonOutput(['container', 'inspect', containerName]);
  if (!container) throw new Error(`container ${containerName} was not found`);
  return container;
}

function containerExists(containerName) {
  const result = runDocker(['container', 'inspect', containerName], { allowFailure: true });
  return result.status === 0;
}

function removeScopedContainer(containerName) {
  if (!containerName.startsWith(`${CONTAINER_PREFIX}-`)) {
    throw new Error(`refusing to clean non-scoped container ${containerName}`);
  }
  if (containerExists(containerName)) {
    runDocker(['container', 'rm', '--force', containerName]);
  }
}

function stopContainer(containerName) {
  runDocker(['container', 'stop', '--time', '10', containerName], { allowFailure: true });
}

function startContainer(containerName, imageTag, env, createdContainers) {
  if (containerExists(containerName)) {
    throw new Error(`scoped container name is already in use: ${containerName}`);
  }
  const args = [
    'run',
    '--detach',
    '--pull=never',
    '--name',
    containerName,
    '--publish',
    `127.0.0.1::${CONTAINER_PORT}`,
  ];
  for (const [name, value] of Object.entries(env)) {
    args.push('--env', `${name}=${value}`);
  }
  args.push(imageTag);
  const result = runDocker(args);
  // Record ownership immediately after `docker run` succeeds, before any
  // inspect/port failure can skip the caller's normal bookkeeping.
  createdContainers.add(containerName);
  const container = inspectContainer(containerName);
  const runContainerId = result.stdout.trim();
  if (!runContainerId || !(container.Id === runContainerId || container.Id.startsWith(runContainerId))) {
    throw new Error(`container ${containerName} run ID did not match docker inspect (${runContainerId || 'missing'})`);
  }
  return {
    imageId: container.Image,
    port: parsePublishedPort(container),
  };
}

async function fetchProbe(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(2_000),
  });
  return response;
}

async function pollContainer(containerName, port, expected) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastFailure = 'container probes have not passed yet';
  while (Date.now() < deadline) {
    try {
      const rootResponse = await fetchProbe(`${baseUrl}/`);
      if (rootResponse.status !== 200) {
        throw new Error(`root returned HTTP ${rootResponse.status}`);
      }
      const runtimeResponse = await fetchProbe(`${baseUrl}${RUNTIME_CONFIG_PATH}`);
      if (runtimeResponse.status !== 200) {
        throw new Error(`runtime config returned HTTP ${runtimeResponse.status}`);
      }
      const config = await runtimeResponse.json();
      assertRuntimeConfig(config, expected);
      const container = inspectContainer(containerName);
      const health = container.State?.Health?.Status;
      if (container.State?.Status !== 'running' || health !== 'healthy') {
        throw new Error(`container state=${container.State?.Status ?? 'unknown'} health=${health ?? 'unknown'}`);
      }
      return config;
    } catch (error) {
      lastFailure = error.message;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
    }
  }
  throw new Error(`timed out polling root/runtime-config/health for ${containerName}: ${lastFailure}`);
}

function printImageEvidence(imageTag, image) {
  const repoDigests = Array.isArray(image.RepoDigests) ? image.RepoDigests : [];
  console.log(`[extension-container] retained image tag=${imageTag}`);
  console.log(`[extension-container] retained image id=${image.Id}`);
  console.log(`[extension-container] retained image digests=${repoDigests.length ? repoDigests.join(',') : '(local image has no RepoDigests)'}`);
  console.log(`[extension-container] Config.User=${image.Config?.User}`);
}

export async function runContainerGate() {
  const digestPin = validateDigestPinnedDockerfile();
  runDocker(['version', '--format', '{{.Server.Version}}']);
  console.log(`[extension-container] digest-pinned base=${digestPin.baseImage}`);

  runDocker(buildDockerArgv());
  const image = inspectImage(IMAGE_TAG);
  printImageEvidence(IMAGE_TAG, image);
  const createdContainers = new Set();

  try {
    for (const scenario of ROLLOUT_SCENARIOS) {
      const containerName = `${CONTAINER_PREFIX}-${scenario.containerNameSuffix}`;
      const started = startContainer(containerName, IMAGE_TAG, scenario.env, createdContainers);
      if (started.imageId !== image.Id) {
        throw new Error(`scenario ${scenario.id} did not reuse image ${image.Id}`);
      }
      await pollContainer(containerName, started.port, scenario.expected);
      console.log(`[extension-container] ${scenario.id} root/runtime-config/health passed on localhost:${started.port}`);
      stopContainer(containerName);
      removeScopedContainer(containerName);
      createdContainers.delete(containerName);
    }
  } finally {
    for (const containerName of createdContainers) {
      stopContainer(containerName);
      removeScopedContainer(containerName);
    }
  }

  console.log('[extension-container] production container gate passed; image intentionally retained for inspection');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error('[extension-container] this gate accepts no command-line arguments');
    process.exitCode = 2;
  } else {
    runContainerGate().catch((error) => {
      console.error(`[extension-container] FAILED: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
