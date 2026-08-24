import { describe, expect, it } from 'vitest';
import {
  canonicalFingerprint,
  validateExtensionOutput,
  validateTranscriptCaptions,
} from '../../../../tests/e2e/release/paired-repository.validators';

describe('paired repository validators', () => {
  it('rejects absent, malformed and empty command output', () => {
    const timeline = { clips: [{ id: 'clip', at: 0, duration: 1 }] };
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', undefined, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', { schemaVersion: 1, generatedFromVersion: 0, entries: [] }, timeline).valid).toBe(false);
    expect(canonicalFingerprint({ b: 2, a: 1 })).toBe(canonicalFingerprint({ a: 1, b: 2 }));
  });

  it('requires exact caption identities, text and timing', () => {
    const expected = [{ id: 'transcript-caption-a', text: 'A', at: 1, duration: 2 }];
    expect(validateTranscriptCaptions([{ id: expected[0].id, text: { content: 'A' }, at: 1, duration: 2 }], expected).valid).toBe(true);
    expect(validateTranscriptCaptions([{ id: expected[0].id, text: { content: 'wrong' }, at: 1, duration: 2 }], expected).valid).toBe(false);
  });
});
