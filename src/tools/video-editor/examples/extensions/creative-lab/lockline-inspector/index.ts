/**
 * Lockline Inspector — a bounded registry and provenance preflight.
 *
 * V1 reports only inconsistencies that the public TimelineSnapshot can prove:
 * missing timeline-registry asset keys and material/source references attached
 * to the wrong clip. It does not infer continuity, media availability, pixels,
 * audio quality, source handles, or render quality.
 */

import { createElement } from 'react';
import { defineExtension } from '@reigh/editor-sdk';
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
  TimelinePointMarker,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';
import type { ClusteredTimelineMarkerData } from '../timelineMarkerClusters';

export const LOCKLINE_INSPECTOR_EXTENSION_ID =
  'com.reigh.creative-lab.lockline-inspector' as ExtensionId;
export const BUILD_LOCKLINE_REPORT_COMMAND =
  `${LOCKLINE_INSPECTOR_EXTENSION_ID}.buildReport`;
export const LOCKLINE_REPORT_DATA_KEY = 'locklineReport';
export const LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID = 'lockline-inspector/timeline-overlay';
export const LOCKLINE_REPORT_SCHEMA_VERSION = 1;
export const MAX_LOCKLINE_SCAN_CLIPS = 512;
export const MAX_LOCKLINE_FINDINGS = 256;
export const MAX_LOCKLINE_REFERENCES_PER_FINDING = 32;

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

export type LocklineFindingKind = keyof typeof LOCKLINE_COLORS;
export type LocklineSeverity = 'warning' | 'error';

export interface LocklineFinding {
  id: string;
  sourceClipId: string;
  trackId: string;
  kind: LocklineFindingKind;
  severity: LocklineSeverity;
  time: number;
  label: string;
  color: string;
  referenceIds: readonly string[];
  assetKeys?: readonly string[];
}

export interface LocklineCoverage {
  totalClips: number;
  scannedClips: number;
  eligibleClips: number;
  skippedInvalidClips: number;
  candidateFindings: number;
  persistedFindings: number;
  omittedFindings: number;
  omittedClips: number;
}

export interface LocklineAnalysis {
  sourceSignature: string;
  coverage: LocklineCoverage;
  entries: LocklineFinding[];
}

export interface LocklineEnvelope extends LocklineAnalysis {
  schemaVersion: number;
  generatedFromVersion: number;
}

