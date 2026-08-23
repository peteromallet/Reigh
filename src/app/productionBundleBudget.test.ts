import type { OutputBundle, OutputChunk } from 'rollup';
import { describe, expect, it } from 'vitest';
import {
  findJavaScriptBudgetFailures,
  measureJavaScriptBudget,
  type JavaScriptBudget,
} from '../../config/vite/bundleBudget';

function chunk(
  fileName: string,
  code: string,
  options: { entry?: boolean; imports?: string[]; dynamicImports?: string[] } = {},
): OutputChunk {
  return {
    type: 'chunk',
    fileName,
    name: fileName,
    code,
    dynamicImports: options.dynamicImports ?? [],
    implicitlyLoadedBefore: [],
    importedBindings: {},
    imports: options.imports ?? [],
    isDynamicEntry: false,
    isEntry: options.entry ?? false,
    isImplicitEntry: false,
    map: null,
    modules: {},
    exports: [],
    facadeModuleId: null,
    moduleIds: [],
    preliminaryFileName: fileName,
    referencedFiles: [],
  };
}

describe('production bundle budget', () => {
  it('measures the entry and recursively imported startup graph, excluding lazy chunks', () => {
    const entry = chunk('entry.js', 'entry', {
      entry: true,
      imports: ['vendor.js'],
      dynamicImports: ['lazy.js'],
    });
    const bundle = {
      'entry.js': entry,
      'vendor.js': chunk('vendor.js', 'vendor', { imports: ['shared.js'] }),
      'shared.js': chunk('shared.js', 'shared'),
      'lazy.js': chunk('lazy.js', 'lazy payload that is not fetched at startup'),
    } as OutputBundle;

    const result = measureJavaScriptBudget(bundle, entry);

    expect(result.entryRawBytes).toBe(5);
    expect(result.initialGraphRawBytes).toBe(17);
    expect(result.initialGraphFiles).toEqual(['entry.js', 'shared.js', 'vendor.js']);
  });

  it('reports every exceeded raw and compressed boundary', () => {
    const measurement = {
      entryFileName: 'entry.js',
      entryRawBytes: 101,
      entryGzipBytes: 51,
      initialGraphFiles: ['entry.js'],
      initialGraphRawBytes: 201,
      initialGraphGzipBytes: 91,
    };
    const budget: JavaScriptBudget = {
      entryRawBytes: 100,
      entryGzipBytes: 50,
      initialGraphRawBytes: 200,
      initialGraphGzipBytes: 90,
    };

    expect(findJavaScriptBudgetFailures(measurement, budget)).toEqual([
      'entry raw: 0.00 MB exceeds 0.00 MB',
      'entry gzip: 0.00 MB exceeds 0.00 MB',
      'initial static graph raw: 0.00 MB exceeds 0.00 MB',
      'initial static graph gzip: 0.00 MB exceeds 0.00 MB',
    ]);
  });

  it('accepts measurements at the exact boundary', () => {
    const measurement = {
      entryFileName: 'entry.js',
      entryRawBytes: 100,
      entryGzipBytes: 50,
      initialGraphFiles: ['entry.js'],
      initialGraphRawBytes: 200,
      initialGraphGzipBytes: 90,
    };

    expect(findJavaScriptBudgetFailures(measurement, {
      entryRawBytes: 100,
      entryGzipBytes: 50,
      initialGraphRawBytes: 200,
      initialGraphGzipBytes: 90,
    })).toEqual([]);
  });
});
