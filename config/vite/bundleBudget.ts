import { gzipSync } from 'node:zlib';
import type { OutputBundle, OutputChunk } from 'rollup';
import type { Plugin } from 'vite';

export interface JavaScriptBudget {
  readonly entryRawBytes: number;
  readonly entryGzipBytes: number;
  readonly initialGraphRawBytes: number;
  readonly initialGraphGzipBytes: number;
}

export interface JavaScriptBudgetMeasurement {
  readonly entryFileName: string;
  readonly entryRawBytes: number;
  readonly entryGzipBytes: number;
  readonly initialGraphFiles: readonly string[];
  readonly initialGraphRawBytes: number;
  readonly initialGraphGzipBytes: number;
}

/**
 * Production baseline from 2026-08-23, with 5-7% headroom for minifier and
 * dependency patch variation. This intentionally measures the complete static
 * startup graph, not just the largest Rollup chunk: splitting a file without
 * reducing bytes fetched at startup must not make the gate pass.
 */
export const PRODUCTION_JAVASCRIPT_BUDGET: JavaScriptBudget = Object.freeze({
  entryRawBytes: 5_800_000,
  entryGzipBytes: 1_600_000,
  initialGraphRawBytes: 6_750_000,
  initialGraphGzipBytes: 1_900_000,
});

function getChunk(bundle: OutputBundle, fileName: string): OutputChunk | undefined {
  const output = bundle[fileName];
  return output?.type === 'chunk' ? output : undefined;
}

function collectStaticGraph(bundle: OutputBundle, entry: OutputChunk): OutputChunk[] {
  const chunks: OutputChunk[] = [];
  const pending = [entry.fileName];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const fileName = pending.pop();
    if (!fileName || visited.has(fileName)) continue;
    visited.add(fileName);

    const chunk = getChunk(bundle, fileName);
    if (!chunk) continue;
    chunks.push(chunk);
    pending.push(...chunk.imports);
  }

  return chunks.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function byteLength(code: string): number {
  return Buffer.byteLength(code, 'utf8');
}

export function measureJavaScriptBudget(
  bundle: OutputBundle,
  entry: OutputChunk,
): JavaScriptBudgetMeasurement {
  const graph = collectStaticGraph(bundle, entry);
  const entryRawBytes = byteLength(entry.code);
  const entryGzipBytes = gzipSync(entry.code).byteLength;

  return {
    entryFileName: entry.fileName,
    entryRawBytes,
    entryGzipBytes,
    initialGraphFiles: graph.map((chunk) => chunk.fileName),
    initialGraphRawBytes: graph.reduce((sum, chunk) => sum + byteLength(chunk.code), 0),
    initialGraphGzipBytes: graph.reduce(
      (sum, chunk) => sum + gzipSync(chunk.code).byteLength,
      0,
    ),
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export function findJavaScriptBudgetFailures(
  measurement: JavaScriptBudgetMeasurement,
  budget: JavaScriptBudget,
): string[] {
  const checks = [
    ['entry raw', measurement.entryRawBytes, budget.entryRawBytes],
    ['entry gzip', measurement.entryGzipBytes, budget.entryGzipBytes],
    ['initial static graph raw', measurement.initialGraphRawBytes, budget.initialGraphRawBytes],
    ['initial static graph gzip', measurement.initialGraphGzipBytes, budget.initialGraphGzipBytes],
  ] as const;

  return checks
    .filter(([, actual, maximum]) => actual > maximum)
    .map(([label, actual, maximum]) => (
      `${label}: ${formatBytes(actual)} exceeds ${formatBytes(maximum)}`
    ));
}

export function createBundleBudgetPlugin(
  budget: JavaScriptBudget = PRODUCTION_JAVASCRIPT_BUDGET,
): Plugin {
  return {
    name: 'reigh-production-bundle-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle).filter(
        (output): output is OutputChunk => output.type === 'chunk' && output.isEntry,
      );

      for (const entry of entries) {
        const measurement = measureJavaScriptBudget(bundle, entry);
        const failures = findJavaScriptBudgetFailures(measurement, budget);
        if (failures.length === 0) continue;

        this.error([
          `Production JavaScript budget exceeded for ${entry.fileName}.`,
          ...failures.map((failure) => `- ${failure}`),
          `Static startup files: ${measurement.initialGraphFiles.join(', ')}`,
          'Reduce startup imports or move optional functionality behind a tested route/feature boundary.',
        ].join('\n'));
      }
    },
  };
}