interface LocklineMarkerData extends LocklineFinding {
  stale: boolean;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function normalizeLocklineTime(time: number): number {
  if (!finite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const at = (finite(a.at) ? a.at : 0) - (finite(b.at) ? b.at : 0);
  if (at !== 0) return at;
  const track = a.track.localeCompare(b.track);
  return track !== 0 ? track : a.id.localeCompare(b.id);
}

function uniqueBounded(values: readonly string[]): string[] {
  return [...new Set(values)].sort().slice(0, MAX_LOCKLINE_REFERENCES_PER_FINDING);
}

function summary(values: readonly string[]): string {
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} +${values.length - 3} more`;
}

function finding(
  clip: TimelineClipSummary,
  kind: LocklineFindingKind,
  referenceIds: readonly string[],
  label: string,
  assetKeys?: readonly string[],
): LocklineFinding {
  return {
    id: `lockline-${kind}-${clip.id}`,
    sourceClipId: clip.id,
    trackId: clip.track,
    kind,
    severity: LOCKLINE_SEVERITIES[kind],
    time: normalizeLocklineTime(clip.at),
    label,
    color: LOCKLINE_COLORS[kind],
    referenceIds: uniqueBounded(referenceIds),
    ...(assetKeys ? { assetKeys: uniqueBounded(assetKeys) } : {}),
  };
}

function findingOrder(a: LocklineFinding, b: LocklineFinding): number {
  const severity = (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1);
  if (severity !== 0) return severity;
  const kind = a.kind.localeCompare(b.kind);
  return kind !== 0 ? kind : a.time - b.time || a.id.localeCompare(b.id);
}

function timelineOrder(a: LocklineFinding, b: LocklineFinding): number {
  return a.time - b.time || a.id.localeCompare(b.id);
}

function hashSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Fingerprint only the public registry/provenance facts used by this report. */
export function buildLocklineSourceSignature(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks' | 'assetKeys'>,
): string {
  const clips = [...snapshot.clips]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((clip) => ({
      id: clip.id,
      track: clip.track,
      at: String(clip.at),
      duration: String(clip.duration),
      materialRefs: [...(clip.materialRefs ?? [])]
        .map((ref) => [ref.id, ref.clipId, ref.assetKey ?? ''])
        .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000'))),
      sourceRefs: [...(clip.sourceRefs ?? [])]
        .map((ref) => [
          ref.id,
          ref.clipId,
          ref.sourceKind,
          ref.sourceUuid ?? '',
          ref.generationId ?? '',
          ref.extensionId ?? '',
        ])
        .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000'))),
    }));
  return hashSignature(JSON.stringify({
    assetKeys: [...snapshot.assetKeys].sort(),
    trackIds: snapshot.tracks.map((track) => track.id).sort(),
    clips,
  }));
}

function validPreflightCandidate(clip: TimelineClipSummary, trackIds: ReadonlySet<string>): boolean {
  return finite(clip.at)
    && finite(clip.duration)
    && clip.at >= 0
    && clip.duration > 0
    && trackIds.has(clip.track);
}

/** Derive bounded, deterministic registry/provenance findings and coverage. */
export function deriveLocklineAnalysis(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks' | 'assetKeys'>,
): LocklineAnalysis {
  const trackIds = new Set(snapshot.tracks.map((track) => track.id));
  const assetKeys = new Set(snapshot.assetKeys);
  const ordered = [...snapshot.clips].sort(clipOrder);
  const scanned = ordered.slice(0, MAX_LOCKLINE_SCAN_CLIPS);
  const candidates: LocklineFinding[] = [];
  let eligibleClips = 0;
  let skippedInvalidClips = 0;

  for (const clip of scanned) {
    if (!validPreflightCandidate(clip, trackIds)) {
      skippedInvalidClips += 1;
      continue;
    }
    eligibleClips += 1;

    const missingAssetRefs = (clip.materialRefs ?? []).filter((ref) => (
      Boolean(ref.assetKey) && !assetKeys.has(ref.assetKey as string)
    ));
    if (missingAssetRefs.length > 0) {
      const missingKeys = uniqueBounded(
        missingAssetRefs.flatMap((ref) => ref.assetKey ? [ref.assetKey] : []),
      );
      const refIds = uniqueBounded(missingAssetRefs.map((ref) => ref.id));
      candidates.push(finding(
        clip,
        'missing-registry-asset-key',
        refIds,
        `error · clip ${clip.id} · missing registry asset key: ${summary(missingKeys)} · refs: ${summary(refIds)}`,
        missingKeys,
      ));
    }

    const mismatchedMaterialRefs = (clip.materialRefs ?? []).filter((ref) => ref.clipId !== clip.id);
    if (mismatchedMaterialRefs.length > 0) {
      const refIds = uniqueBounded(mismatchedMaterialRefs.map((ref) => ref.id));
      candidates.push(finding(
        clip,
        'material-ref-clip-mismatch',
        refIds,
        `warning · clip ${clip.id} · material refs identify another clip: ${summary(refIds)}`,
      ));
    }

    const mismatchedSourceRefs = (clip.sourceRefs ?? []).filter((ref) => ref.clipId !== clip.id);
    if (mismatchedSourceRefs.length > 0) {
      const refIds = uniqueBounded(mismatchedSourceRefs.map((ref) => ref.id));
      candidates.push(finding(
        clip,
        'source-ref-clip-mismatch',
        refIds,
        `warning · clip ${clip.id} · source refs identify another clip: ${summary(refIds)}`,
      ));
    }
  }

  const entries = candidates
    .slice()
    .sort(findingOrder)
    .slice(0, MAX_LOCKLINE_FINDINGS)
    .sort(timelineOrder);
  return {
    sourceSignature: buildLocklineSourceSignature(snapshot),
    coverage: {
      totalClips: snapshot.clips.length,
      scannedClips: scanned.length,
      eligibleClips,
      skippedInvalidClips,
      candidateFindings: candidates.length,
      persistedFindings: entries.length,
      omittedFindings: Math.max(0, candidates.length - entries.length),
      omittedClips: Math.max(0, snapshot.clips.length - scanned.length),
    },
    entries,
  };
}

export function deriveLocklineFindings(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks' | 'assetKeys'>,
): LocklineFinding[] {
  return deriveLocklineAnalysis(snapshot).entries;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isLocklineFinding(value: unknown): value is LocklineFinding {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind as LocklineFindingKind;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && typeof candidate.trackId === 'string'
    && typeof candidate.kind === 'string'
    && candidate.kind in LOCKLINE_COLORS
    && candidate.severity === LOCKLINE_SEVERITIES[kind]
    && typeof candidate.time === 'number'
    && finite(candidate.time)
    && candidate.time >= 0
    && typeof candidate.label === 'string'
    && candidate.color === LOCKLINE_COLORS[kind]
    && stringArray(candidate.referenceIds)
    && (candidate.assetKeys === undefined || stringArray(candidate.assetKeys));
}

function nonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readCoverage(value: unknown): LocklineCoverage {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    totalClips: nonNegativeCount(candidate.totalClips),
    scannedClips: nonNegativeCount(candidate.scannedClips),
    eligibleClips: nonNegativeCount(candidate.eligibleClips),
    skippedInvalidClips: nonNegativeCount(candidate.skippedInvalidClips),
    candidateFindings: nonNegativeCount(candidate.candidateFindings),
    persistedFindings: nonNegativeCount(candidate.persistedFindings),
    omittedFindings: nonNegativeCount(candidate.omittedFindings),
    omittedClips: nonNegativeCount(candidate.omittedClips),
  };
}

function emptyEnvelope(): LocklineEnvelope {
  return {
    schemaVersion: LOCKLINE_REPORT_SCHEMA_VERSION,
    generatedFromVersion: 0,
    sourceSignature: '',
    coverage: readCoverage(null),
    entries: [],
  };
}

export function readLocklineEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = LOCKLINE_INSPECTOR_EXTENSION_ID,
): LocklineEnvelope {
  const app = snapshot.app[extensionId];
  if (!app || typeof app !== 'object' || Array.isArray(app)) return emptyEnvelope();
  const raw = (app as Record<string, unknown>)[LOCKLINE_REPORT_DATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyEnvelope();
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.entries)) return emptyEnvelope();
  return {
    schemaVersion: nonNegativeCount(candidate.schemaVersion),
    generatedFromVersion: nonNegativeCount(candidate.generatedFromVersion),
    sourceSignature: typeof candidate.sourceSignature === 'string' ? candidate.sourceSignature : '',
    coverage: readCoverage(candidate.coverage),
    entries: candidate.entries
      .filter(isLocklineFinding)
      .slice(0, MAX_LOCKLINE_FINDINGS)
      .map((item) => ({
        ...item,
        time: normalizeLocklineTime(item.time),
        referenceIds: uniqueBounded(item.referenceIds),
        ...(item.assetKeys ? { assetKeys: uniqueBounded(item.assetKeys) } : {}),
      }))
      .sort(timelineOrder),
  };
}

export function readLocklineFindings(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = LOCKLINE_INSPECTOR_EXTENSION_ID,
): LocklineFinding[] {
  return readLocklineEnvelope(snapshot, extensionId).entries;
}

export function isLocklineReportStale(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks' | 'assetKeys' | 'currentVersion'>,
  envelope: LocklineEnvelope,
): boolean {
  if (envelope.schemaVersion !== LOCKLINE_REPORT_SCHEMA_VERSION) return true;
  if (!envelope.sourceSignature) return true;
  if (envelope.generatedFromVersion > snapshot.currentVersion) return true;
  // Global timeline versions also advance for unrelated extensions' project
  // data. The relevant public-input signature is therefore authoritative.
  return envelope.sourceSignature !== buildLocklineSourceSignature(snapshot);
}

export function buildLocklinePatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  analysis: LocklineAnalysis,
): TimelinePatch {
  const generatedFromVersion = snapshot.baseVersion;
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'lockline-registry-provenance-preflight-build',
      generatedFromVersion,
      analysis: 'public-registry-provenance-only',
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: LOCKLINE_REPORT_DATA_KEY,
        value: {
          schemaVersion: LOCKLINE_REPORT_SCHEMA_VERSION,
          generatedFromVersion,
          sourceSignature: analysis.sourceSignature,
          coverage: analysis.coverage,
          entries: analysis.entries.slice(0, MAX_LOCKLINE_FINDINGS),
        } satisfies LocklineEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function renderLocklineMarker(
  marker: TimelinePointMarker<ClusteredTimelineMarkerData<LocklineMarkerData>>,
): unknown {
  const item = marker.data;
  if (!item) return null;
  const count = item.cluster?.entries.length ?? 1;
  return createElement('span', {
    'data-lockline-marker': item.id,
    'data-lockline-stale': item.stale ? 'true' : undefined,
    title: marker.label,
    'aria-label': marker.label,
    style: {
      display: 'inline-block',
      width: item.severity === 'error' ? 11 : 8,
      height: item.severity === 'error' ? 16 : 11,
      backgroundColor: item.stale ? '#94a3b8' : item.color,
      border: item.stale ? '1px dashed currentColor' : '1px solid currentColor',
      borderRadius: count > 1 ? 6 : 2,
      opacity: item.stale ? 0.7 : 1,
    },
  });
}

function renderLocklineOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const snapshot = ctx.creative.reader.snapshot();
  const envelope = readLocklineEnvelope(snapshot, ctx.extension.id as string);
  const stale = isLocklineReportStale(snapshot, envelope);
  const markerEntries: LocklineMarkerData[] = envelope.entries.map((item) => ({ ...item, stale }));
  const markers = clusterTimelineMarkers(markerEntries, {
    getId: (item) => item.id,
    getTime: (item) => item.time,
    getLabel: (item) => `${item.stale ? 'stale · ' : ''}${item.label}`,
    getColor: (item) => item.stale ? '#94a3b8' : item.color,
  });
  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: false,
    snap: false,
    renderMarker: renderLocklineMarker,
  });
}

function reportFailure(ctx: ExtensionContext, code: string, message: string): void {
  ctx.services.diagnostics.report({ severity: 'error', code, message });
}

function disposeTogether(ctx: ExtensionContext, handles: readonly DisposeHandle[]): void {
  for (const handle of [...handles].reverse()) {
    try {
      handle.dispose();
    } catch (error) {
      reportFailure(
        ctx,
        'lockline-inspector/dispose-failed',
        `Lockline Inspector cleanup failed: ${String(error)}`,
      );
    }
  }
}

export const locklineInspectorExtension: ReighExtension = defineExtension({
  manifest: {
    id: LOCKLINE_INSPECTOR_EXTENSION_ID,
    version: '1.1.0',
    label: 'Lockline Inspector',
    description:
      'Builds a read-only, bounded registry and provenance preflight from public timeline references; it does not inspect media availability, pixels, audio, continuity, or render quality.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-lockline-report' as ContributionId,
        kind: 'command',
        command: BUILD_LOCKLINE_REPORT_COMMAND,
        label: 'Build Registry & Provenance Preflight',
        category: 'Lockline Inspector',
        order: 10,
      },
      {
        id: 'lockline-inspector-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID,
        label: 'Registry & Provenance Preflight (read-only ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Lockline Inspector ready — scan public registry and provenance references (read-only).',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const handles: DisposeHandle[] = [];
    try {
      handles.push(ctx.commands.registerCommand(
        BUILD_LOCKLINE_REPORT_COMMAND,
        (_run: CommandRunContext): void => {
          try {
            const snapshot = ctx.creative.reader.snapshot();
            const analysis = deriveLocklineAnalysis(snapshot);
            ctx.creative.timeline.apply(
              buildLocklinePatch(ctx.extension.id as string, snapshot, analysis),
            );
            const coverage = analysis.coverage;
            const omitted = coverage.omittedFindings + coverage.omittedClips;
            ctx.chrome.toast(
              `Registry/provenance preflight built: ${analysis.entries.length} findings; scanned ${coverage.scannedClips}/${coverage.totalClips} clips${omitted > 0 ? `; ${omitted} bounded items omitted` : ''}.`,
              omitted > 0 ? 'warning' : 'info',
            );
            if (omitted > 0) {
              ctx.services.diagnostics.report({
                severity: 'warning',
                code: 'lockline-inspector/report-bounded',
                message: `Lockline report omitted ${coverage.omittedFindings} findings and ${coverage.omittedClips} unscanned clips.`,
              });
            }
          } catch (error) {
            reportFailure(
              ctx,
              'lockline-inspector/build-failed',
              `Lockline registry/provenance preflight failed: ${String(error)}`,
            );
            ctx.chrome.toast('Lockline registry/provenance preflight failed. See diagnostics.', 'error');
          }
        },
        { label: 'Build Registry & Provenance Preflight', category: 'Lockline Inspector' },
      ));
      handles.push(ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
        LOCKLINE_INSPECTOR_OVERLAY_RENDER_ID,
        (props) => renderLocklineOverlay(ctx, props),
      ));
      ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    } catch (error) {
      disposeTogether(ctx, handles);
      reportFailure(
        ctx,
        'lockline-inspector/activation-failed',
        `Lockline Inspector activation failed: ${String(error)}`,
      );
      throw error;
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
