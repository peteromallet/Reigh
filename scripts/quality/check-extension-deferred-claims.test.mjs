import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  filterSemanticPresenceMatches,
  scanSemanticClaimOccurrences,
  isExplicitNegativeLimitation,
} from './lib/deferred-claim-scanner.mjs';

describe('deferred claim presence semantics', () => {
  it('allows an explicit negative sandbox limitation comment', () => {
    const line = 'src/tools/video-editor/runtime/extensionContextFactory.ts:167: * It does not sandbox trusted extension code.';
    assert.equal(isExplicitNegativeLimitation(line, 'sandbox'), true);
    assert.deepEqual(filterSemanticPresenceMatches([line], 'sandbox'), []);
  });

  it('keeps actual sandbox implementation claims as presence violations', () => {
    const lines = [
      'src/tools/video-editor/runtime/runtime.ts:12: export function sandboxExtension(code) { return code; }',
      'src/tools/video-editor/runtime/runtime.ts:13: * Sandboxed execution is not supported by this host.',
    ];
    const matches = filterSemanticPresenceMatches(lines, 'sandbox');
    assert.deepEqual(matches, [lines[0]]);
  });

  it('does not exempt executable code that merely uses negative wording', () => {
    const line = "src/tools/video-editor/runtime/runtime.ts:12: const note = 'does not sandbox';";
    assert.equal(isExplicitNegativeLimitation(line, 'sandbox'), false);
    assert.deepEqual(filterSemanticPresenceMatches([line], 'sandbox'), [line]);
  });

  it('allows negative capability wording in test descriptions and matchers', () => {
    const lines = [
      "src/tools/video-editor/runtime/phase4ReadinessDocs.test.ts:17: it('states trusted/unsandboxed posture without implying sandbox enforcement', () => {});",
      'src/tools/video-editor/runtime/phase4ReadinessDocs.test.ts:27: expect(content).toMatch(/no sandbox/);',
    ];
    assert.deepEqual(filterSemanticPresenceMatches(lines, 'sandbox'), []);
  });

  it('classifies every occurrence instead of allowlisting a whole line', () => {
    const line = 'src/runtime.ts:42: * No sandbox yet; sandbox enforcement is implemented below.';
    const occurrences = scanSemanticClaimOccurrences([line], 'sandbox');

    assert.deepEqual(
      occurrences.map(({ match, negative }) => ({ match, negative })),
      [
        { match: 'sandbox', negative: true },
        { match: 'sandbox', negative: false },
      ],
    );
    assert.deepEqual(filterSemanticPresenceMatches([line], 'sandbox'), [line]);
    assert.equal(isExplicitNegativeLimitation(line, 'sandbox'), false);
  });

  it('keeps precise occurrence evidence for positive-before-negative prose', () => {
    const line = 'src/runtime.ts:43: * Sandbox enforcement is implemented; no sandbox remains for legacy hosts.';
    const occurrences = scanSemanticClaimOccurrences([line], 'sandbox');

    assert.equal(occurrences.length, 2);
    assert.equal(occurrences[0].negative, false);
    assert.equal(occurrences[1].negative, true);
    assert.equal(occurrences[0].index, occurrences[0].text.indexOf('Sandbox'));
    assert.equal(occurrences[0].lineNumber, 43);
    assert.equal(occurrences[0].path, 'src/runtime.ts');
  });

  it('handles coordinated matches under one negative scope', () => {
    const line = 'src/runtime.ts:44: * No sandbox or iframe extension support is available.';
    const occurrences = scanSemanticClaimOccurrences([line], 'sandbox|iframe.*extension');

    assert.deepEqual(
      occurrences.map(({ match, negative }) => ({ match, negative })),
      [
        { match: 'sandbox', negative: true },
        { match: 'iframe extension', negative: true },
      ],
    );
    assert.deepEqual(filterSemanticPresenceMatches([line], 'sandbox|iframe.*extension'), []);
  });

  it('resets negation at punctuation and contrastive clauses', () => {
    const cases = [
      ['semicolon', 'src/runtime.ts:45: * No sandbox; sandbox enforcement is implemented.', [true, false]],
      ['period', 'src/runtime.ts:46: * No sandbox. Sandbox enforcement is implemented.', [true, false]],
      ['contrast', 'src/runtime.ts:47: * No sandbox, but sandbox enforcement is implemented.', [true, false]],
      ['reverse contrast', 'src/runtime.ts:48: * Sandbox enforcement is implemented, but no sandbox remains.', [false, true]],
    ];

    for (const [, line, expected] of cases) {
      assert.deepEqual(
        scanSemanticClaimOccurrences([line], 'sandbox').map(({ negative }) => negative),
        expected,
        line,
      );
    }
  });

  it('allows honest negatives but rejects double negatives', () => {
    const cases = [
      ['does not sandbox', true],
      ['no sandbox yet', true],
      ['sandbox is not implemented', true],
      ['sandbox enforcement is not present', true],
      ["sandbox enforcement isn't provided", true],
      ['sandbox enforcement cannot be implemented', true],
      ['unsandboxed trusted code', true],
      ['does not fail to sandbox', false],
      ['not without sandbox support', false],
      ['sandbox is not unsupported', false],
    ];

    for (const [claim, negative] of cases) {
      const line = `src/runtime.ts:49: * ${claim}.`;
      assert.deepEqual(
        scanSemanticClaimOccurrences([line], 'sandbox').map(({ negative: actual }) => actual),
        [negative],
        claim,
      );
    }
  });

  it('does not exempt executable identifiers or strings with negative wording', () => {
    const lines = [
      "src/runtime.ts:50: const note = 'does not sandbox';",
      'src/runtime.ts:51: export function sandboxExtension(code) { return code; }',
    ];

    for (const line of lines) {
      const occurrences = scanSemanticClaimOccurrences([line], 'sandbox');
      assert.equal(occurrences.length, 1);
      assert.equal(occurrences[0].negative, false, line);
    }
    assert.deepEqual(filterSemanticPresenceMatches(lines, 'sandbox'), lines);
  });

  it('classifies test prose and matcher literals without exempting positive claims', () => {
    const negativeLines = [
      "src/runtime.test.ts:52: it('does not provide sandbox enforcement', () => {});",
      'src/runtime.test.ts:53: expect(content).toMatch(/no sandbox/);',
    ];
    const positiveLines = [
      "src/runtime.test.ts:54: it('provides sandbox enforcement', () => {});",
      'src/runtime.test.ts:55: expect(content).toContain("sandbox enforcement is implemented");',
    ];

    assert.deepEqual(filterSemanticPresenceMatches(negativeLines, 'sandbox'), []);
    assert.deepEqual(filterSemanticPresenceMatches(positiveLines, 'sandbox'), positiveLines);
  });

  it('recognizes a negative test matcher scope without hiding positive matchers', () => {
    const negative = "src/runtime.test.ts:56: expect(content).not.toContain('sandbox');";
    const positive = "src/runtime.test.ts:57: expect(content).toContain('sandbox');";

    assert.deepEqual(filterSemanticPresenceMatches([negative], 'sandbox'), []);
    assert.deepEqual(filterSemanticPresenceMatches([positive], 'sandbox'), [positive]);
  });
});
