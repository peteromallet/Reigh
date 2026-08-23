/**
 * Structural Learning-Review Scaffold.
 *
 * This is deliberately an interrogative, unassigned review queue rather than
 * a comprehension or transcript feature. It derives one read-only question
 * per valid clip on the first unmuted visual editorial track. The heuristic is
 * explicit: clip order selects the question family, duration supplies a small
 * structural intensity proxy, and no audio, pixels, semantics, or unrelated
 * tracks are inspected.
 */

import { createElement } from 'react';
import { computeHostFingerprint, defineExtension } from '@reigh/editor-sdk';
import type {
  CommandRunContext,
  ContributionId,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelineClipSummary,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';

export const RECALL_PULSE_EXTENSION_ID =
  'com.reigh.creative-lab.recall-pulse' as ExtensionId;
export const BUILD_RECALL_PULSE_COMMAND =
  `${RECALL_PULSE_EXTENSION_ID}.buildRecallPulse`;
export const RECALL_PULSE_DATA_KEY = 'recallPulses';
export const RECALL_PULSE_OVERLAY_RENDER_ID = 'recall-pulse/timeline-overlay';
export const RECALL_PULSE_SCHEMA_VERSION = 3;

/** Compatibility exports: V2 intentionally has no scan or output cap. */
export const MAX_RECALL_PULSE_SCAN_CLIPS = Number.POSITIVE_INFINITY;
export const MAX_RECALL_PULSE_MARKERS = Number.POSITIVE_INFINITY;

const RECALL_PULSE_COLORS = {
  concept: '#52e8ff',
  example: '#ffd166',
  recap: '#b388ff',
  retrieval: '#ff4d8d',
} as const;

export type RecallPulseCategory = keyof typeof RECALL_PULSE_COLORS;

export interface RecallPulseMarker {
  /** Stable derived ID based only on the source clip, never on array order. */
  id: string;
  sourceClipId: string;
  /** Stable review checkpoint identity for future authored-review linkage. */
  checkpointId: string;
  trackId: string;
  category: RecallPulseCategory;
  assignment: 'unassigned';
  time: number;
  duration: number;
  intensity: number;
  prompt: string;
  label: string;
  color: string;
  heuristic: string;
  method: string;
}

export interface RecallPulseEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  /** Fingerprint of the public source facts used to derive suggestions. */
  sourceSignature: string;
  /** Persisted as false at build time; reads recompute the live signal. */
  stale: boolean;
  suggestions: RecallPulseMarker[];
}

export interface RecallPulseReadResult extends RecallPulseEnvelope {
  stale: boolean;
}

type RecallPulseAppSnapshot = Pick<TimelineSnapshot, 'app'>
  & Partial<Pick<TimelineSnapshot, 'baseVersion' | 'currentVersion'>>;

const QUESTION_BY_CATEGORY: Record<RecallPulseCategory, string> = {
  concept: 'What is the central idea introduced at this point?',
  example: 'What concrete example should a learner be able to recall here?',
  recap: 'What should be recapped before moving beyond this point?',
  retrieval: 'What question could test retrieval of the material here?',
};

function finite(value: number): boolean {
  return Number.isFinite(value);
}

/** Round valid seconds without imposing an arbitrary maximum timeline length. */
export function normalizeRecallPulseTime(time: number): number {
  if (!finite(time) || time < 0) return 0;
  return Math.round(time * 1000) / 1000;
}

function normalizeIntensity(value: number): number {
  if (!finite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), 1) * 1000) / 1000;
}

function primaryEditorialTrack(
  tracks: readonly TimelineTrackSummary[],
): TimelineTrackSummary | undefined {
  return tracks.find((track) => track.kind === 'visual' && track.muted === false);
}

function primaryEditorialTrackSelection(
  tracks: readonly TimelineTrackSummary[],
): { track: TimelineTrackSummary; index: number } | undefined {
  const index = tracks.findIndex((track) => track.kind === 'visual' && track.muted === false);
  return index < 0 ? undefined : { track: tracks[index], index };
}

function isValidEditorialClip(
  clip: TimelineClipSummary,
  trackId: string,
): boolean {
  return typeof clip.id === 'string'
    && clip.id.length > 0
    && clip.track === trackId
    && finite(clip.at)
    && finite(clip.duration)
    && clip.at >= 0
    && clip.duration > 0;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  return a.at - b.at || a.id.localeCompare(b.id);
}

