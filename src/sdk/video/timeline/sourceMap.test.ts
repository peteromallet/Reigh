import { describe, expect, it } from 'vitest';
import {
  classifyGeneratedOutputSync,
  computeHostFingerprint,
  createHostGeneratedObjectMeta,
  readHostGenerationProvenance,
} from './sourceMap';

describe('host-owned generated-object provenance', () => {
  const source = { text: 'Café 🌍', start: 1.25, end: 2.75 };
  const output = { text: 'Café 🌍', at: 1.25, duration: 1.5 };

  it('canonicalizes object keys and pins an algorithm-qualified fingerprint', () => {
    expect(computeHostFingerprint({ b: 2, a: [1, 'x'] })).toBe(
      computeHostFingerprint({ a: [1, 'x'], b: 2 }),
    );
    expect(computeHostFingerprint(source)).toMatch(/^reigh-fnv1a64-v1:[0-9a-f]{16}$/);
  });

  it('authors the complete versioned source/generator/output contract', () => {
    const meta = createHostGeneratedObjectMeta({
      extensionId: 'com.reigh.transcript-lane',
      contributionId: 'caption-foundry',
      extensionVersion: '1.0.0',
      sourceSchemaRef: 'reigh.transcript_segment/v1',
      sourceItemId: 'segment-1',
      sourceRevision: 9,
      sourceValue: source,
      outputValue: output,
      generatedAt: 123,
    });
    expect(meta.generatedAt).toBe(123);
    expect(readHostGenerationProvenance(meta)).toEqual({
      contractVersion: 1,
      sourceSchemaRef: 'reigh.transcript_segment/v1',
      sourceItemId: 'segment-1',
      sourceFingerprint: computeHostFingerprint(source),
      sourceRevision: 9,
      generatorVersion: '1.0.0',
      outputFingerprint: computeHostFingerprint(output),
      conflictPolicy: 'preserve-output',
    });
  });

  it.each([
    ['in-sync', source, output],
    ['source-changed', { ...source, text: 'new source' }, output],
    ['output-edited', source, { ...output, text: 'human edit' }],
    ['source-and-output-changed', { ...source, text: 'new source' }, { ...output, text: 'human edit' }],
  ] as const)('classifies %s without applying policy', (expected, currentSourceValue, currentOutputValue) => {
    const meta = createHostGeneratedObjectMeta({
      extensionId: 'com.reigh.transcript-lane',
      extensionVersion: '1.0.0',
      sourceSchemaRef: 'reigh.transcript_segment/v1',
      sourceItemId: 'segment-1',
      sourceValue: source,
      outputValue: output,
    });
    expect(classifyGeneratedOutputSync({ meta, currentSourceValue, currentOutputValue })).toBe(expected);
  });

  it('treats extension-specific legacy provenance as untracked', () => {
    expect(classifyGeneratedOutputSync({
      meta: { extensionId: 'legacy', provenance: { sourceHash: 'private-hash' } },
      currentSourceValue: source,
      currentOutputValue: output,
    })).toBe('untracked');
  });

  it('rejects circular values instead of producing unstable fingerprints', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => computeHostFingerprint(value)).toThrow(/circular/);
  });
});
