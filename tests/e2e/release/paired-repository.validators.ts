import { createHash } from 'node:crypto';

export type ProbeClip = {
  id?: string;
  at?: number;
  duration?: number;
  hold?: number;
  from?: number;
  to?: number;
  speed?: number;
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

export const AUDIO_CARRIER_FILE = 'motion-output-audio.aac';
export const AUDIO_CARRIER_BYTES = 457_980;

export type AudioTransportObservation = {
  url: string;
  method: string;
  resourceType: string;
  range: string | undefined;
  failure?: string;
  status?: number;
  contentLength?: string;
  contentRange?: string;
  contentType?: string;
};

/**
 * Chromium may cancel its initial metadata range after learning enough to
 * issue a tail range.  Only that exact media request is eligible; successful
 * transport and media readiness are proven separately by the browser gate.
 */
export function isExpectedAudioMetadataAbort(
  observation: AudioTransportObservation,
  expectedUrl: string,
): boolean {
  const lastByte = AUDIO_CARRIER_BYTES - 1;
  const match = observation.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] === '' ? lastByte : Number(match[2]);
  const validSingleRange = Number.isSafeInteger(start)
    && Number.isSafeInteger(end)
    && start >= 0
    && start <= end
    && end <= lastByte;
  return observation.url === expectedUrl
    && observation.method === 'GET'
    && observation.resourceType === 'media'
    && observation.failure === 'net::ERR_ABORTED'
    && validSingleRange;
}

export function hasSuccessfulAudioFullFetch(
  observations: AudioTransportObservation[],
  expectedUrl: string,
): boolean {
  return observations.some((observation) => observation.url === expectedUrl
    && observation.method === 'GET'
    && observation.resourceType === 'fetch'
    && observation.status === 200
    && observation.contentLength === String(AUDIO_CARRIER_BYTES)
    && observation.contentType === 'audio/x-aac');
}

export function hasSuccessfulAudioMediaRange(
  observations: AudioTransportObservation[],
  expectedUrl: string,
): boolean {
  const lastByte = AUDIO_CARRIER_BYTES - 1;
  return observations.some((observation) => {
    if (observation.url !== expectedUrl
      || observation.method !== 'GET'
      || observation.resourceType !== 'media'
      || observation.status !== 206
      || observation.contentType !== 'audio/x-aac') return false;
    const requestMatch = observation.range?.match(/^bytes=(\d+)-(\d*)$/);
    const responseMatch = observation.contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!requestMatch || !responseMatch) return false;
    const requestStart = Number(requestMatch[1]);
    const requestEnd = requestMatch[2] === '' ? lastByte : Number(requestMatch[2]);
    const responseStart = Number(responseMatch[1]);
    const responseEnd = Number(responseMatch[2]);
    const responseTotal = Number(responseMatch[3]);
    return Number.isSafeInteger(requestStart)
      && Number.isSafeInteger(requestEnd)
      && requestStart >= 0
      && requestStart <= requestEnd
      && requestEnd <= lastByte
      && responseStart >= 0
      && responseStart <= responseEnd
      && responseEnd <= lastByte
      && requestStart === responseStart
      && requestEnd === responseEnd
      && responseEnd === lastByte
      && responseTotal === AUDIO_CARRIER_BYTES
      && observation.contentLength === String(responseEnd - responseStart + 1);
  });
}

/**
 * The release Runaway fixture is deliberately owned by this test contract.
 * Keeping these facts here means a restart receipt cannot bless a changed,
 * but internally stable, 566-row response.
 */
export const RUNAWAY_FIXTURE_FACTS = Object.freeze({
  apiVersion: 'v1',
  project: 'runaway-piano-colour-demo',
  count: 566,
  frameCount: 8_085,
  fps: 48,
  runId: '01j5runawaytimingv1000000000000',
  summary: 'Runaway timing v1 migrated from timing-manifest.json',
  subtype: 'runaway_timing_migrated',
  source: 'external/timing-manifest.json',
  sourceSha256: '44b5c0eea0aeb8b35a83e3e7620b5dbab27a106bf575fcc6e0ca6591dd4612bb',
  firstManifestId: 'T0001',
  lastManifestId: 'T0566',
  firstFrame: 14,
  lastFrame: 7_951,
  firstSegmentLabel: 'Opening main notes',
  lastSegmentLabel: 'Sustained-note outro',
  declaredRegions: 11,
  segmentCounts: Object.freeze({
    S01: 16,
    S02: 125,
    S03: 0,
    S04: 211,
    S05: 12,
    S06A: 21,
    S06B: 11,
    S07: 24,
    S08: 140,
    S09: 4,
    S10: 2,
  }),
  colours: Object.freeze({
    blue: '#26A7D0',
    gold: '#B59432',
    green: '#77A95B',
    indigo: '#7B94E2',
    orange: '#D57F57',
    rose: '#D47795',
    teal: '#16B09B',
    violet: '#B481CB',
  }),
  // SHA-256 of the deterministic migration semantics in the pinned real
  // Astrid response. Database-owned ids, project ids, and timestamps are
  // validated separately but excluded so fresh migrations compare cleanly.
  semanticHash: '82a6d870a02322857792677f60e64b8b0ba7e5c084637b070b93c9e9a2da5307',
});