function categoryForClip(
  index: number,
  lastIndex: number,
  durationSeconds: number,
): RecallPulseCategory {
  if (index === 0) return 'concept';
  if (index === lastIndex) return 'recap';
  if (durationSeconds <= 1.5 || index % 3 === 1) return 'example';
  return 'retrieval';
}

function markerIdFor(sourceClipId: string): string {
  return `recall-suggestion-${sourceClipId}`;
}

function checkpointIdFor(sourceClipId: string): string {
  return `recall-checkpoint-${sourceClipId}`;
}

function suggestionOrder(a: RecallPulseMarker, b: RecallPulseMarker): number {
  return a.time - b.time || a.id.localeCompare(b.id);
}

/** Fingerprint only the public source facts this scaffold actually reads. */
export function computeRecallPulseSourceSignature(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): string {
  const selection = primaryEditorialTrackSelection(snapshot.tracks);
  const source = selection ? {
    primaryTrack: {
      id: selection.track.id,
      index: selection.index,
      kind: selection.track.kind,
      muted: selection.track.muted,
    },
    clips: snapshot.clips
      .filter((clip) => isValidEditorialClip(clip, selection.track.id))
      .slice()
      .sort(clipOrder)
      .map((clip) => ({
        id: clip.id,
        track: clip.track,
        at: clip.at,
        duration: clip.duration,
        clipType: clip.clipType ?? null,
      })),
  } : { primaryTrack: null, clips: [] };
  return computeHostFingerprint({
    sourceContract: 'recall-pulse/v3',
    ...source,
  });
}

/**
 * Derive the complete structural review scope from the primary picture track.
 * Invalid, missing-track, muted, audio, auxiliary, and non-positive clips are
 * excluded rather than converted into fabricated questions.
 */
export function deriveRecallPulseMarkers(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): RecallPulseMarker[] {
  const primary = primaryEditorialTrack(snapshot.tracks);
  if (!primary) return [];

  const ordered = snapshot.clips
    .filter((clip) => isValidEditorialClip(clip, primary.id))
    .slice()
    .sort(clipOrder);
  const lastIndex = ordered.length - 1;

  return ordered.map((clip, index) => {
    const durationSeconds = clip.duration;
    const category = categoryForClip(index, lastIndex, durationSeconds);
    const prompt = QUESTION_BY_CATEGORY[category];
    const intensity = normalizeIntensity(
      category === 'concept'
        ? 0.8
        : category === 'recap'
          ? 0.65
          : category === 'retrieval'
            ? 0.9
            : 0.45 + Math.min(durationSeconds / 8, 0.45),
    );
    const sourceClipId = clip.id;
    const method = 'timeline-structure:v2; first-unmuted-visual-track; no semantic/audio analysis';
    return {
      id: markerIdFor(sourceClipId),
      sourceClipId,
      checkpointId: checkpointIdFor(sourceClipId),
      trackId: primary.id,
      category,
      assignment: 'unassigned',
      time: normalizeRecallPulseTime(clip.at),
      duration: normalizeRecallPulseTime(durationSeconds),
      intensity,
      prompt,
      label: `Unassigned review question · ${prompt}`,
      color: RECALL_PULSE_COLORS[category],
      heuristic: `ordered-clip:${category}; duration-proxy:${durationSeconds.toFixed(3)}s`,
      method,
    } satisfies RecallPulseMarker;
  });
}

