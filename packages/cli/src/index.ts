#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, readFile } from 'node:fs/promises';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { resolveTimelineConfig } from '@tbd/engine';
import { migrateTimeline } from '@tbd/schema';
import { TimelineConfigSchema } from '@tbd/schema';

export interface RenderTimelineOptions {
  timelinePath: string;
  outputPath: string;
  assetRoot?: string;
  codec?: 'h264' | 'h265' | 'vp8' | 'vp9' | 'prores';
  fps?: number;
  width?: number;
  height?: number;
  concurrency?: number;
  logLevel?: 'info' | 'verbose' | 'error';
  resolverModule?: string;
}

export interface ParsedCliArgs extends RenderTimelineOptions {}

type ResolverModule = {
  resolveAssetUrl?: (input: {
    file: string;
    mode: 'preview' | 'render';
  }) => Promise<string> | string;
};

export const parseArgs = (argv: string[]): ParsedCliArgs => {
  if (argv.length < 2 || argv[0] !== 'render') {
    throw new Error('Usage: render timeline.json out.mp4 [--asset-root path] [--codec h264]');
  }

  const parsed: ParsedCliArgs = {
    timelinePath: argv[1],
    outputPath: argv[2] ?? '',
  };

  for (let index = 3; index < argv.length; index += 1) {
    const current = argv[index];
    const value = argv[index + 1];
    if (!current?.startsWith('--')) {
      continue;
    }

    switch (current) {
      case '--asset-root':
        parsed.assetRoot = value;
        index += 1;
        break;
      case '--codec':
        parsed.codec = value as RenderTimelineOptions['codec'];
        index += 1;
        break;
      case '--fps':
        parsed.fps = Number(value);
        index += 1;
        break;
      case '--width':
        parsed.width = Number(value);
        index += 1;
        break;
      case '--height':
        parsed.height = Number(value);
        index += 1;
        break;
      case '--concurrency':
        parsed.concurrency = Number(value);
        index += 1;
        break;
      case '--log-level':
        parsed.logLevel = value as RenderTimelineOptions['logLevel'];
        index += 1;
        break;
      case '--resolver':
        parsed.resolverModule = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown flag: ${current}`);
    }
  }

  if (!parsed.outputPath) {
    throw new Error('Missing output path');
  }

  return parsed;
};

const createDefaultResolver = (assetRoot: string) => (file: string): string => {
  if (/^https?:\/\//.test(file)) {
    return file;
  }

  if (path.isAbsolute(file)) {
    return pathToFileURL(file).href;
  }

  return pathToFileURL(path.resolve(assetRoot, file)).href;
};

async function loadResolver(modulePath: string | undefined, assetRoot: string) {
  if (!modulePath) {
    return createDefaultResolver(assetRoot);
  }

  const imported = await import(pathToFileURL(path.resolve(modulePath)).href) as ResolverModule;
  if (typeof imported.resolveAssetUrl !== 'function') {
    throw new Error(`Resolver module ${modulePath} must export resolveAssetUrl()`);
  }

  return (file: string) => imported.resolveAssetUrl!({ file, mode: 'render' });
}

export async function renderTimeline(options: RenderTimelineOptions): Promise<void> {
  const assetRoot = options.assetRoot ?? process.cwd();
  const raw = JSON.parse(await readFile(options.timelinePath, 'utf8')) as unknown;
  const migrated = migrateTimeline(raw);
  const timeline = TimelineConfigSchema.parse(migrated);
  const resolver = await loadResolver(options.resolverModule, assetRoot);
  const resolvedConfig = await resolveTimelineConfig(timeline, { assets: {} }, resolver);

  const moduleDir = path.dirname(new URL(import.meta.url).pathname);
  const compiledEntryPoint = path.resolve(moduleDir, './remotion-root.js');
  const sourceEntryPoint = path.resolve(moduleDir, './remotion-root.tsx');
  let entryPoint = compiledEntryPoint;
  try {
    await access(entryPoint);
  } catch {
    entryPoint = sourceEntryPoint;
  }

  const bundleLocation = await bundle({
    entryPoint,
    onProgress: () => undefined,
  });

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'timeline',
    inputProps: { config: resolvedConfig },
  });

  await renderMedia({
    serveUrl: bundleLocation,
    composition,
    codec: options.codec ?? 'h264',
    outputLocation: options.outputPath,
    inputProps: { config: resolvedConfig },
    concurrency: options.concurrency,
    logLevel: options.logLevel ?? 'info',
    overwrite: true,
  });
}

async function runCli() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    await renderTimeline(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = /schema|parse/i.test(message) ? 1 : /asset/i.test(message) ? 2 : 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