type RunawayResponse = {
  api_version?: unknown;
  project?: unknown;
  snapshot?: unknown;
  count?: unknown;
  total_count?: unknown;
  transitions?: unknown;
  page?: unknown;
  timing_summary?: unknown;
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

const LOWERCASE_ULID = /^[0123456789abcdefghjkmnpqrstvwxyz]{26}$/;

function lowercaseUlid(value: unknown): value is string {
  return typeof value === 'string' && LOWERCASE_ULID.test(value);
}

function bounded(value: unknown, min = 0, max = Number.POSITIVE_INFINITY): boolean {
  return finite(value) && value >= min && value <= max;
}

function integer(value: unknown): value is number {
  return Number.isInteger(value);
}

function timestamp(value: unknown): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

/** Match Python's round-to-even used by the pinned migration. */
function frameMilliseconds(frame: number): number {
  const numerator = frame * 1_000;
  const quotient = Math.floor(numerator / RUNAWAY_FIXTURE_FACTS.fps);
  const remainder = numerator % RUNAWAY_FIXTURE_FACTS.fps;
  const doubled = remainder * 2;
  if (doubled < RUNAWAY_FIXTURE_FACTS.fps) return quotient;
  if (doubled > RUNAWAY_FIXTURE_FACTS.fps) return quotient + 1;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

function runawaySemantics(
  summary: Record<string, unknown>,
  transitions: Record<string, unknown>[],
): unknown {
  return {
    timingSummary: {
      run_id: summary.run_id,
      summary: summary.summary,
      data: summary.data,
    },
    transitions: transitions.map((transition) => ({
      run_id: transition.run_id,
      task_id: transition.task_id,
      ordinal: transition.ordinal,
      start_ms: transition.start_ms,
      duration_ms: transition.duration_ms,
      prompt: transition.prompt,
      metadata: transition.metadata,
    })),
  };
}

/** Validate the complete, single-page Runaway release response. */
export function validateRunawayResponse(value: unknown): ValidationResult {
  if (!record(value)) return invalid('expected a Runaway response object');
  const response = value as RunawayResponse;
  const snapshotMatch = typeof response.snapshot === 'string'
    ? /^runaway-v1:([0123456789abcdefghjkmnpqrstvwxyz]{26}):(0|[1-9]\d*)$/.exec(response.snapshot)
    : null;
  if (response.api_version !== RUNAWAY_FIXTURE_FACTS.apiVersion
    || response.project !== RUNAWAY_FIXTURE_FACTS.project
    || snapshotMatch === null) {
    return invalid('response identity does not match the real Astrid v1 Runaway fixture');
  }
  if (response.count !== RUNAWAY_FIXTURE_FACTS.count) return invalid('count must be exactly 566');
  if (response.total_count !== RUNAWAY_FIXTURE_FACTS.count) return invalid('total_count must be exactly 566');
  if (!Array.isArray(response.transitions)) return invalid('transitions must be an array');
  if (response.transitions.length !== RUNAWAY_FIXTURE_FACTS.count) return invalid('transitions.length must be exactly 566');

  if (!record(response.page) || response.page.limit !== 1_000
    || !Object.prototype.hasOwnProperty.call(response.page, 'next_cursor')
    || response.page.next_cursor !== null) {
    return invalid('page must declare limit=1000 and no next cursor');
  }

  const summary = response.timing_summary;
  if (!record(summary)) return invalid('timing summary must be an object');
  if (summary.evidence_id === '') return invalid('timing summary is missing evidence_id provenance');
  if (!lowercaseUlid(summary.evidence_id)) return invalid('timing summary evidence_id is not a lowercase Crockford ULID');
  if (summary.run_id !== RUNAWAY_FIXTURE_FACTS.runId) return invalid('timing summary has the wrong migration run_id');
  if (summary.summary !== RUNAWAY_FIXTURE_FACTS.summary) return invalid('timing summary text does not match the migration receipt');
  if (!timestamp(summary.created_at)) return invalid('timing summary has an invalid created_at timestamp');
  if (!record(summary.data)) return invalid('timing summary data must be an object');
  const data = summary.data;
  if (data.frame_count !== RUNAWAY_FIXTURE_FACTS.frameCount
    || data.transition_count !== RUNAWAY_FIXTURE_FACTS.count
    || data.fps !== RUNAWAY_FIXTURE_FACTS.fps
    || data.subtype !== RUNAWAY_FIXTURE_FACTS.subtype
    || data.source !== RUNAWAY_FIXTURE_FACTS.source
    || data.source_sha256 !== RUNAWAY_FIXTURE_FACTS.sourceSha256
    || !nonEmpty(data.manifest_intent)
    || !record(data.segment_counts)
    || canonicalFingerprint(data.segment_counts) !== canonicalFingerprint(RUNAWAY_FIXTURE_FACTS.segmentCounts)) {
    return invalid('timing summary does not match the pinned manifest facts');
  }

  const transitions: Record<string, unknown>[] = [];
  const rowIds = new Set<string>();
  const segmentCounts = Object.fromEntries(
    Object.keys(RUNAWAY_FIXTURE_FACTS.segmentCounts).map((segment) => [segment, 0]),
  ) as Record<string, number>;
  let projectId: string | null = null;
  let previousFrame = -1;
  for (const [index, candidate] of response.transitions.entries()) {
    if (!record(candidate) || !record(candidate.metadata)) return invalid(`transition ${index} is missing provenance`);
    const metadata = candidate.metadata;
    if (!lowercaseUlid(candidate.id) || rowIds.has(candidate.id)) return invalid(`transition ${index} has a malformed or duplicate id`);
    rowIds.add(candidate.id);
    if (!lowercaseUlid(candidate.project_id)) return invalid(`transition ${index} has a malformed project_id`);
    projectId ??= candidate.project_id;
    if (snapshotMatch[1] !== projectId) return invalid(`transition ${index} project_id does not match the snapshot`);
    if (candidate.project_id !== projectId) return invalid(`transition ${index} belongs to a different project`);
    if (candidate.run_id !== RUNAWAY_FIXTURE_FACTS.runId
      || candidate.task_id !== null
      || candidate.ordinal !== index
      || !integer(candidate.start_ms) || (candidate.start_ms as number) < 0
      || !integer(candidate.duration_ms) || (candidate.duration_ms as number) <= 0
      || !nonEmpty(candidate.prompt)
      || !timestamp(candidate.created_at)
      || metadata.manifest_id !== `T${String(index + 1).padStart(4, '0')}`
      || !nonEmpty(metadata.segment_id)
      || !Object.prototype.hasOwnProperty.call(segmentCounts, metadata.segment_id)
      || !nonEmpty(metadata.segment_label)
      || !nonEmpty(metadata.timing_mode)
      || !nonEmpty(metadata.colour_name)
      || RUNAWAY_FIXTURE_FACTS.colours[metadata.colour_name as keyof typeof RUNAWAY_FIXTURE_FACTS.colours] !== metadata.colour_hex
      || !integer(metadata.colour_index) || !bounded(metadata.colour_index, 0, 7)
      || !integer(metadata.frame) || !bounded(metadata.frame, 0, RUNAWAY_FIXTURE_FACTS.frameCount - 1)
      || metadata.fps !== RUNAWAY_FIXTURE_FACTS.fps
      || metadata.range_end_frame !== RUNAWAY_FIXTURE_FACTS.frameCount) {
      return invalid(`transition ${index} does not match the pinned manifest row`);
    }
    const frame = metadata.frame as number;
    if (frame <= previousFrame) return invalid(`transition ${index} frame is not strictly increasing`);
    previousFrame = frame;
    segmentCounts[metadata.segment_id as string] += 1;
    transitions.push(candidate);
  }

  if (canonicalFingerprint(segmentCounts) !== canonicalFingerprint(RUNAWAY_FIXTURE_FACTS.segmentCounts)) {
    return invalid('transition segment histogram does not match the pinned manifest');
  }
  for (const [index, transition] of transitions.entries()) {
    const metadata = transition.metadata as Record<string, unknown>;
    const frame = metadata.frame as number;
    const nextFrame = index + 1 < transitions.length
      ? ((transitions[index + 1].metadata as Record<string, unknown>).frame as number)
      : RUNAWAY_FIXTURE_FACTS.frameCount;
    if (transition.start_ms !== frameMilliseconds(frame)) {
      return invalid(`transition ${index} start_ms does not match its frame`);
    }
    if (transition.duration_ms !== frameMilliseconds(nextFrame - frame)) {
      return invalid(`transition ${index} duration_ms does not match the next frame`);
    }
  }

  const first = transitions[0].metadata as Record<string, unknown>;
  const last = transitions.at(-1)!.metadata as Record<string, unknown>;
  if (first.manifest_id !== RUNAWAY_FIXTURE_FACTS.firstManifestId
    || first.frame !== RUNAWAY_FIXTURE_FACTS.firstFrame
    || first.segment_label !== RUNAWAY_FIXTURE_FACTS.firstSegmentLabel
    || last.manifest_id !== RUNAWAY_FIXTURE_FACTS.lastManifestId
    || last.frame !== RUNAWAY_FIXTURE_FACTS.lastFrame
    || last.segment_label !== RUNAWAY_FIXTURE_FACTS.lastSegmentLabel) {
    return invalid('first/last Runaway transition semantics do not match the pinned manifest');
  }

  const fingerprint = canonicalFingerprint(runawaySemantics(summary, transitions));
  if (fingerprint !== RUNAWAY_FIXTURE_FACTS.semanticHash) {
    return invalid(`semantic Runaway fixture hash mismatch: ${fingerprint}`);
  }
  return { valid: true, reason: '', fingerprint, count: response.transitions.length };
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

/**
 * Project persistence stores authored timing (`hold` or `from`/`to`/`speed`),
 * while extensions consume the host-owned TimelineSnapshot projection where
 * every clip has a derived `duration`. Release validators must compare an
 * extension's output with that same public projection, not a test-only
 * `duration` field that does not exist in a real persisted document.
 */
function snapshotDuration(clip: ProbeClip): number {
  if (finite(clip.hold)) return clip.hold;
  // `duration` is accepted for an already-projected TimelineSnapshot (the
  // validator's unit fixtures and any future direct reader capture).
  if (finite(clip.duration)) return clip.duration;
  const from = finite(clip.from) ? clip.from : 0;
  const to = finite(clip.to) ? clip.to : 0;
  const speed = typeof clip.speed === 'number' ? clip.speed : 1;
  return to > from ? (to - from) / speed : 0;
}

function snapshotClips(timeline: ProbeTimeline): ProbeClip[] {
  return (timeline.clips ?? [])
    .filter((clip) => typeof clip.id === 'string' && finite(clip.at))
    .map((clip) => ({ ...clip, duration: snapshotDuration(clip) }))
    .filter((clip) => finite(clip.duration));
}

function expectedVisualClips(timeline: ProbeTimeline): ProbeClip[] {
  const tracks = new Map((timeline.tracks ?? []).map((track) => [track.id, track]));
  const primary = (timeline.tracks ?? []).find((track) => track.kind === 'visual' && track.muted !== true);
  return snapshotClips(timeline).filter((clip) => (
    (!primary || clip.track === primary.id)
    && (!primary ? (!clip.track || tracks.get(clip.track)?.kind === 'visual') : true)
    && !['text', 'automation', 'effect', 'transition'].includes(clip.clipType?.trim().toLowerCase() ?? '')
  ));
}

function allUsableClips(timeline: ProbeTimeline): ProbeClip[] {
  return snapshotClips(timeline);
}

function expectedBoundaryCount(timeline: ProbeTimeline): number {
  return Math.min(128, allUsableClips(timeline).reduce((total, clip) => (
    total + 1 + (Math.max(0, clip.duration ?? 0) > 0 ? 1 : 0)
  ), 0));
}

const PULSE_COLORS = ['#ff4d8d', '#52e8ff', '#ffd166', '#b388ff'] as const;

function normalizePulseTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1000) / 1000;
}

function pulseIntensity(duration: number): number {
  return Math.round(Math.min(Math.max(duration, 0) / 5, 1) * 1000) / 1000;
}

function expectedPulseEntries(timeline: ProbeTimeline): Array<{
  id: string;
  sourceClipId: string;
  edge: 'start' | 'end';
  structuralTime: number;
  intensity: number;
  color: string;
}> {
  const ordered = allUsableClips(timeline).slice().sort((left, right) => (
    (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
  ));
  const expected: ReturnType<typeof expectedPulseEntries> = [];
  for (const [index, clip] of ordered.entries()) {
    if (expected.length >= 128) break;
    const sourceClipId = clip.id!;
    const start = Math.max(0, clip.at ?? 0);
    const duration = Math.max(0, clip.duration ?? 0);
    const shared = {
      sourceClipId,
      intensity: pulseIntensity(duration),
      color: PULSE_COLORS[index % PULSE_COLORS.length],
    };
    expected.push({
      ...shared,
      id: `pulse-${sourceClipId}-start`,
      edge: 'start',
      structuralTime: start,
    });
    if (duration > 0 && expected.length < 128) {
      expected.push({
        ...shared,
        id: `pulse-${sourceClipId}-end`,
        edge: 'end',
        structuralTime: start + duration,
      });
    }
  }
  return expected;
}

function validatePulseMap(value: unknown, timeline: ProbeTimeline): ValidationResult {
  const expected = expectedPulseEntries(timeline);
  const shape = envelope(value, 1, {
    id,
    sourceClipId,
    edge: (entry) => entry.edge === 'start' || entry.edge === 'end',
    time,
    offset,
    intensity,
    color: (entry) => nonEmpty(entry.color),
  }, timeline, expected.length);
  if (!shape.valid || !record(value) || !Array.isArray(value.entries)) return shape;

  const expectedById = new Map(expected.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries.entries()) {
    const entry = candidate as Record<string, unknown>;
    const entryId = entry.id as string;
    if (seen.has(entryId)) return invalid(`entry ${index} has duplicate id ${entryId}`);
    seen.add(entryId);
    const source = expectedById.get(entryId);
    if (!source) return invalid(`entry ${index} does not map to a current clip boundary`);
    const expectedTime = normalizePulseTime(source.structuralTime + (entry.offset as number));
    if (entry.sourceClipId !== source.sourceClipId
      || entry.edge !== source.edge
      || entry.time !== expectedTime
      || entry.intensity !== source.intensity
      || entry.color !== source.color) {
      return invalid(`entry ${index} does not match boundary ${entryId}`);
    }
  }
  return shape;
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

const FAULTLINE_COLORS = {
  overlap: '#ff4d6d',
  gap: '#52e8ff',
  'missing-track': '#ffd166',
  'negative-start': '#b388ff',
  'negative-duration': '#ff8c42',
  'zero-duration': '#f72585',
  'non-finite': '#ffffff',
} as const;

function normalizeFaultlineTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000) / 1_000;
}

function expectedFaultlineEntries(timeline: ProbeTimeline): Array<Record<string, unknown>> {
  const tracks = timeline.tracks ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const clips = (timeline.clips ?? [])
    .filter((clip) => nonEmpty(clip.id))
    .map((clip) => ({ ...clip, duration: snapshotDuration(clip) }))
    .sort((left, right) => (
      String(left.track ?? '').localeCompare(String(right.track ?? ''))
      || (finite(left.at) ? left.at : 0) - (finite(right.at) ? right.at : 0)
      || left.id!.localeCompare(right.id!)
    ))
    .slice(0, 1_024);
  const expected: Array<Record<string, unknown>> = [];
  const add = (
    sourceClipId: string,
    kind: keyof typeof FAULTLINE_COLORS,
    structuralTime: number,
    severity: 'warning' | 'error',
    findingLabel: string,
    relatedClipId?: string,
  ): void => {
    expected.push({
      id: `fault-${kind}-${sourceClipId}${relatedClipId ? `-${relatedClipId}` : ''}`,
      sourceClipId,
      ...(relatedClipId ? { relatedClipId } : {}),
      kind,
      severity,
      time: normalizeFaultlineTime(structuralTime),
      label: findingLabel,
      color: FAULTLINE_COLORS[kind],
    });
  };

  for (const clip of clips) {
    const start = finite(clip.at) ? clip.at : 0;
    if (!finite(clip.at) || !finite(clip.duration)) {
      add(clip.id!, 'non-finite', start, 'error', 'non-finite clip timing');
    }
    if (finite(clip.at) && clip.at < 0) {
      add(clip.id!, 'negative-start', 0, 'error', 'clip starts before timeline zero');
    }
    if (finite(clip.duration) && clip.duration < 0) {
      add(clip.id!, 'negative-duration', start, 'error', 'clip has negative duration');
    } else if (clip.duration === 0) {
      add(clip.id!, 'zero-duration', start, 'warning', 'zero-duration clip');
    }
    if (!trackIds.has(clip.track)) {
      add(clip.id!, 'missing-track', start, 'error', `clip references missing track ${clip.track}`);
    }
  }

  const primary = tracks.find((track) => track.kind === 'visual' && track.muted === false);
  const continuity = primary
    ? clips.filter((clip) => clip.track === primary.id
      && finite(clip.at) && clip.at >= 0
      && finite(clip.duration) && clip.duration > 0)
    : [];
  let previous: ProbeClip | undefined;
  let previousEnd = 0;
  for (const clip of continuity.sort((left, right) => (
    (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
  ))) {
    const end = clip.at! + clip.duration!;
    if (previous) {
      if (clip.at! < previousEnd) {
        add(clip.id!, 'overlap', clip.at!, 'warning', `overlaps ${previous.id}`, previous.id);
      } else if (clip.at! > previousEnd) {
        add(clip.id!, 'gap', previousEnd, 'warning', `gap before ${clip.id}`, previous.id);
      }
    }
    if (end > previousEnd) {
      previousEnd = end;
      previous = clip;
    }
  }

  return expected
    .sort((left, right) => (
      (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1)
      || (left.time as number) - (right.time as number)
      || (left.id as string).localeCompare(right.id as string)
    ))
    .slice(0, 256)
    .sort((left, right) => (
      (left.time as number) - (right.time as number)
      || (left.id as string).localeCompare(right.id as string)
    ));
}

function validateFaultline(value: unknown, timeline: ProbeTimeline): ValidationResult {
  const expected = expectedFaultlineEntries(timeline);
  const shape = envelope(value, 1, {
    id,
    sourceClipId,
    relatedClipId: (entry) => entry.relatedClipId === undefined || nonEmpty(entry.relatedClipId),
    kind: (entry) => Object.prototype.hasOwnProperty.call(FAULTLINE_COLORS, String(entry.kind)),
    severity: (entry) => entry.severity === 'warning' || entry.severity === 'error',
    time,
    label,
    color: (entry) => nonEmpty(entry.color),
  }, timeline, expected.length);
  if (!shape.valid || !record(value) || !Array.isArray(value.entries)) return shape;
  return canonicalFingerprint(value.entries) === canonicalFingerprint(expected)
    ? shape
    : invalid('faultline entries do not match the current timeline');
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
  switch (extensionId) {
    case 'com.reigh.scene-phase-markers': {
      const result = entries(value, { id, time: (entry) => bounded(entry.time, 0, 9999.999) });
      if (!result.valid) return result;
      return result.count > 0 ? valid(value, result.count) : invalid('scene marker command produced no marker');
    }
    case 'com.reigh.creative-lab.pulse-map':
      return validatePulseMap(value, timeline);
    case 'com.reigh.creative-lab.soundtrack-cartographer':
      return envelope(value, 1, { id, sourceClipId, edge: (e) => e.edge === 'start' || e.edge === 'release', kind: (e) => e.kind === 'rise' || e.kind === 'peak' || e.kind === 'release', time, offset, intensity, color: (e) => nonEmpty(e.color), label }, timeline, expectedTerrainBoundaryCount(timeline));
    case 'com.reigh.creative-lab.caption-safe-zone-orchestra':
      return arrayOutput(value, { id, sourceClipId, relatedClipId: (e) => e.relatedClipId === undefined || nonEmpty(e.relatedClipId), kind: (e) => ['negative-start', 'too-brief', 'non-visual-track', 'overlap'].includes(String(e.kind)), severity: (e) => e.severity === 'warning' || e.severity === 'error', time, label, color: (e) => nonEmpty(e.color) }, 0);
    case 'com.reigh.creative-lab.emotional-weather-map':
      return arrayOutput(value, { id, sourceClipId, kind: (e) => ['breeze', 'fog', 'lightning', 'sunshine'].includes(String(e.kind)), time, intensity, color: (e) => nonEmpty(e.color), label }, Math.min(128, expectedVisualClips(timeline).length));
    case 'com.reigh.creative-lab.timeline-faultline':
      return validateFaultline(value, timeline);
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