function normalizeRecallPulseMarker(value: unknown): RecallPulseMarker | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const sourceClipId = typeof candidate.sourceClipId === 'string' && candidate.sourceClipId.length > 0
    ? candidate.sourceClipId
    : null;
  const category = candidate.category;
  if (!sourceClipId
    || (category !== 'concept' && category !== 'example' && category !== 'recap' && category !== 'retrieval')
    || typeof candidate.time !== 'number'
    || !finite(candidate.time)
    || candidate.time < 0
    || typeof candidate.duration !== 'number'
    || !finite(candidate.duration)
    || candidate.duration < 0) {
    return null;
  }
  const prompt = typeof candidate.prompt === 'string' && candidate.prompt.endsWith('?')
    ? candidate.prompt
    : QUESTION_BY_CATEGORY[category];
  return {
    id: markerIdFor(sourceClipId),
    sourceClipId,
    checkpointId: typeof candidate.checkpointId === 'string'
      ? candidate.checkpointId
      : checkpointIdFor(sourceClipId),
    trackId: typeof candidate.trackId === 'string' ? candidate.trackId : '',
    category,
    assignment: 'unassigned',
    time: normalizeRecallPulseTime(candidate.time),
    duration: normalizeRecallPulseTime(candidate.duration),
    intensity: normalizeIntensity(typeof candidate.intensity === 'number' ? candidate.intensity : 0),
    prompt,
    label: typeof candidate.label === 'string' ? candidate.label : `Unassigned review question · ${prompt}`,
    color: RECALL_PULSE_COLORS[category],
    heuristic: typeof candidate.heuristic === 'string'
      ? candidate.heuristic
      : 'legacy structural ordering heuristic',
    method: typeof candidate.method === 'string'
      ? candidate.method
      : 'timeline-structure:v2; first-unmuted-visual-track; no semantic/audio analysis',
  };
}

function readRawEnvelope(value: unknown): Omit<RecallPulseEnvelope, 'stale'> | null {
  const entries = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).suggestions)
      ? (value as Record<string, unknown>).suggestions
      : null;
  if (!entries) return null;
  const candidate = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const generatedFromVersion = typeof candidate.generatedFromVersion === 'number'
    && finite(candidate.generatedFromVersion)
    ? candidate.generatedFromVersion
    : 0;
  return {
    schemaVersion: typeof candidate.schemaVersion === 'number'
      ? candidate.schemaVersion
      : RECALL_PULSE_SCHEMA_VERSION,
    generatedFromVersion,
    sourceSignature: typeof candidate.sourceSignature === 'string'
      ? candidate.sourceSignature
      : '',
    suggestions: entries
      .map(normalizeRecallPulseMarker)
      .filter((marker): marker is RecallPulseMarker => marker !== null)
      .sort(suggestionOrder),
  };
}

/** Read the namespaced envelope and expose a live source-fact staleness signal. */
export function readRecallPulseEnvelope(
  snapshot: RecallPulseAppSnapshot,
  extensionId: string = RECALL_PULSE_EXTENSION_ID,
): RecallPulseReadResult {
  const app = snapshot.app[extensionId];
  const raw = app !== null && typeof app === 'object' && !Array.isArray(app)
    ? (app as Record<string, unknown>)[RECALL_PULSE_DATA_KEY]
    : undefined;
  const envelope = readRawEnvelope(raw) ?? {
    schemaVersion: RECALL_PULSE_SCHEMA_VERSION,
    generatedFromVersion: 0,
    sourceSignature: '',
    suggestions: [],
  };
  const currentVersion = snapshot.currentVersion ?? snapshot.baseVersion ?? envelope.generatedFromVersion;
  const currentSourceSignature = Array.isArray(snapshot.clips) && Array.isArray(snapshot.tracks)
    ? computeRecallPulseSourceSignature({ clips: snapshot.clips, tracks: snapshot.tracks })
    : '';
  const generatedFromFutureVersion = envelope.generatedFromVersion > currentVersion;
  const stale = generatedFromFutureVersion
    || envelope.sourceSignature.length === 0
    || envelope.sourceSignature !== currentSourceSignature;
  return {
    ...envelope,
    stale,
  };
}

/** Canonical sorted read; derived suggestions have no drag/write path. */
export function readRecallPulseMarkers(
  snapshot: RecallPulseAppSnapshot,
  extensionId: string = RECALL_PULSE_EXTENSION_ID,
): RecallPulseMarker[] {
  return readRecallPulseEnvelope(snapshot, extensionId).suggestions.slice().sort(suggestionOrder);
}

