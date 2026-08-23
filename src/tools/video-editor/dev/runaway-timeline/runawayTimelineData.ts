import { useEffect, useMemo, useState } from 'react';
import type { SourceFrozenDataItem } from '@/tools/video-editor/data/typed/envelope.ts';
import { freezeSourceDataItem } from '@/tools/video-editor/data/typed/envelope.ts';

export const RUNAWAY_SCHEMA_REF = 'reigh.runaway_transition/v1';
export const RUNAWAY_KIND_ID = 'reigh.runaway.transitions';
export const RUNAWAY_PROJECT_PARAM = 'runawayTimelineProject';
export const DEFAULT_RUNAWAY_PROJECT = 'runaway-piano-colour-demo';
export const RUNAWAY_SOURCE_ARTIFACT_PREFIX = 'astrid:runaway-timing:';

export interface RunawayTimingSummary {
  readonly evidenceId: string;
  readonly runId: string;
  readonly summary: string;
  readonly frameCount?: number;
  readonly transitionCount?: number;
  readonly fps?: number;
  readonly segmentCounts: Readonly<Record<string, number>>;
  readonly createdAt?: string;
}

export interface RunawayTransitionPayload {
  readonly id: string;
  readonly manifestId: string;
  readonly ordinal: number;
  readonly runId: string;
  readonly taskId: string | null;
  readonly startMs: number;
  readonly durationMs: number;
  readonly prompt: string;
  readonly segmentId: string;
  readonly segmentLabel: string;
  readonly timingMode: string;
  readonly colourName: string;
  readonly colourHex: string;
  readonly frame: number;
  readonly fps: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly timingSummary: RunawayTimingSummary | null;
}

