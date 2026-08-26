import { describe, expect, it } from 'vitest';
import { computeHostFingerprint } from '../../../src/sdk/video/timeline/sourceMap';
import {
  AUDIO_CARRIER_BYTES,
  hasSuccessfulAudioFullFetch,
  hasSuccessfulAudioMediaRange,
  isExpectedAudioMetadataAbort,
  meaningfulChange,
  releaseHostFingerprint,
  RUNAWAY_FIXTURE_FACTS,
  validateExtensionOutput,
  validateRunawayResponse,
  validateTranscriptCaptions,
} from './paired-repository.validators';

const timeline = {
  tracks: [{ id: 'V1', kind: 'visual', label: 'Video', muted: false }],
  clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 2, clipType: 'media' }],
  assetKeys: [],
};

describe('paired release semantic validators', () => {
  it('independently reproduces the host fingerprint canonicalization contract', () => {
    const values = [
      { b: 2, a: [1, 'x', null] },
      { nested: { z: Number.POSITIVE_INFINITY, a: false }, omitted: undefined },
      ['text', { duration: 2, clipType: null }],
    ];
    for (const value of values) {
      expect(releaseHostFingerprint(value)).toBe(computeHostFingerprint(value));
    }
  });

  it('permits only the exact Chromium AAC metadata cancellation after separate transport proofs', () => {
    const expectedUrl = 'http://127.0.0.1:2222/api/astrid/projects/demo/timelines/main/assets/motion-output-audio.aac';
    const abort = {
      url: expectedUrl,
      method: 'GET',
      resourceType: 'media',
      range: 'bytes=0-',
      failure: 'net::ERR_ABORTED',
    };
    expect(isExpectedAudioMetadataAbort(abort, expectedUrl)).toBe(true);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: 'bytes=32768-425983' }, expectedUrl)).toBe(true);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: 'bytes=1-' }, expectedUrl)).toBe(true);
    expect(isExpectedAudioMetadataAbort({ ...abort, url: `${expectedUrl}.other` }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, resourceType: 'fetch' }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: `bytes=${AUDIO_CARRIER_BYTES}-` }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: 'bytes=9-3' }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: 'bytes=0-1,3-4' }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, range: undefined }, expectedUrl)).toBe(false);
    expect(isExpectedAudioMetadataAbort({ ...abort, failure: 'net::ERR_FAILED' }, expectedUrl)).toBe(false);

    const observations = [{
      url: expectedUrl,
      method: 'GET',
      resourceType: 'fetch',
      range: undefined,
      status: 200,
      contentLength: String(AUDIO_CARRIER_BYTES),
      contentType: 'audio/x-aac',
    }, {
      url: expectedUrl,
      method: 'GET',
      resourceType: 'media',
      range: `bytes=${AUDIO_CARRIER_BYTES - 31_996}-`,
      status: 206,
      contentRange: `bytes ${AUDIO_CARRIER_BYTES - 31_996}-${AUDIO_CARRIER_BYTES - 1}/${AUDIO_CARRIER_BYTES}`,
      contentLength: '31996',
      contentType: 'audio/x-aac',
    }];
    expect(hasSuccessfulAudioFullFetch(observations, expectedUrl)).toBe(true);
    expect(hasSuccessfulAudioMediaRange(observations, expectedUrl)).toBe(true);
    expect(hasSuccessfulAudioFullFetch([
      { ...observations[0], contentType: 'application/octet-stream' },
    ], expectedUrl)).toBe(false);
    expect(hasSuccessfulAudioMediaRange([
      { ...observations[1], status: 200 },
    ], expectedUrl)).toBe(false);
    expect(hasSuccessfulAudioMediaRange([
      { ...observations[1], range: 'bytes=0-', contentLength: String(AUDIO_CARRIER_BYTES) },
    ], expectedUrl)).toBe(false);
    expect(hasSuccessfulAudioMediaRange([
      { ...observations[1], contentLength: '1' },
    ], expectedUrl)).toBe(false);
    expect(hasSuccessfulAudioMediaRange([{
      ...observations[1],
      range: `bytes=${AUDIO_CARRIER_BYTES}-${AUDIO_CARRIER_BYTES - 1}`,
      contentRange: `bytes ${AUDIO_CARRIER_BYTES}-${AUDIO_CARRIER_BYTES - 1}/${AUDIO_CARRIER_BYTES}`,
      contentLength: '0',
    }], expectedUrl)).toBe(false);
    expect(hasSuccessfulAudioMediaRange([{
      ...observations[1],
      range: `bytes=${AUDIO_CARRIER_BYTES - 1}-${AUDIO_CARRIER_BYTES}`,
      contentRange: `bytes ${AUDIO_CARRIER_BYTES - 1}-${AUDIO_CARRIER_BYTES}/${AUDIO_CARRIER_BYTES}`,
      contentLength: '2',
    }], expectedUrl)).toBe(false);
  });

  it('rejects null, empty and malformed command output', () => {
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', null, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', { schemaVersion: 1, generatedFromVersion: 1, entries: [] }, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.pulse-map', {
      schemaVersion: 1,
      generatedFromVersion: 1,
      entries: [{ id: 'pulse-clip-a-start', sourceClipId: 'clip-a', edge: 'start', time: 1, offset: 0, intensity: 0.4, color: '#fff' }],
    }, timeline).valid).toBe(false);
    expect(validateExtensionOutput('com.reigh.creative-lab.timeline-faultline', [], timeline))
      .toMatchObject({ valid: false, reason: 'expected an envelope object' });
    expect(validateExtensionOutput('com.reigh.creative-lab.timeline-faultline', {
      schemaVersion: 1,
      generatedFromVersion: -1,
      entries: [],
    }, timeline)).toMatchObject({ valid: false, reason: 'generatedFromVersion must be non-negative' });
  });

  it('validates command output against real persisted hold and trim timing', () => {
    const persistedTimeline = {
      tracks: [
        { id: 'V1', kind: 'visual', muted: false },
        { id: 'A1', kind: 'audio', muted: false },
      ],
      clips: [
        { id: 'visual-hold', track: 'V1', at: 0, hold: 4, clipType: 'media' },
        { id: 'audio-trim', track: 'A1', at: 2, from: 1, to: 7, speed: 2, clipType: 'media' },
      ],
    };
    const pulseMap = {
      schemaVersion: 1,
      generatedFromVersion: 3,
      entries: [
        { id: 'pulse-visual-hold-start', sourceClipId: 'visual-hold', edge: 'start', time: 0, offset: 0, intensity: 0.8, color: '#ff4d8d' },
        { id: 'pulse-audio-trim-start', sourceClipId: 'audio-trim', edge: 'start', time: 2, offset: 0, intensity: 0.6, color: '#52e8ff' },
        { id: 'pulse-audio-trim-end', sourceClipId: 'audio-trim', edge: 'end', time: 5, offset: 0, intensity: 0.6, color: '#52e8ff' },
        { id: 'pulse-visual-hold-end', sourceClipId: 'visual-hold', edge: 'end', time: 4, offset: 0, intensity: 0.8, color: '#ff4d8d' },
      ],
    };

    const result = validateExtensionOutput(
      'com.reigh.creative-lab.pulse-map',
      pulseMap,
      persistedTimeline,
    );
    expect(result.valid, result.reason).toBe(true);
    expect(result.count).toBe(4);

    expect(validateExtensionOutput(
      'com.reigh.creative-lab.pulse-map',
      {
        ...pulseMap,
        entries: pulseMap.entries.map((entry, index) => (
          index === 2 ? { ...entry, time: 6 } : entry
        )),
      },
      persistedTimeline,
    )).toMatchObject({ valid: false, reason: expect.stringContaining('does not match boundary') });

    expect(validateExtensionOutput(
      'com.reigh.creative-lab.pulse-map',
      { ...pulseMap, entries: [...pulseMap.entries.slice(0, 3), pulseMap.entries[0]] },
      persistedTimeline,
    )).toMatchObject({ valid: false, reason: expect.stringContaining('duplicate id') });
  });

  it('validates the exact versioned Faultline envelope for an anomalous persisted timeline', () => {
    const anomalousTimeline = {
      tracks: [{ id: 'V1', kind: 'visual', muted: false }],
      clips: [
        { id: 'clip-a', track: 'V1', at: 0, hold: 1, clipType: 'media' },
        { id: 'clip-b', track: 'V1', at: 3, hold: 1, clipType: 'media' },
      ],
    };
    const faultline = {
      schemaVersion: 1,
      generatedFromVersion: 4,
      entries: [{
        id: 'fault-gap-clip-b-clip-a',
        sourceClipId: 'clip-b',
        relatedClipId: 'clip-a',
        kind: 'gap',
        severity: 'warning',
        time: 1,
        label: 'gap before clip-b',
        color: '#52e8ff',
      }],
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.timeline-faultline',
      faultline,
      anomalousTimeline,
    )).toMatchObject({ valid: true, count: 1 });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.timeline-faultline',
      faultline,
      {
        ...anomalousTimeline,
        tracks: [{ id: 'V1', kind: 'visual' }],
      },
    )).toMatchObject({ valid: true, count: 1 });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.timeline-faultline',
      faultline,
      {
        ...anomalousTimeline,
        tracks: [{ id: 'V1', kind: 'visual', muted: true }],
      },
    )).toMatchObject({
      valid: false,
      reason: 'expected 0 entries, got 1',
    });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.timeline-faultline',
      { ...faultline, entries: [{ ...faultline.entries[0], time: 2 }] },
      anomalousTimeline,
    )).toMatchObject({
      valid: false,
      reason: 'faultline entries do not match the current timeline',
    });
  });

  it('enforces each persisted command contract and canonical fingerprints', () => {
    const recallSourceSignature = releaseHostFingerprint({
      sourceContract: 'recall-pulse/v3',
      primaryTrack: { id: 'V1', index: 0, kind: 'visual', muted: false },
      clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 2, clipType: 'media' }],
    });
    const locklineSourceSignature = releaseHostFingerprint({
      sourceContract: 'lockline-inspector/v2',
      assetKeys: [],
      trackIds: ['V1'],
      clips: [{
        id: 'clip-a',
        track: 'V1',
        at: '1',
        duration: '2',
        materialRefs: [],
        sourceRefs: [],
      }],
    });
    const outputs: Record<string, unknown> = {
      'com.reigh.scene-phase-markers': [{ id: 'marker-1', time: 1 }],
      'com.reigh.creative-lab.pulse-map': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'pulse-clip-a-start', sourceClipId: 'clip-a', edge: 'start', time: 1, offset: 0, intensity: 0.4, color: '#ff4d8d' },
        { id: 'pulse-clip-a-end', sourceClipId: 'clip-a', edge: 'end', time: 3, offset: 0, intensity: 0.4, color: '#ff4d8d' },
      ] },
      'com.reigh.creative-lab.soundtrack-cartographer': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'terrain-clip-a-start', sourceClipId: 'clip-a', edge: 'start', kind: 'rise', time: 1, offset: 0, intensity: 0.4, color: '#fff', label: 'rise' },
        { id: 'terrain-clip-a-release', sourceClipId: 'clip-a', edge: 'release', kind: 'release', time: 3, offset: 0, intensity: 0.4, color: '#fff', label: 'release' },
      ] },
      'com.reigh.creative-lab.caption-safe-zone-orchestra': [],
      'com.reigh.creative-lab.emotional-weather-map': [{ id: 'weather-clip-a', sourceClipId: 'clip-a', kind: 'breeze', time: 1, intensity: 0.4, color: '#fff', label: 'breeze' }],
      'com.reigh.creative-lab.timeline-faultline': { schemaVersion: 1, generatedFromVersion: 1, entries: [] },
      'com.reigh.creative-lab.foley-constellation': { schemaVersion: 1, generatedFromVersion: 1, entries: [
        { id: 'foley-clip-a-start', sourceClipId: 'clip-a', boundary: 'start', time: 1, category: 'unassigned', offset: 0, pan: 0, distance: 0.5, intensity: 0.45, label: 'Unassigned Foley cue · clip-a · start' },
        { id: 'foley-clip-a-end', sourceClipId: 'clip-a', boundary: 'end', time: 3, category: 'unassigned', offset: 0, pan: 0, distance: 0.5, intensity: 0.45, label: 'Unassigned Foley cue · clip-a · end' },
      ] },
      'com.reigh.creative-lab.branching-cut': { schemaVersion: 1, generatedFromVersion: 1, entries: [] },
      'com.reigh.creative-lab.chromatic-constellation': { schemaVersion: 1, generatedFromVersion: 1, coverage: { totalCandidates: 1, persistedCount: 1, displayLimit: 128, displayedCount: 1, omittedCount: 0, sourceTrackId: 'V1', sourceTrackLabel: 'Video', status: 'complete' }, entries: [{ id: 'constellation-clip-a', sourceClipId: 'clip-a', trackId: 'V1', trackLabel: 'Video', trackOrder: 0, pacingClass: 'steady', time: 1, duration: 2, intensity: 0.5, color: '#52e8d4', label: 'Pacing steady · Video · steady pacing (structural fallback)' }] },
      'com.reigh.creative-lab.recall-pulse': { schemaVersion: 3, generatedFromVersion: 1, sourceSignature: recallSourceSignature, stale: false, suggestions: [{ id: 'recall-suggestion-clip-a', sourceClipId: 'clip-a', checkpointId: 'recall-checkpoint-clip-a', trackId: 'V1', category: 'concept', assignment: 'unassigned', time: 1, duration: 2, intensity: 0.8, prompt: 'What is the central idea introduced at this point?', label: 'Unassigned review question · What is the central idea introduced at this point?', color: '#52e8ff', heuristic: 'ordered-clip:concept; duration-proxy:2.000s', method: 'timeline-structure:v2; first-unmuted-visual-track; no semantic/audio analysis' }] },
      'com.reigh.creative-lab.lockline-inspector': { schemaVersion: 2, generatedFromVersion: 1, sourceSignature: locklineSourceSignature, coverage: { totalClips: 1, scannedClips: 1, eligibleClips: 1, skippedInvalidClips: 0, candidateFindings: 0, persistedFindings: 0, omittedFindings: 0, omittedClips: 0 }, entries: [] },
    };
    for (const [extensionId, output] of Object.entries(outputs)) {
      const result = validateExtensionOutput(extensionId, output, timeline);
      expect(result.valid, `${extensionId}: ${result.reason}`).toBe(true);
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
    const foley = outputs['com.reigh.creative-lab.foley-constellation'] as {
      schemaVersion: number;
      generatedFromVersion: number;
      entries: Array<Record<string, unknown>>;
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.foley-constellation',
      { ...foley, entries: foley.entries.map((entry, index) => (
        index === 0 ? { ...entry, intensity: 0.46 } : entry
      )) },
      timeline,
    )).toMatchObject({
      valid: false,
      reason: 'foley entries do not match the current timeline',
    });
    const recall = outputs['com.reigh.creative-lab.recall-pulse'] as {
      suggestions: Array<Record<string, unknown>>;
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.recall-pulse',
      { ...outputs['com.reigh.creative-lab.recall-pulse'] as object, suggestions: [
        ...recall.suggestions,
        { ...recall.suggestions[0], id: 'unexpected-extra' },
      ] },
      timeline,
    )).toMatchObject({
      valid: false,
      reason: 'expected 1 recall suggestions, got 2',
    });
  });

  it('derives exact Foley cues from text clips on a default-unmuted primary track', () => {
    const captionTimeline = {
      tracks: [
        { id: 'captions', kind: 'visual' },
        { id: 'V1', kind: 'visual' },
      ],
      clips: [
        { id: 'caption-a', track: 'captions', at: 2, hold: 2, clipType: 'text' },
        { id: 'media-a', track: 'V1', at: 0, hold: 4, clipType: 'media' },
      ],
    };
    const output = {
      schemaVersion: 1,
      generatedFromVersion: 7,
      entries: [
        { id: 'foley-caption-a-start', sourceClipId: 'caption-a', boundary: 'start', category: 'unassigned', time: 2, offset: 0, pan: 0, distance: 0.5, intensity: 0.45, label: 'Unassigned Foley cue · caption-a · start' },
        { id: 'foley-caption-a-end', sourceClipId: 'caption-a', boundary: 'end', category: 'unassigned', time: 4, offset: 0, pan: 0, distance: 0.5, intensity: 0.45, label: 'Unassigned Foley cue · caption-a · end' },
      ],
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.foley-constellation',
      output,
      captionTimeline,
    )).toMatchObject({ valid: true, count: 2 });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.foley-constellation',
      output,
      { ...captionTimeline, tracks: [{ id: 'captions', kind: 'visual', muted: true }] },
    )).toMatchObject({ valid: false, reason: 'expected 0 entries, got 2' });
  });

  it('derives exact adjacent clip links from the complete primary visual track', () => {
    const captionTimeline = {
      tracks: [
        { id: 'captions', kind: 'visual' },
        { id: 'V1', kind: 'visual' },
      ],
      clips: [
        { id: 'caption-b', track: 'captions', at: 5, hold: 3, clipType: 'text' },
        { id: 'caption-a', track: 'captions', at: 2, hold: 2, clipType: 'text' },
        { id: 'media-a', track: 'V1', at: 0, hold: 4, clipType: 'media' },
      ],
    };
    const output = {
      schemaVersion: 1,
      generatedFromVersion: 8,
      entries: [{
        id: 'clip-link-caption-a-to-caption-b',
        sourceClipId: 'caption-a',
        targetClipId: 'caption-b',
        trackId: 'captions',
        time: 4,
        offset: 0,
        label: 'Link caption-a → caption-b',
      }],
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.branching-cut',
      output,
      captionTimeline,
    )).toMatchObject({ valid: true, count: 1 });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.branching-cut',
      { ...output, entries: [{ ...output.entries[0], targetClipId: 'media-a' }] },
      captionTimeline,
    )).toMatchObject({
      valid: false,
      reason: 'clip-link entries do not match the current timeline',
    });
  });

  it('persists complete Chromatic and Recall streams beyond the 128-marker viewport', () => {
    const clips = Array.from({ length: 129 }, (_, index) => ({
      id: `caption-${String(index).padStart(3, '0')}`,
      track: 'captions',
      at: index * 2,
      duration: 1,
      clipType: 'text',
    }));
    const tracks = [{ id: 'captions', kind: 'visual', label: 'Captions', muted: false }];
    const chromaticEntries = clips.map((clip) => ({
      id: `constellation-${clip.id}`,
      sourceClipId: clip.id,
      trackId: 'captions',
      trackLabel: 'Captions',
      trackOrder: 0,
      pacingClass: 'steady',
      time: clip.at,
      duration: 1,
      intensity: 0.5,
      color: '#52e8d4',
      label: 'Pacing steady · Captions · steady pacing (structural fallback)',
    }));
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.chromatic-constellation',
      {
        schemaVersion: 1,
        generatedFromVersion: 5,
        coverage: {
          totalCandidates: 129,
          persistedCount: 129,
          displayLimit: 128,
          displayedCount: 128,
          omittedCount: 1,
          sourceTrackId: 'captions',
          sourceTrackLabel: 'Captions',
          status: 'truncated',
        },
        entries: chromaticEntries,
      },
      { tracks, clips },
    )).toMatchObject({ valid: true, count: 129 });

    const sourceSignature = releaseHostFingerprint({
      sourceContract: 'recall-pulse/v3',
      primaryTrack: { id: 'captions', index: 0, kind: 'visual', muted: false },
      clips: clips.map((clip) => ({
        id: clip.id,
        track: clip.track,
        at: clip.at,
        duration: clip.duration,
        clipType: clip.clipType,
      })),
    });
    const questions = {
      concept: 'What is the central idea introduced at this point?',
      example: 'What concrete example should a learner be able to recall here?',
      recap: 'What should be recapped before moving beyond this point?',
      retrieval: 'What question could test retrieval of the material here?',
    } as const;
    const colors = {
      concept: '#52e8ff', example: '#ffd166', recap: '#b388ff', retrieval: '#ff4d8d',
    } as const;
    const recallEntries = clips.map((clip, index) => {
      const category: keyof typeof questions = index === 0
        ? 'concept'
        : index === clips.length - 1
          ? 'recap'
          : clip.duration <= 1.5 || index % 3 === 1
            ? 'example'
            : 'retrieval';
      const prompt = questions[category];
      return {
        id: `recall-suggestion-${clip.id}`,
        sourceClipId: clip.id,
        checkpointId: `recall-checkpoint-${clip.id}`,
        trackId: 'captions',
        category,
        assignment: 'unassigned',
        time: clip.at,
        duration: 1,
        intensity: category === 'concept' ? 0.8 : category === 'recap' ? 0.65 : category === 'retrieval' ? 0.9 : 0.575,
        prompt,
        label: `Unassigned review question · ${prompt}`,
        color: colors[category],
        heuristic: `ordered-clip:${category}; duration-proxy:1.000s`,
        method: 'timeline-structure:v2; first-unmuted-visual-track; no semantic/audio analysis',
      };
    });
    const recallResult = validateExtensionOutput(
      'com.reigh.creative-lab.recall-pulse',
      { schemaVersion: 3, generatedFromVersion: 6, sourceSignature, stale: false, suggestions: recallEntries },
      { tracks, clips },
    );
    expect(recallResult.valid, recallResult.reason).toBe(true);
    expect(recallResult.count).toBe(129);
  });

  it('binds Lockline findings, coverage, and source signature to registry facts', () => {
    const locklineTimeline = {
      tracks: [{ id: 'V1', kind: 'visual', label: 'Video', muted: false }],
      assetKeys: ['online.mov'],
      knownExtensionIds: ['com.reigh.transcript-lane'],
      clips: [{
        id: 'asset-clip',
        track: 'V1',
        at: 12.25,
        duration: 2,
        asset: 'missing.mov',
        source_uuid: 'com.reigh.transcript-lane',
      }],
    };
    const sourceSignature = releaseHostFingerprint({
      sourceContract: 'lockline-inspector/v2',
      assetKeys: ['online.mov'],
      trackIds: ['V1'],
      clips: [{
        id: 'asset-clip',
        track: 'V1',
        at: '12.25',
        duration: '2',
        materialRefs: [['material.asset.missing.mov.asset-clip', 'asset-clip', 'missing.mov']],
        sourceRefs: [[
          'source.com.reigh.transcript-lane.asset-clip',
          'asset-clip',
          'extension',
          'com.reigh.transcript-lane',
          '',
          'com.reigh.transcript-lane',
        ]],
      }],
    });
    const output = {
      schemaVersion: 2,
      generatedFromVersion: 9,
      sourceSignature,
      coverage: {
        totalClips: 1, scannedClips: 1, eligibleClips: 1, skippedInvalidClips: 0,
        candidateFindings: 1, persistedFindings: 1, omittedFindings: 0, omittedClips: 0,
      },
      entries: [
        { id: 'lockline-missing-registry-asset-key-asset-clip', sourceClipId: 'asset-clip', trackId: 'V1', kind: 'missing-registry-asset-key', severity: 'error', time: 12.25, label: 'error · clip asset-clip · missing registry asset key: missing.mov · refs: material.asset.missing.mov.asset-clip', color: '#ff8c42', referenceIds: ['material.asset.missing.mov.asset-clip'], assetKeys: ['missing.mov'] },
      ],
    };
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.lockline-inspector',
      output,
      locklineTimeline,
    )).toMatchObject({ valid: true, count: 1 });
    expect(validateExtensionOutput(
      'com.reigh.creative-lab.lockline-inspector',
      { ...output, sourceSignature: `${sourceSignature}drift` },
      locklineTimeline,
    )).toMatchObject({
      valid: false,
      reason: 'Lockline output does not match the current registry and timeline',
    });
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

  it('rejects a partial response that forges total_count=566', () => {
    expect(validateRunawayResponse({
      count: 566,
      total_count: 566,
      page: { limit: 1000, next_cursor: null },
      transitions: [],
      timing_summary: {},
    }).valid).toBe(false);
  });

  it('rejects a stable-but-wrong response with 566 rows', () => {
    const wrongRows = Array.from({ length: 566 }, (_, ordinal) => ({
      id: `wrong-${ordinal}`,
      ordinal,
      run_id: 'wrong-run',
      task_id: null,
      start_ms: ordinal,
      duration_ms: 1,
      prompt: 'wrong but stable',
      metadata: {
        manifest_id: `T${String(ordinal + 1).padStart(4, '0')}`,
        segment_id: 'S01',
        segment_label: 'Wrong fixture',
        timing_mode: 'hold',
        colour_name: 'rose',
        colour_hex: '#D47795',
        frame: ordinal,
        fps: 48,
      },
      created_at: '2026-08-24T00:00:00Z',
    }));
    expect(validateRunawayResponse({
      count: 566,
      total_count: 566,
      page: { limit: 1000, next_cursor: null },
      transitions: wrongRows,
      timing_summary: { evidence_id: 'wrong', run_id: 'wrong-run', summary: 'wrong', data: { frame_count: 8085, transition_count: 566, fps: 48, segment_counts: {} } },
    }).valid).toBe(false);
  });

  it('rejects missing cursor and provenance even when counts are correct', () => {
    expect(validateRunawayResponse({
      count: 566,
      total_count: 566,
      transitions: Array.from({ length: 566 }, () => ({})),
      timing_summary: { evidence_id: 'evidence', run_id: 'run', data: { frame_count: 8085, transition_count: 566, fps: 48 } },
    }).valid).toBe(false);
  });

  it('reports missing evidence and wrong migration identity separately', () => {
    const transitions = Array.from({ length: RUNAWAY_FIXTURE_FACTS.count }, () => ({}));
    const projectId = 'e94c704d0cdec4a279c7196de4';
    const base = {
      api_version: RUNAWAY_FIXTURE_FACTS.apiVersion,
      project: RUNAWAY_FIXTURE_FACTS.project,
      snapshot: `runaway-v1:${projectId}:566`,
      count: RUNAWAY_FIXTURE_FACTS.count,
      total_count: RUNAWAY_FIXTURE_FACTS.count,
      page: { limit: 1000, next_cursor: null },
      transitions,
    };
    expect(validateRunawayResponse({
      ...base,
      timing_summary: {
        evidence_id: '',
        run_id: RUNAWAY_FIXTURE_FACTS.runId,
        summary: RUNAWAY_FIXTURE_FACTS.summary,
        data: {},
        created_at: '2026-08-25T00:00:00Z',
      },
    }).reason).toBe('timing summary is missing evidence_id provenance');
    expect(validateRunawayResponse({
      ...base,
      timing_summary: {
        evidence_id: '01m0xmky6ap84680et0pa3cx2r',
        run_id: 'runaway-stub-run-v1',
        summary: RUNAWAY_FIXTURE_FACTS.summary,
        data: {},
        created_at: '2026-08-25T00:00:00Z',
      },
    }).reason).toBe('timing summary has the wrong migration run_id');
  });

  it('rejects malformed snapshot and generated identifier shapes', () => {
    const transitions = Array.from({ length: RUNAWAY_FIXTURE_FACTS.count }, () => ({}));
    const base = {
      api_version: RUNAWAY_FIXTURE_FACTS.apiVersion,
      project: RUNAWAY_FIXTURE_FACTS.project,
      count: RUNAWAY_FIXTURE_FACTS.count,
      total_count: RUNAWAY_FIXTURE_FACTS.count,
      page: { limit: 1000, next_cursor: null },
      transitions,
      timing_summary: {
        evidence_id: 'not-a-ulid',
        run_id: RUNAWAY_FIXTURE_FACTS.runId,
        summary: RUNAWAY_FIXTURE_FACTS.summary,
        data: {},
        created_at: '2026-08-25T00:00:00Z',
      },
    };
    expect(validateRunawayResponse({ ...base, snapshot: 'garbage' }).reason)
      .toBe('response identity does not match the real Astrid v1 Runaway fixture');
    expect(validateRunawayResponse({
      ...base,
      snapshot: 'runaway-v1:e94c704d0cdec4a279c7196de4:566',
    }).reason).toBe('timing summary evidence_id is not a lowercase Crockford ULID');
  });
});
