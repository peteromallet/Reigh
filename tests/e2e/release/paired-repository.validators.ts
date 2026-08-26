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
  asset?: string;
  source_uuid?: string;
  generation?: Record<string, unknown>;
};

export type ProbeTrack = { id?: string; kind?: string; label?: string; muted?: boolean };

export type ProbeTimeline = {
  clips?: ProbeClip[];
  tracks?: ProbeTrack[];
  assetKeys?: string[];
  knownExtensionIds?: string[];
};

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

function hostCanonical(value: unknown, seen: Set<unknown>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) throw new TypeError('release host fingerprint received circular input');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => hostCanonical(entry, seen));
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const entry = (value as Record<string, unknown>)[key];
        return entry === undefined || typeof entry === 'function' || typeof entry === 'symbol'
          ? []
          : [[key, hostCanonical(entry, seen)]];
      }));
  } finally {
    seen.delete(value);
  }
}

/** Independent implementation of the public reigh-fnv1a64-v1 contract. */
export function releaseHostFingerprint(value: unknown): string {
  const serialized = JSON.stringify(hostCanonical(value, new Set()));
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(serialized)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `reigh-fnv1a64-v1:${hash.toString(16).padStart(16, '0')}`;
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

  // Persisted timeline JSON omits default-false booleans, while the host
  // snapshot given to extensions materializes `muted: false`.  Treat only an
  // explicit true as muted so the release oracle validates the same semantic
  // timeline the extension actually observed.
  const primary = tracks.find((track) => track.kind === 'visual' && track.muted !== true);
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

function normalizeStructuralTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000) / 1_000;
}