export function buildRecallPulsePatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>
    & Partial<Pick<TimelineSnapshot, 'clips' | 'tracks'>>,
  markers: readonly RecallPulseMarker[],
  options: { sourceSignature?: string } = {},
): TimelinePatch {
  const suggestions = markers.slice().sort(suggestionOrder);
  const generatedFromVersion = snapshot.baseVersion;
  const sourceSignature = options.sourceSignature
    ?? (snapshot.clips && snapshot.tracks
      ? computeRecallPulseSourceSignature({ clips: snapshot.clips, tracks: snapshot.tracks })
      : '');
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'recall-pulse-build',
      analysis: 'structural-learning-review-scaffold; interrogative-unassigned-read-only',
      generatedFromVersion,
      sourceSignature,
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: RECALL_PULSE_DATA_KEY,
        value: {
          schemaVersion: RECALL_PULSE_SCHEMA_VERSION,
          generatedFromVersion,
          sourceSignature,
          stale: false,
          suggestions,
        } satisfies RecallPulseEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function buildRecallPulse(ctx: ExtensionContext): void {
  const snapshot = ctx.creative.reader.snapshot();
  const markers = deriveRecallPulseMarkers(snapshot);
  if (markers.length === 0) {
    ctx.chrome.toast('Structural Learning Review needs a valid unmuted visual editorial track.', 'info');
    return;
  }
  ctx.creative.timeline.apply(
    buildRecallPulsePatch(ctx.extension.id as string, snapshot, markers, {
      sourceSignature: computeRecallPulseSourceSignature(snapshot),
    }),
  );
  ctx.chrome.toast(`Learning Review built: ${markers.length} unassigned questions.`, 'info');
}

function renderRecallPulseMarker(marker: { data?: RecallPulseMarker }): unknown {
  const item = marker.data;
  if (!item) return null;
  return createElement('span', {
    'data-recall-pulse-marker': item.id,
    'aria-label': `Unassigned review question: ${item.prompt}`,
    style: {
      display: 'inline-block',
      width: `${4 + item.intensity * 8}px`,
      height: `${8 + item.intensity * 12}px`,
      opacity: 0.45 + item.intensity * 0.55,
      backgroundColor: item.color,
      borderRadius: 2,
    },
  });
}

function renderRecallPulseOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const envelope = readRecallPulseEnvelope(
    ctx.creative.reader.snapshot(),
    ctx.extension.id as string,
  );
  const markers = clusterTimelineMarkers(envelope.suggestions, {
    getId: (marker) => marker.id,
    getTime: (marker) => marker.time,
    getLabel: (marker) => `${marker.assignment} · ${marker.prompt}${envelope.stale ? ' · stale' : ''}`,
    getColor: (marker) => marker.color,
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: false,
    snap: false,
    renderMarker: renderRecallPulseMarker,
  });
}

function disposeTogether(ctx: ExtensionContext, handles: readonly DisposeHandle[]): void {
  for (const handle of handles) {
    try {
      handle.dispose();
    } catch (error) {
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'recall-pulse/dispose-failed',
        message: `Structural Learning Review cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const recallPulseExtension: ReighExtension = defineExtension({
  manifest: {
    id: RECALL_PULSE_EXTENSION_ID,
    version: '2.1.0',
    label: 'Structural Learning-Review Scaffold',
    description:
      'Generates explicit unassigned interrogative review suggestions from the first unmuted visual editorial track; read-only and structure-only.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-recall-pulse' as ContributionId,
        kind: 'command',
        command: BUILD_RECALL_PULSE_COMMAND,
        label: 'Build Learning-Review Questions',
        category: 'Learning Review',
        order: 10,
      },
      {
        id: 'recall-pulse-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: RECALL_PULSE_OVERLAY_RENDER_ID,
        label: 'Learning Review (read-only timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Learning Review ready — build unassigned structural questions from the primary visual track.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const handles: DisposeHandle[] = [];
    try {
      handles.push(ctx.commands.registerCommand(
        BUILD_RECALL_PULSE_COMMAND,
        (_run: CommandRunContext): void => buildRecallPulse(ctx),
        { label: 'Build Learning-Review Questions', category: 'Learning Review' },
      ));
      handles.push(ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
        RECALL_PULSE_OVERLAY_RENDER_ID,
        (props) => renderRecallPulseOverlay(ctx, props),
      ));
      ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    } catch (error) {
      disposeTogether(ctx, handles);
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'recall-pulse/activation-failed',
        message: `Structural Learning Review activation was guarded: ${String(error)}`,
      });
      return { dispose: () => {} };
    }

    let disposed = false;
    return {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        disposeTogether(ctx, handles);
      },
    };
  },
});
