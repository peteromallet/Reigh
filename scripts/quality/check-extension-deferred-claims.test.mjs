import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  filterSemanticPresenceMatches,
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
});