interface RawTransition {
  id: string;
  run_id: string;
  task_id: string | null;
  ordinal: number;
  start_ms: number;
  duration_ms: number;
  prompt: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface RawBridgeResponse {
  project: string;
  count: number;
  timing_summary?: {
    evidence_id?: string;
    run_id?: string;
    summary?: string;
    created_at?: string;
    data?: Record<string, unknown>;
  } | null;
  transitions: RawTransition[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function cssHexColour(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text && /^#[0-9a-f]{6}$/i.test(text) ? text : null;
}

function parseSummary(raw: RawBridgeResponse['timing_summary']): RunawayTimingSummary | null {
  if (!raw) return null;
  const data = asRecord(raw.data) ?? {};
  const rawCounts = asRecord(data.segment_counts) ?? {};
  const segmentCounts: Record<string, number> = {};
  for (const [segment, count] of Object.entries(rawCounts)) {
    const parsed = finiteNumber(count);
    if (parsed !== null && parsed >= 0) segmentCounts[segment] = parsed;
  }
  return Object.freeze({
    evidenceId: nonEmptyString(raw.evidence_id) ?? '',
    runId: nonEmptyString(raw.run_id) ?? '',
    summary: nonEmptyString(raw.summary) ?? 'Runaway timing migration',
    frameCount: finiteNumber(data.frame_count) ?? undefined,
    transitionCount: finiteNumber(data.transition_count) ?? undefined,
    fps: finiteNumber(data.fps) ?? undefined,
    segmentCounts: Object.freeze(segmentCounts),
    createdAt: nonEmptyString(raw.created_at) ?? undefined,
  });
}

export function parseRunawayBridgeResponse(value: unknown): readonly SourceFrozenDataItem[] {
  const root = asRecord(value);
  const project = nonEmptyString(root?.project);
  if (!root || !project || !Array.isArray(root.transitions)) {
    throw new Error('Runaway bridge response must contain transitions[]');
  }
  const summary = parseSummary(root.timing_summary as RawBridgeResponse['timing_summary']);
  const seenIds = new Set<string>();
  const seenManifestIds = new Set<string>();
  const items: SourceFrozenDataItem[] = [];
  for (const [index, candidate] of root.transitions.entries()) {
    const row = asRecord(candidate);
    const metadata = asRecord(row?.metadata);
    const id = nonEmptyString(row?.id);
    const runId = nonEmptyString(row?.run_id);
    const ordinal = finiteNumber(row?.ordinal);
    const startMs = finiteNumber(row?.start_ms);
    const durationMs = finiteNumber(row?.duration_ms);
    const prompt = nonEmptyString(row?.prompt);
    if (!row || !metadata || !id || !runId || ordinal === null || ordinal < 0
      || startMs === null || startMs < 0 || durationMs === null || durationMs <= 0 || !prompt) {
      throw new Error(`Invalid Runaway transition at index ${index}`);
    }
    const manifestId = nonEmptyString(metadata.manifest_id) ?? `T${String(ordinal + 1).padStart(4, '0')}`;
    if (seenIds.has(id)) throw new Error(`Duplicate Runaway transition id: ${id}`);
    if (seenManifestIds.has(manifestId)) throw new Error(`Duplicate Runaway manifest id: ${manifestId}`);
    seenIds.add(id);
    seenManifestIds.add(manifestId);
    const start = startMs / 1000;
    const end = (startMs + durationMs) / 1000;
    const payload: RunawayTransitionPayload = Object.freeze({
      id,
      manifestId,
      ordinal,
      runId,
      taskId: nonEmptyString(row.task_id),
      startMs,
      durationMs,
      prompt,
      segmentId: nonEmptyString(metadata.segment_id) ?? 'unassigned',
      segmentLabel: nonEmptyString(metadata.segment_label) ?? 'Unassigned region',
      timingMode: nonEmptyString(metadata.timing_mode) ?? 'unknown',
      colourName: nonEmptyString(metadata.colour_name) ?? 'unknown',
      colourHex: cssHexColour(metadata.colour_hex) ?? '#8b5cf6',
      frame: finiteNumber(metadata.frame) !== null && Number(metadata.frame) >= 0
        ? Number(metadata.frame)
        : Math.round(start * ((finiteNumber(metadata.fps) ?? summary?.fps ?? 48) || 48)),
      fps: finiteNumber(metadata.fps) !== null && Number(metadata.fps) > 0
        ? Number(metadata.fps)
        : (summary?.fps && summary.fps > 0 ? summary.fps : 48),
      metadata: Object.freeze({ ...metadata }),
      timingSummary: summary,
    });
    items.push(freezeSourceDataItem({
      id: manifestId,
      shape: 'interval',
      domain: 'timeline_seconds',
      extent: { start, end },
      schemaRef: RUNAWAY_SCHEMA_REF,
      payload,
      sourceArtifactRef: { assetId: `${RUNAWAY_SOURCE_ARTIFACT_PREFIX}${project}` },
      provenance: {
        adapterId: 'astrid.runaway.bridge',
        adapterVersion: '1',
        recordedAt: nonEmptyString(row.created_at) ?? undefined,
      },
    }));
  }
  items.sort((a, b) => (a.extent.start - b.extent.start) || a.id.localeCompare(b.id));
  const advertisedCount = finiteNumber(root.count);
  if (advertisedCount !== null && advertisedCount !== items.length) {
    throw new Error(`Runaway bridge count mismatch: advertised ${advertisedCount}, received ${items.length}`);
  }
  return Object.freeze(items);
}

const requestCache = new Map<string, Promise<readonly SourceFrozenDataItem[]>>();

export function loadRunawayTimeline(projectSlug: string): Promise<readonly SourceFrozenDataItem[]> {
  const cached = requestCache.get(projectSlug);
  if (cached) return cached;
  const request = fetch(`/api/astrid/projects/${encodeURIComponent(projectSlug)}/runaway-transitions`)
    .then(async (response) => {
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = asRecord(body);
        throw new Error(
          nonEmptyString(detail?.detail)
          ?? nonEmptyString(detail?.message)
          ?? nonEmptyString(detail?.error)
          ?? `Astrid bridge returned ${response.status}`,
        );
      }
      return parseRunawayBridgeResponse(body);
    })
    .catch((error) => {
      requestCache.delete(projectSlug);
      throw error;
    });
  requestCache.set(projectSlug, request);
  return request;
}

/**
 * Load the optional DEV bridge fixture only while the deployment-owned
 * Runaway gate is effective.  The URL parameter is an authoring selector, not
 * an enablement override: when the gate is false this hook performs zero
 * bridge IO even if a stale/bookmarked URL still contains the parameter.
 */
export function useRunawayTimelineItems(
  releaseEnabled: boolean,
): Readonly<Record<string, readonly SourceFrozenDataItem[]>> | undefined {
  const projectSlug = useMemo(() => {
    if (!releaseEnabled || !import.meta.env.DEV || typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (!params.has(RUNAWAY_PROJECT_PARAM)) return null;
    return params.get(RUNAWAY_PROJECT_PARAM)?.trim() || DEFAULT_RUNAWAY_PROJECT;
  }, [releaseEnabled]);
  const [items, setItems] = useState<readonly SourceFrozenDataItem[] | null>(null);

  useEffect(() => {
    if (!projectSlug) return;
    let active = true;
    void loadRunawayTimeline(projectSlug).then((next) => {
      if (active) setItems(next);
    }).catch((error: unknown) => {
      if (active) console.error('[Runaway Timeline Viewer]', error);
    });
    return () => { active = false; };
  }, [projectSlug]);

  return useMemo(() => items ? { [RUNAWAY_SCHEMA_REF]: items } : undefined, [items]);
}