function expectedFoleyEntries(timeline: ProbeTimeline): Array<Record<string, unknown>> {
  const primary = (timeline.tracks ?? [])
    .find((track) => track.kind === 'visual' && track.muted !== true);
  if (!primary) return [];
  const clips = snapshotClips(timeline)
    .filter((clip) => clip.track === primary.id
      && nonEmpty(clip.id)
      && finite(clip.at) && clip.at >= 0
      && finite(clip.duration) && clip.duration >= 0)
    .sort((left, right) => (
      (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
    ))
    .slice(0, 64);
  const cues: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const add = (clip: ProbeClip, boundary: 'start' | 'end', structuralTime: number): void => {
    const cueId = `foley-${clip.id}-${boundary}`;
    if (seen.has(cueId) || cues.length >= 128) return;
    seen.add(cueId);
    const durationWeight = Math.min(Math.max(0, clip.duration ?? 0) / 5, 1);
    cues.push({
      id: cueId,
      sourceClipId: clip.id,
      boundary,
      category: 'unassigned',
      time: normalizeStructuralTime(structuralTime),
      offset: 0,
      pan: 0,
      distance: 0.5,
      intensity: Math.round((0.25 + durationWeight * 0.5) * 1_000) / 1_000,
      label: `Unassigned Foley cue · ${clip.id} · ${boundary}`,
    });
  };
  for (const clip of clips) {
    const start = Math.max(0, clip.at ?? 0);
    add(clip, 'start', start);
    if ((clip.duration ?? 0) > 0) add(clip, 'end', start + clip.duration!);
  }
  return cues.sort((left, right) => (
    (left.time as number) - (right.time as number)
    || (left.id as string).localeCompare(right.id as string)
  ));
}

function validateFoley(value: unknown, timeline: ProbeTimeline): ValidationResult {
  const expected = expectedFoleyEntries(timeline);
  const shape = envelope(value, 1, {
    id,
    sourceClipId: (entry) => entry.sourceClipId === null || nonEmpty(entry.sourceClipId),
    boundary: (entry) => entry.boundary === 'start'
      || entry.boundary === 'end' || entry.boundary === 'playhead',
    time,
    category: (entry) => nonEmpty(entry.category),
    offset,
    pan: (entry) => bounded(entry.pan, -1, 1),
    distance: (entry) => bounded(entry.distance, 0, 1),
    intensity,
    label,
  }, timeline, expected.length);
  if (!shape.valid || !record(value) || !Array.isArray(value.entries)) return shape;
  return canonicalFingerprint(value.entries) === canonicalFingerprint(expected)
    ? shape
    : invalid('foley entries do not match the current timeline');
}

function expectedClipLinkEntries(timeline: ProbeTimeline): Array<Record<string, unknown>> {
  const primary = (timeline.tracks ?? [])
    .find((track) => track.kind === 'visual' && track.muted !== true);
  if (!primary) return [];
  const clips = snapshotClips(timeline)
    .filter((clip) => clip.track === primary.id
      && nonEmpty(clip.id)
      && finite(clip.at) && clip.at >= 0
      && finite(clip.duration) && clip.duration > 0)
    .sort((left, right) => (
      (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
    ));
  return clips.slice(0, -1).map((source, index) => {
    const target = clips[index + 1]!;
    return {
      id: `clip-link-${source.id}-to-${target.id}`,
      sourceClipId: source.id,
      targetClipId: target.id,
      trackId: source.track,
      time: normalizeStructuralTime((source.at ?? 0) + (source.duration ?? 0)),
      offset: 0,
      label: `Link ${source.id} → ${target.id}`,
    };
  });
}

function validateClipLinks(value: unknown, timeline: ProbeTimeline): ValidationResult {
  const expected = expectedClipLinkEntries(timeline);
  const shape = envelope(value, 1, {
    id,
    sourceClipId,
    targetClipId: (entry) => nonEmpty(entry.targetClipId),
    trackId: (entry) => nonEmpty(entry.trackId),
    time,
    offset,
    label,
  }, timeline, expected.length);
  if (!shape.valid || !record(value) || !Array.isArray(value.entries)) return shape;
  return canonicalFingerprint(value.entries) === canonicalFingerprint(expected)
    ? shape
    : invalid('clip-link entries do not match the current timeline');
}

const CHROMATIC_COLORS = {
  compact: '#ff5c8a',
  sustained: '#ffc857',
  steady: '#52e8d4',
  open: '#8f7cff',
} as const;

function chromaticMethodLabel(pacingClass: keyof typeof CHROMATIC_COLORS): string {
  switch (pacingClass) {
    case 'compact': return 'compact pacing (duration ≤ 0.75s)';
    case 'sustained': return 'sustained pacing (duration ≥ 4s)';
    case 'open': return 'open pacing (gap ≥ 2s)';
    default: return 'steady pacing (structural fallback)';
  }
}

function expectedChromaticOutput(timeline: ProbeTimeline): {
  coverage: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
} {
  const trackOrder = (timeline.tracks ?? [])
    .findIndex((track) => track.kind === 'visual' && track.muted !== true);
  const primary = trackOrder >= 0 ? timeline.tracks?.[trackOrder] : undefined;
  const trackLabel = primary?.label;
  const clips = primary ? snapshotClips(timeline)
    .filter((clip) => clip.track === primary.id
      && nonEmpty(clip.id)
      && finite(clip.at) && clip.at >= 0
      && finite(clip.duration) && clip.duration >= 0)
    .sort((left, right) => (
      (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
    )) : [];
  let previousEnd = 0;
  const entries = clips.map((clip) => {
    const start = Math.max(0, clip.at ?? 0);
    const duration = Math.max(0, clip.duration ?? 0);
    const gap = Math.max(0, start - previousEnd);
    const pacingClass: keyof typeof CHROMATIC_COLORS = gap >= 2
      ? 'open'
      : duration >= 4
        ? 'sustained'
        : duration <= 0.75
          ? 'compact'
          : 'steady';
    const rawIntensity = pacingClass === 'open'
      ? 0.35 + Math.min(gap / 6, 0.65)
      : pacingClass === 'sustained'
        ? 0.35 + Math.min(duration / 12, 0.65)
        : pacingClass === 'compact'
          ? 0.35 + Math.min(1 / Math.max(duration, 0.25), 0.65)
          : 0.5;
    previousEnd = Math.max(previousEnd, start + duration);
    return {
      id: `constellation-${clip.id}`,
      sourceClipId: clip.id,
      trackId: primary!.id,
      trackLabel,
      trackOrder,
      pacingClass,
      time: normalizeStructuralTime(start),
      duration: normalizeStructuralTime(duration),
      intensity: Math.round(Math.min(Math.max(rawIntensity, 0), 1) * 1_000) / 1_000,
      color: CHROMATIC_COLORS[pacingClass],
      label: `Pacing ${pacingClass} · ${trackLabel} · ${chromaticMethodLabel(pacingClass)}`,
    };
  }).sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  const displayedCount = Math.min(entries.length, 128);
  return {
    coverage: {
      totalCandidates: entries.length,
      persistedCount: entries.length,
      displayLimit: 128,
      displayedCount,
      omittedCount: Math.max(0, entries.length - displayedCount),
      sourceTrackId: entries[0]?.trackId ?? null,
      sourceTrackLabel: entries[0]?.trackLabel ?? null,
      status: entries.length > 128 ? 'truncated' : 'complete',
    },
    entries,
  };
}

function validateChromatic(value: unknown, timeline: ProbeTimeline): ValidationResult {
  if (!record(value)) return invalid('expected a chromatic envelope object');
  if (value.schemaVersion !== 1) return invalid('schemaVersion must be 1');
  if (!finite(value.generatedFromVersion) || value.generatedFromVersion < 0) {
    return invalid('generatedFromVersion must be non-negative');
  }
  if (!record(value.coverage) || !Array.isArray(value.entries)) {
    return invalid('chromatic envelope requires coverage and entries');
  }
  const expected = expectedChromaticOutput(timeline);
  const actualShape = entries(value.entries, {
    id,
    sourceClipId,
    trackId: (entry) => nonEmpty(entry.trackId),
    trackLabel: (entry) => nonEmpty(entry.trackLabel),
    trackOrder: (entry) => integer(entry.trackOrder) && bounded(entry.trackOrder, 0),
    pacingClass: (entry) => Object.prototype.hasOwnProperty.call(CHROMATIC_COLORS, String(entry.pacingClass)),
    time,
    duration: (entry) => bounded(entry.duration, 0),
    intensity,
    color: (entry) => nonEmpty(entry.color),
    label,
  });
  if (!actualShape.valid) return actualShape;
  return canonicalFingerprint({ coverage: value.coverage, entries: value.entries })
    === canonicalFingerprint(expected)
    ? valid(value, value.entries.length)
    : invalid('chromatic output does not match the current timeline');
}

const RECALL_COLORS = {
  concept: '#52e8ff',
  example: '#ffd166',
  recap: '#b388ff',
  retrieval: '#ff4d8d',
} as const;

const RECALL_QUESTIONS = {
  concept: 'What is the central idea introduced at this point?',
  example: 'What concrete example should a learner be able to recall here?',
  recap: 'What should be recapped before moving beyond this point?',
  retrieval: 'What question could test retrieval of the material here?',
} as const;

function expectedRecallOutput(timeline: ProbeTimeline): {
  sourceSignature: string;
  suggestions: Array<Record<string, unknown>>;
} {
  const trackIndex = (timeline.tracks ?? [])
    .findIndex((track) => track.kind === 'visual' && track.muted !== true);
  const primary = trackIndex >= 0 ? timeline.tracks?.[trackIndex] : undefined;
  const clips = primary ? snapshotClips(timeline)
    .filter((clip) => clip.track === primary.id
      && nonEmpty(clip.id)
      && finite(clip.at) && clip.at >= 0
      && finite(clip.duration) && clip.duration > 0)
    .sort((left, right) => (
      (left.at ?? 0) - (right.at ?? 0) || left.id!.localeCompare(right.id!)
    )) : [];
  const sourceSignature = releaseHostFingerprint(primary ? {
    sourceContract: 'recall-pulse/v3',
    primaryTrack: {
      id: primary.id,
      index: trackIndex,
      kind: primary.kind,
      muted: primary.muted ?? false,
    },
    clips: clips.map((clip) => ({
      id: clip.id,
      track: clip.track,
      at: clip.at,
      duration: clip.duration,
      clipType: clip.clipType ?? null,
    })),
  } : { sourceContract: 'recall-pulse/v3', primaryTrack: null, clips: [] });
  const lastIndex = clips.length - 1;
  const suggestions = clips.map((clip, index) => {
    const duration = clip.duration!;
    const category: keyof typeof RECALL_COLORS = index === 0
      ? 'concept'
      : index === lastIndex
        ? 'recap'
        : duration <= 1.5 || index % 3 === 1
          ? 'example'
          : 'retrieval';
    const prompt = RECALL_QUESTIONS[category];
    const rawIntensity = category === 'concept'
      ? 0.8
      : category === 'recap'
        ? 0.65
        : category === 'retrieval'
          ? 0.9
          : 0.45 + Math.min(duration / 8, 0.45);
    return {
      id: `recall-suggestion-${clip.id}`,
      sourceClipId: clip.id,
      checkpointId: `recall-checkpoint-${clip.id}`,
      trackId: primary!.id,
      category,
      assignment: 'unassigned',
      time: normalizeStructuralTime(clip.at!),
      duration: normalizeStructuralTime(duration),
      intensity: Math.round(Math.min(Math.max(rawIntensity, 0), 1) * 1_000) / 1_000,
      prompt,
      label: `Unassigned review question · ${prompt}`,
      color: RECALL_COLORS[category],
      heuristic: `ordered-clip:${category}; duration-proxy:${duration.toFixed(3)}s`,
      method: 'timeline-structure:v2; first-unmuted-visual-track; no semantic/audio analysis',
    };
  }).sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  return { sourceSignature, suggestions };
}

function validateRecall(value: unknown, timeline: ProbeTimeline): ValidationResult {
  if (!record(value)) return invalid('expected a recall envelope object');
  if (value.schemaVersion !== 3) return invalid('schemaVersion must be 3');
  if (!finite(value.generatedFromVersion) || value.generatedFromVersion < 0) {
    return invalid('generatedFromVersion must be non-negative');
  }
  if (value.stale !== false || !nonEmpty(value.sourceSignature) || !Array.isArray(value.suggestions)) {
    return invalid('invalid recall source provenance or suggestions');
  }
  const shape = entries(value.suggestions, {
    id,
    sourceClipId,
    checkpointId: (entry) => nonEmpty(entry.checkpointId),
    trackId: (entry) => nonEmpty(entry.trackId),
    category: (entry) => Object.prototype.hasOwnProperty.call(RECALL_COLORS, String(entry.category)),
    assignment: (entry) => entry.assignment === 'unassigned',
    time,
    duration: (entry) => bounded(entry.duration, 0),
    intensity,
    prompt: (entry) => nonEmpty(entry.prompt),
    label,
    color: (entry) => nonEmpty(entry.color),
    heuristic: (entry) => nonEmpty(entry.heuristic),
    method: (entry) => nonEmpty(entry.method),
  });
  if (!shape.valid) return shape;
  const expected = expectedRecallOutput(timeline);
  if (value.sourceSignature !== expected.sourceSignature) {
    return invalid(`recall source signature mismatch: expected ${expected.sourceSignature}, got ${String(value.sourceSignature)}`);
  }
  if (value.suggestions.length !== expected.suggestions.length) {
    return invalid(`expected ${expected.suggestions.length} recall suggestions, got ${value.suggestions.length}`);
  }
  const actualFingerprint = canonicalFingerprint(value.suggestions);
  const expectedFingerprint = canonicalFingerprint(expected.suggestions);
  const mismatchIndex = value.suggestions.findIndex((entry, index) => (
    canonicalFingerprint(entry) !== canonicalFingerprint(expected.suggestions[index])
  ));
  return actualFingerprint === expectedFingerprint
    ? valid(value, value.suggestions.length)
    : invalid(`recall suggestions do not match the current timeline at index ${mismatchIndex}: expectedFingerprint=${expectedFingerprint}; actualFingerprint=${actualFingerprint}`);
}

const LOCKLINE_COLORS = {
  'missing-registry-asset-key': '#ff8c42',
  'material-ref-clip-mismatch': '#b388ff',
  'source-ref-clip-mismatch': '#52e8ff',
} as const;

const LOCKLINE_SEVERITIES = {
  'missing-registry-asset-key': 'error',
  'material-ref-clip-mismatch': 'warning',
  'source-ref-clip-mismatch': 'warning',
} as const;

type LocklineKind = keyof typeof LOCKLINE_COLORS;

function objectString(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

function probeMaterialRefs(clip: ProbeClip): Array<{ id: string; clipId: string; assetKey?: string }> {
  const result: Array<{ id: string; clipId: string; assetKey?: string }> = [];
  if (nonEmpty(clip.asset) && nonEmpty(clip.id)) {
    result.push({ id: `material.asset.${clip.asset}.${clip.id}`, clipId: clip.id, assetKey: clip.asset });
  }
  if (record(clip.generation) && nonEmpty(clip.id)) {
    result.push({ id: `material.generation.${clip.id}`, clipId: clip.id });
  }
  return result;
}

function probeSourceRefs(clip: ProbeClip, knownExtensionIds: ReadonlySet<string>): Array<{
  id: string;
  clipId: string;
  sourceKind: string;
  sourceUuid?: string;
  generationId?: string;
  extensionId?: string;
}> {
  const result: Array<{
    id: string;
    clipId: string;
    sourceKind: string;
    sourceUuid?: string;
    generationId?: string;
    extensionId?: string;
  }> = [];
  if (nonEmpty(clip.source_uuid) && nonEmpty(clip.id)) {
    const extensionOwned = knownExtensionIds.has(clip.source_uuid);
    result.push({
      id: `source.${clip.source_uuid}.${clip.id}`,
      clipId: clip.id,
      sourceKind: extensionOwned ? 'extension' : 'unknown',
      sourceUuid: clip.source_uuid,
      ...(extensionOwned ? { extensionId: clip.source_uuid } : {}),
    });
  }
  if (record(clip.generation) && nonEmpty(clip.id)) {
    const generationId = objectString(clip.generation, ['id', 'generationId', 'uuid']);
    const extensionId = objectString(clip.generation, ['extensionId', 'providerId']);
    result.push({
      id: `source.generation.${generationId ?? clip.id}`,
      clipId: clip.id,
      sourceKind: extensionId ? 'extension' : 'generation',
      ...(generationId ? { generationId } : {}),
      ...(extensionId ? { extensionId } : {}),
    });
  }
  return result;
}

function uniqueLockline(values: string[]): string[] {
  return [...new Set(values)].sort().slice(0, 32);
}

function locklineSummary(values: string[]): string {
  return values.length <= 3 ? values.join(', ') : `${values.slice(0, 3).join(', ')} +${values.length - 3} more`;
}

function expectedLocklineOutput(timeline: ProbeTimeline): {
  sourceSignature: string;
  coverage: Record<string, unknown>;
  entries: Array<Record<string, unknown>>;
} {
  const knownExtensionIds = new Set(Array.isArray(timeline.knownExtensionIds)
    ? timeline.knownExtensionIds.filter(nonEmpty)
    : []);
  const clips = (timeline.clips ?? []).map((clip) => ({
    ...clip,
    duration: snapshotDuration(clip),
    materialRefs: probeMaterialRefs(clip),
    sourceRefs: probeSourceRefs(clip, knownExtensionIds),
  }));
  const trackIds = new Set((timeline.tracks ?? []).flatMap((track) => nonEmpty(track.id) ? [track.id] : []));
  const assetKeys = new Set(timeline.assetKeys ?? []);
  const ordered = clips.slice().sort((left, right) => {
    const at = (finite(left.at) ? left.at : 0) - (finite(right.at) ? right.at : 0);
    if (at !== 0) return at;
    const track = String(left.track ?? '').localeCompare(String(right.track ?? ''));
    return track !== 0 ? track : String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
  const scanned = ordered.slice(0, 512);
  const candidates: Array<Record<string, unknown>> = [];
  let eligibleClips = 0;
  let skippedInvalidClips = 0;
  const add = (
    clip: typeof clips[number],
    kind: LocklineKind,
    referenceIds: string[],
    findingLabel: string,
    missingAssetKeys?: string[],
  ): void => {
    candidates.push({
      id: `lockline-${kind}-${clip.id}`,
      sourceClipId: clip.id,
      trackId: clip.track,
      kind,
      severity: LOCKLINE_SEVERITIES[kind],
      time: normalizeStructuralTime(finite(clip.at) ? clip.at : 0),
      label: findingLabel,
      color: LOCKLINE_COLORS[kind],
      referenceIds: uniqueLockline(referenceIds),
      ...(missingAssetKeys ? { assetKeys: uniqueLockline(missingAssetKeys) } : {}),
    });
  };
  for (const clip of scanned) {
    const validClip = nonEmpty(clip.id) && nonEmpty(clip.track)
      && finite(clip.at) && finite(clip.duration)
      && clip.at >= 0 && clip.duration > 0 && trackIds.has(clip.track);
    if (!validClip) {
      skippedInvalidClips += 1;
      continue;
    }
    eligibleClips += 1;
    const missing = clip.materialRefs.filter((entry) => (
      nonEmpty(entry.assetKey) && !assetKeys.has(entry.assetKey)
    ));
    if (missing.length > 0) {
      const keys = uniqueLockline(missing.flatMap((entry) => entry.assetKey ? [entry.assetKey] : []));
      const refs = uniqueLockline(missing.map((entry) => entry.id));
      add(clip, 'missing-registry-asset-key', refs,
        `error · clip ${clip.id} · missing registry asset key: ${locklineSummary(keys)} · refs: ${locklineSummary(refs)}`,
        keys);
    }
    const wrongMaterials = clip.materialRefs.filter((entry) => entry.clipId !== clip.id);
    if (wrongMaterials.length > 0) {
      const refs = uniqueLockline(wrongMaterials.map((entry) => entry.id));
      add(clip, 'material-ref-clip-mismatch', refs,
        `warning · clip ${clip.id} · material refs identify another clip: ${locklineSummary(refs)}`);
    }
    const wrongSources = clip.sourceRefs.filter((entry) => entry.clipId !== clip.id);
    if (wrongSources.length > 0) {
      const refs = uniqueLockline(wrongSources.map((entry) => entry.id));
      add(clip, 'source-ref-clip-mismatch', refs,
        `warning · clip ${clip.id} · source refs identify another clip: ${locklineSummary(refs)}`);
    }
  }
  const findings = candidates.slice().sort((left, right) => {
    const severity = (left.severity === 'error' ? 0 : 1) - (right.severity === 'error' ? 0 : 1);
    if (severity !== 0) return severity;
    const kind = String(left.kind).localeCompare(String(right.kind));
    return kind !== 0
      ? kind
      : (left.time as number) - (right.time as number)
        || String(left.id).localeCompare(String(right.id));
  }).slice(0, 256).sort((left, right) => (
    (left.time as number) - (right.time as number)
    || String(left.id).localeCompare(String(right.id))
  ));
  const signatureClips = clips.slice().sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((clip) => ({
      id: clip.id,
      track: clip.track,
      at: String(clip.at),
      duration: String(clip.duration),
      materialRefs: clip.materialRefs.map((entry) => [entry.id, entry.clipId, entry.assetKey ?? ''])
        .sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000'))),
      sourceRefs: clip.sourceRefs.map((entry) => [
        entry.id,
        entry.clipId,
        entry.sourceKind,
        entry.sourceUuid ?? '',
        entry.generationId ?? '',
        entry.extensionId ?? '',
      ]).sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000'))),
    }));
  return {
    sourceSignature: releaseHostFingerprint({
      sourceContract: 'lockline-inspector/v2',
      assetKeys: [...assetKeys].sort(),
      trackIds: [...trackIds].sort(),
      clips: signatureClips,
    }),
    coverage: {
      totalClips: clips.length,
      scannedClips: scanned.length,
      eligibleClips,
      skippedInvalidClips,
      candidateFindings: candidates.length,
      persistedFindings: findings.length,
      omittedFindings: Math.max(0, candidates.length - findings.length),
      omittedClips: Math.max(0, clips.length - scanned.length),
    },
    entries: findings,
  };
}

function validateLockline(value: unknown, timeline: ProbeTimeline): ValidationResult {
  if (!record(value)) return invalid('expected a Lockline envelope object');
  if (value.schemaVersion !== 2) return invalid('schemaVersion must be 2');
  if (!finite(value.generatedFromVersion) || value.generatedFromVersion < 0) {
    return invalid('generatedFromVersion must be non-negative');
  }
  if (!nonEmpty(value.sourceSignature) || !record(value.coverage) || !Array.isArray(value.entries)) {
    return invalid('invalid Lockline source provenance, coverage, or entries');
  }
  const shape = entries(value.entries, {
    id,
    sourceClipId,
    trackId: (entry) => nonEmpty(entry.trackId),
    kind: (entry) => Object.prototype.hasOwnProperty.call(LOCKLINE_COLORS, String(entry.kind)),
    severity: (entry) => entry.severity === 'warning' || entry.severity === 'error',
    time,
    label,
    color: (entry) => nonEmpty(entry.color),
    referenceIds: (entry) => Array.isArray(entry.referenceIds) && entry.referenceIds.every(nonEmpty),
  });
  if (!shape.valid) return shape;
  const expected = expectedLocklineOutput(timeline);
  return value.sourceSignature === expected.sourceSignature
    && canonicalFingerprint({ coverage: value.coverage, entries: value.entries })
      === canonicalFingerprint({ coverage: expected.coverage, entries: expected.entries })
    ? valid(value, value.entries.length)
    : invalid('Lockline output does not match the current registry and timeline');
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
      return validateFoley(value, timeline);
    case 'com.reigh.creative-lab.branching-cut':
      return validateClipLinks(value, timeline);
    case 'com.reigh.creative-lab.chromatic-constellation': {
      return validateChromatic(value, timeline);
    }
    case 'com.reigh.creative-lab.recall-pulse': {
      return validateRecall(value, timeline);
    }
    case 'com.reigh.creative-lab.lockline-inspector': {
      return validateLockline(value, timeline);
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
