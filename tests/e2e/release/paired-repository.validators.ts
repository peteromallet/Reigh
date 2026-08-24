import { createHash } from 'node:crypto';

export type ProbeClip = {
  id?: string;
  at?: number;
  duration?: number;
  hold?: number;
  track?: string;
  clipType?: string;
  text?: unknown;
};

export type ProbeTrack = { id?: string; kind?: string; muted?: boolean };

export type ProbeTimeline = { clips?: ProbeClip[]; tracks?: ProbeTrack[] };

export type ValidationResult = {
  valid: boolean;
  reason: string;
  fingerprint: string | null;
  count: number;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function canonicalFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function invalid(reason: string): ValidationResult {
  return { valid: false, reason, fingerprint: null, count: 0 };
}

function valid(value: unknown, count: number): ValidationResult {
  return { valid: true, reason: '', fingerprint: canonicalFingerprint(value), count };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function bounded(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): boolean {
  return finite(value) && value >= min && value <= max;
}

function entries(value: unknown, fields: Record<string, (entry: Record<string, unknown>) => boolean>): ValidationResult {
  if (!Array.isArray(value)) return invalid('expected an array');
  for (const [index, item] of value.entries()) {
    if (!record(item)) return invalid(`entry ${index} is not an object`);
    for (const [field, predicate] of Object.entries(fields)) {
      if (!predicate(item)) return invalid(`entry ${index} has invalid ${field}`);
    }
  }
  return valid(value, value.length);
}

const id = (entry: Record<string, unknown>) => nonEmpty(entry.id);
const sourceClipId = (entry: Record<string, unknown>) => nonEmpty(entry.sourceClipId);
const time = (entry: Record<string, unknown>) => bounded(entry.time, 0);
const label = (entry: Record<string, unknown>) => nonEmpty(entry.label);
const intensity = (entry: Record<string, unknown>) => bounded(entry.intensity, 0, 1);
const offset = (entry: Record<string, unknown>) => bounded(entry.offset, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

function expectedVisualClips(timeline: ProbeTimeline): ProbeClip[] {
  const tracks = new Map((timeline.tracks ?? []).map((track) => [track.id, track]));
  const primary = (timeline.tracks ?? []).find((track) => track.kind === 'visual' && track.muted !== true);
  return (timeline.clips ?? []).filter((clip) => (
    typeof clip.id === 'string'
    && finite(clip.at)
    && finite(clip.duration)
    && (!primary || clip.track === primary.id)
    && (!primary ? (!clip.track || tracks.get(clip.track)?.kind === 'visual') : true)
    && !['text', 'automation', 'effect', 'transition'].includes(clip.clipType?.trim().toLowerCase() ?? '')
  ));
}

function allUsableClips(timeline: ProbeTimeline): ProbeClip[] {
  return (timeline.clips ?? []).filter((clip) => typeof clip.id === 'string' && finite(clip.at) && finite(clip.duration));
}

function expectedBoundaryCount(timeline: ProbeTimeline): number {
  return Math.min(128, allUsableClips(timeline).reduce((total, clip) => (
    total + 1 + (Math.max(0, clip.duration ?? 0) > 0 ? 1 : 0)
  ), 0));
}

function expectedPrimaryBoundaryCount(timeline: ProbeTimeline): number {
  return Math.min(128, expectedVisualClips(timeline).reduce((total, clip) => (
    total + 1 + (Math.max(0, clip.duration ?? 0) > 0 ? 1 : 0)
  ), 0));
}

function expectedTerrainBoundaryCount(timeline: ProbeTimeline): number {
  const tracks = new Map((timeline.tracks ?? []).map((track) => [track.id, track]));
  const clips = allUsableClips(timeline).filter((clip) => tracks.get(clip.track)?.kind === 'visual' && tracks.get(clip.track)?.muted !== true);
  return Math.min(128, clips.reduce((total, clip) => total + 1 + (Math.max(0, clip.duration ?? 0) > 0 ? 1 : 0), 0));
}

function envelope(value: unknown, expectedSchema: number, fieldValidators: Record<string, (entry: Record<string, unknown>) => boolean>, timeline: ProbeTimeline, expectedEntries = expectedBoundaryCount(timeline)): ValidationResult {
  if (!record(value)) return invalid('expected an envelope object');
  if (value.schemaVersion !== expectedSchema) return invalid(`schemaVersion must be ${expectedSchema}`);
  if (!finite(value.generatedFromVersion) || value.generatedFromVersion < 0) return invalid('generatedFromVersion must be non-negative');
  const result = entries(value.entries, fieldValidators);
  if (!result.valid) return result;
  if (result.count !== expectedEntries) return invalid(`expected ${expectedEntries} entries, got ${result.count}`);
  return valid(value, result.count);
}

function arrayOutput(value: unknown, fields: Record<string, (entry: Record<string, unknown>) => boolean>, expectedCount: number): ValidationResult {
  const result = entries(value, fields);
  if (!result.valid) return result;
  if (result.count !== expectedCount) return invalid(`expected ${expectedCount} entries, got ${result.count}`);
  return valid(value, result.count);
}

/** Validate one persisted command result against its extension's public contract. */
export function validateExtensionOutput(extensionId: string, value: unknown, timeline: ProbeTimeline): ValidationResult {
  if (value === undefined || value === null) return invalid('persisted output is null or undefined');
  const expected = expectedBoundaryCount(timeline);
  switch (extensionId) {
    case 'com.reigh.scene-phase-markers': {
      const result = entries(value, { id, time: (entry) => bounded(entry.time, 0, 9999.999) });
      if (!result.valid) return result;
      return result.count > 0 ? valid(value, result.count) : invalid('scene marker command produced no marker');
    }
    case 'com.reigh.creative-lab.pulse-map':
      return envelope(value, 1, { id, sourceClipId, edge: (e) => e.edge === 'start' || e.edge === 'end', time, offset, intensity, color: (e) => nonEmpty(e.color) }, timeline, expected);
    case 'com.reigh.creative-lab.soundtrack-cartographer':
      return envelope(value, 1, { id, sourceClipId, edge: (e) => e.edge === 'start' || e.edge === 'release', kind: (e) => e.kind === 'rise' || e.kind === 'peak' || e.kind === 'release', time, offset, intensity, color: (e) => nonEmpty(e.color), label }, timeline, expectedTerrainBoundaryCount(timeline));
    case 'com.reigh.creative-lab.caption-safe-zone-orchestra':
      return arrayOutput(value, { id, sourceClipId, relatedClipId: (e) => e.relatedClipId === undefined || nonEmpty(e.relatedClipId), kind: (e) => ['negative-start', 'too-brief', 'non-visual-track', 'overlap'].includes(String(e.kind)), severity: (e) => e.severity === 'warning' || e.severity === 'error', time, label, color: (e) => nonEmpty(e.color) }, 0);
    case 'com.reigh.creative-lab.emotional-weather-map':
      return arrayOutput(value, { id, sourceClipId, kind: (e) => ['breeze', 'fog', 'lightning', 'sunshine'].includes(String(e.kind)), time, intensity, color: (e) => nonEmpty(e.color), label }, Math.min(128, expectedVisualClips(timeline).length));
    case 'com.reigh.creative-lab.timeline-faultline':
      return arrayOutput(value, { id, sourceClipId, relatedClipId: (e) => e.relatedClipId === undefined || nonEmpty(e.relatedClipId), kind: (e) => ['negative-start', 'negative-duration', 'zero-duration', 'missing-track', 'non-finite', 'overlap', 'gap'].includes(String(e.kind)), severity: (e) => e.severity === 'warning' || e.severity === 'error', time, label, color: (e) => nonEmpty(e.color) }, 0);
    case 'com.reigh.creative-lab.foley-constellation':
      return envelope(value, 1, { id, sourceClipId: (e) => e.sourceClipId === null || nonEmpty(e.sourceClipId), boundary: (e) => e.boundary === 'start' || e.boundary === 'end' || e.boundary === 'playhead', time, category: (e) => nonEmpty(e.category), offset, pan: (e) => bounded(e.pan, -1, 1), distance: (e) => bounded(e.distance, 0, 1), intensity, label }, timeline, expectedPrimaryBoundaryCount(timeline));
    case 'com.reigh.creative-lab.branching-cut':
      return envelope(value, 1, { id, sourceClipId, targetClipId: (e) => nonEmpty(e.targetClipId), trackId: (e) => nonEmpty(e.trackId), time, offset, label }, timeline, Math.max(0, expectedVisualClips(timeline).length - 1));
    case 'com.reigh.creative-lab.chromatic-constellation': {
      if (!record(value) || value.schemaVersion !== 1 || !record(value.coverage)) return invalid('invalid chromatic constellation envelope');
      const result = entries(value.entries, { id, sourceClipId, trackId: (e) => nonEmpty(e.trackId), trackLabel: (e) => nonEmpty(e.trackLabel), trackOrder: (e) => finite(e.trackOrder), pacingClass: (e) => nonEmpty(e.pacingClass), time, duration: (e) => bounded(e.duration, 0), intensity, color: (e) => nonEmpty(e.color), label });
      const expectedConstellationCount = Math.min(128, expectedVisualClips(timeline).length);
      if (!result.valid || result.count !== expectedConstellationCount) return result.valid ? invalid(`expected ${expectedConstellationCount} entries, got ${result.count}`) : result;
      const coverage = value.coverage as Record<string, unknown>;
      if (!Number.isInteger(coverage.totalCandidates) || (coverage.totalCandidates as number) < result.count || coverage.persistedCount !== result.count || coverage.displayedCount !== result.count || coverage.omittedCount !== (coverage.totalCandidates as number) - result.count) return invalid('chromatic coverage does not describe entries');
      return valid(value, result.count);
    }
    case 'com.reigh.creative-lab.recall-pulse': {
      if (!record(value) || value.schemaVersion !== 3 || !nonEmpty(value.sourceSignature) || value.stale !== false) return invalid('invalid recall pulse envelope');
      const result = entries(value.suggestions, { id, sourceClipId, checkpointId: (e) => nonEmpty(e.checkpointId), trackId: (e) => nonEmpty(e.trackId), category: (e) => ['concept', 'example', 'retrieval', 'recap'].includes(String(e.category)), assignment: (e) => e.assignment === 'unassigned', time, duration: (e) => bounded(e.duration, 0), intensity, prompt: (e) => nonEmpty(e.prompt), label, color: (e) => nonEmpty(e.color), heuristic: (e) => nonEmpty(e.heuristic), method: (e) => nonEmpty(e.method) });
      if (!result.valid) return result;
      const expectedSuggestionCount = Math.min(128, expectedVisualClips(timeline).length);
      return result.count === expectedSuggestionCount ? valid(value, result.count) : invalid(`expected ${expectedSuggestionCount} suggestions, got ${result.count}`);
    }
    case 'com.reigh.creative-lab.lockline-inspector': {
      if (!record(value) || value.schemaVersion !== 2 || !nonEmpty(value.sourceSignature) || !record(value.coverage)) return invalid('invalid lockline report envelope');
      const result = entries(value.entries, { id, sourceClipId, trackId: (e) => nonEmpty(e.trackId), kind: (e) => nonEmpty(e.kind), severity: (e) => e.severity === 'warning' || e.severity === 'error', time, label, color: (e) => nonEmpty(e.color), referenceIds: (e) => Array.isArray(e.referenceIds) && e.referenceIds.every(nonEmpty) });
      if (!result.valid) return result;
      const coverage = value.coverage as Record<string, unknown>;
      if (coverage.persistedFindings !== result.count || typeof coverage.candidateFindings !== 'number' || coverage.omittedFindings !== coverage.candidateFindings - result.count || typeof coverage.scannedClips !== 'number' || typeof coverage.totalClips !== 'number' || typeof coverage.eligibleClips !== 'number' || coverage.scannedClips > coverage.totalClips || coverage.eligibleClips > coverage.scannedClips) return invalid('lockline coverage does not describe entries');
      return valid(value, result.count);
    }
    default:
      return invalid(`no validator registered for ${extensionId}`);
  }
}

export type ExpectedCaption = { id: string; text: string; at: number; duration: number };

/** Exact materialized caption contract, including deterministic IDs and timings. */
export function validateTranscriptCaptions(clips: readonly ProbeClip[], expected: readonly ExpectedCaption[]): ValidationResult {
  const captions = clips.filter((clip) => clip.id?.startsWith('transcript-caption-'));
  if (captions.length !== expected.length) return invalid(`expected exactly ${expected.length} materialized captions, got ${captions.length}`);
  const actual = captions.map((clip) => ({
    id: clip.id,
    text: record(clip.text) ? clip.text.content : undefined,
    at: clip.at,
    duration: clip.duration ?? clip.hold,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const wanted = expected.slice().sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, caption] of actual.entries()) {
    const target = wanted[index];
    if (!target || caption.id !== target.id || caption.text !== target.text || caption.at !== target.at || caption.duration !== target.duration) return invalid(`caption ${caption.id ?? index} does not match exact expected output`);
    if (!nonEmpty(caption.text) || !finite(caption.at) || !finite(caption.duration) || caption.at < 0 || caption.duration <= 0) return invalid(`caption ${caption.id ?? index} has invalid content or timing`);
  }
  return valid(actual, actual.length);
}

export function meaningfulChange(before: ValidationResult, after: ValidationResult): boolean {
  return after.valid && (before.fingerprint === null || before.fingerprint !== after.fingerprint);
}
