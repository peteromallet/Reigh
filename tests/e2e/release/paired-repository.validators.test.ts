import { describe, expect, it } from 'vitest';
import {
  meaningfulChange,
  validateExtensionOutput,
  validateTranscriptCaptions,
} from './paired-repository.validators';

const timeline = {
  tracks: [{ id: 'V1', kind: 'visual', muted: false }],
  clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 2, clipType: 'media' }],
};

describe('paired release semantic validators', () => {
  it('rejects null, empty and malformed command output', () => {
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', null, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', { schemaVersion: 1, generatedFromVersion: 1, entries: [] }, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', {
      schemaVersion: 1,
      generatedFromVersion: 1,
      entries: [{ id: 'pulse-clip-a-start', sourceClipId: 'clip-a', edge: 'start', time: 1, offset: 0, intensity: 0.4, color: '#fff' }],
    }, timeline).valid).toBe(false);
  });

  it('enforces each persisted command contract and canonical fingerprints', () => {
    const outputs: Record<string, unknown> = {
      'com.reigh.scene-phase-markers': [{ id: 'marker-1', time: 1 }],
      'com.reigh.creative-lab.pulse-map': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'pulse-clip-a-start', sourceClipId: 'clip-a', edge: 'start', time: 1, offset: 0, intensity: 0.4, color: '#fff' },
        { id: 'pulse-clip-a-end', sourceClipId: 'clip-a', edge: 'end', time: 3, offset: 0, intensity: 0.4, color: '#fff' },
      ] },
      'com.reigh.creative-lab.soundtrack-cartographer': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'terrain-clip-a-start', sourceClipId: 'clip-a', edge: 'start', kind: 'rise', time: 1, offset: 0, intensity: 0.4, color: '#fff', label: 'rise' },
        { id: 'terrain-clip-a-release', sourceClipId: 'clip-a', edge: 'release', kind: 'release', time: 3, offset: 0, intensity: 0.4, color: '#fff', label: 'release' },
      ] },
      'com.reigh.creative-lab.caption-safe-zone-orchestra': [],
      'com.reigh.creative-lab.emotional-weather-map': [{ id: 'weather-clip-a', sourceClipId: 'clip-a', kind: 'breeze', time: 1, intensity: 0.4, color: '#fff', label: 'breeze' }],
      'com.reigh.creative-lab.timeline-faultline': [],
      'com.reigh.creative-lab.foley-constellation': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'foley-clip-a-start', sourceClipId: 'clip-a', boundary: 'start', time: 1, category: 'unassigned', offset: 0, pan: 0, distance: 0.5, intensity: 0.4, label: 'cue' },
        { id: 'foley-clip-a-end', sourceClipId: 'clip-a', boundary: 'end', time: 3, category: 'unassigned', offset: 0, pan: 0, distance: 0.5, intensity: 0.4, label: 'cue' },
      ] },
      'com.reigh.creative-lab.branching-cut': { schemaVersion: 1, generatedFromVersion: 1, entries: [] },
      'com.reigh.creative-lab.chromatic-constellation': { schemaVersion: 1, coverage: { totalCandidates: 1, persistedCount: 1, displayLimit: 64, displayedCount: 1, omittedCount: 0, sourceTrackId: 'V1', sourceTrackLabel: 'Video', status: 'complete' }, entries: [{ id: 'constellation-clip-a', sourceClipId: 'clip-a', trackId: 'V1', trackLabel: 'Video', trackOrder: 0, pacingClass: 'steady', time: 1, duration: 2, intensity: 0.4, color: '#fff', label: 'steady' }] },
      'com.reigh.creative-lab.recall-pulse': { schemaVersion: 3, sourceSignature: 'sig', stale: false, suggestions: [{ id: 'recall-clip-a', sourceClipId: 'clip-a', checkpointId: 'checkpoint-clip-a', trackId: 'V1', category: 'concept', assignment: 'unassigned', time: 1, duration: 2, intensity: 0.4, prompt: 'Recall this', label: 'concept', color: '#fff', heuristic: 'timing', method: 'structural' }] },
      'com.reigh.creative-lab.lockline-inspector': { schemaVersion: 2, sourceSignature: 'sig', coverage: { totalClips: 1, scannedClips: 1, eligibleClips: 1, skippedInvalidClips: 0, candidateFindings: 0, persistedFindings: 0, omittedFindings: 0, omittedClips: 0 }, entries: [] },
    };
    for (const [extensionId, output] of Object.entries(outputs)) {
      const result = validateExtensionOutput(extensionId, output, timeline);
      expect(result.valid, `${extensionId}: ${result.reason}`).toBe(true);
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('requires exact caption IDs, text and timing and proves idempotence', () => {
    const expected = [
      { id: 'transcript-caption-a', text: 'First', at: 1, duration: 1 },
      { id: 'transcript-caption-b', text: 'Second', at: 3, duration: 1 },
    ];
    const before = validateTranscriptCaptions([], expected);
    const after = validateTranscriptCaptions([
      { id: 'transcript-caption-a', at: 1, duration: 1, text: { content: 'First' } },
      { id: 'transcript-caption-b', at: 3, duration: 1, text: { content: 'Second' } },
    ], expected);
    expect(after.valid).toBe(true);
    expect(meaningfulChange(before, after)).toBe(true);
    expect(validateTranscriptCaptions([
      { id: 'transcript-caption-a', at: 1, duration: 1, text: { content: 'Wrong' } },
      { id: 'transcript-caption-b', at: 3, duration: 1, text: { content: 'Second' } },
    ], expected).valid).toBe(false);
  });
});
