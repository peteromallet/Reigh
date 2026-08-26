import { describe, expect, it } from 'vitest';
import {
  AUDIO_CARRIER_BYTES,
  hasSuccessfulAudioFullFetch,
  hasSuccessfulAudioMediaRange,
  isExpectedAudioMetadataAbort,
  meaningfulChange,
  RUNAWAY_FIXTURE_FACTS,
  validateExtensionOutput,
  validateRunawayResponse,
  validateTranscriptCaptions,
} from './paired-repository.validators';

const timeline = {
  tracks: [{ id: 'V1', kind: 'visual', muted: false }],
  clips: [{ id: 'clip-a', track: 'V1', at: 1, duration: 2, clipType: 'media' }],
};

describe('paired release semantic validators', () => {
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

  it('enforces each persisted command contract and canonical fingerprints', () => {
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
