/**
 * Timeline Faultline — a read-only structural timeline proxy.
 *
 * V1 only inspects public clip/track summaries. Continuity is evaluated on
 * the first unmuted visual track (the primary editorial picture track), so
 * audio, muted, and auxiliary tracks cannot manufacture visual gaps.
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
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';

export const TIMELINE_FAULTLINE_EXTENSION_ID =
  'com.reigh.creative-lab.timeline-faultline' as ExtensionId;
export const BUILD_TIMELINE_FAULTLINE_COMMAND =
  `${TIMELINE_FAULTLINE_EXTENSION_ID}.buildFaultline`;
export const TIMELINE_FAULTLINE_DATA_KEY = 'faultlineFindings';
export const TIMELINE_FAULTLINE_OVERLAY_RENDER_ID =
  'timeline-faultline/timeline-overlay';
export const TIMELINE_FAULTLINE_SCHEMA_VERSION = 1;

export const MAX_FAULTLINE_SCAN_CLIPS = 1024;
export const MAX_FAULTLINE_FINDINGS = 256;

const FAULTLINE_COLORS = {
  overlap: '#ff4d6d',
  gap: '#52e8ff',
  'missing-track': '#ffd166',
  'negative-start': '#b388ff',
  'negative-duration': '#ff8c42',
  'zero-duration': '#f72585',
  'non-finite': '#ffffff',
} as const;

export type FaultlineKind = keyof typeof FAULTLINE_COLORS;
export type FaultlineSeverity = 'warning' | 'error';

export interface FaultlineFinding {
  id: string;
  sourceClipId: string;
  relatedClipId?: string;
  kind: FaultlineKind;
  severity: FaultlineSeverity;
  time: number;
  label: string;
  color: string;
}

export interface FaultlineEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  entries: FaultlineFinding[];
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export function normalizeFaultlineTime(time: number): number {
  if (!finite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const track = a.track.localeCompare(b.track);
  if (track !== 0) return track;
  const at = (finite(a.at) ? a.at : 0) - (finite(b.at) ? b.at : 0);
  return at !== 0 ? at : a.id.localeCompare(b.id);
}

function primaryEditorialTrack(
  tracks: readonly TimelineTrackSummary[],
): TimelineTrackSummary | undefined {
  return tracks.find((track) => track.kind === 'visual' && track.muted === false);
}

function validContinuityClip(
  clip: TimelineClipSummary,
  primaryTrackId: string,
): boolean {
  return clip.track === primaryTrackId
    && finite(clip.at)
    && finite(clip.duration)
    && clip.at >= 0
    && clip.duration > 0;
}

function finding(
  sourceClipId: string,
  kind: FaultlineKind,
  timeSeconds: number,
  severity: FaultlineSeverity,
  label: string,
  relatedClipId?: string,
): FaultlineFinding {
  const suffix = relatedClipId ? `-${relatedClipId}` : '';
  return {
    id: `fault-${kind}-${sourceClipId}${suffix}`,
    sourceClipId,
    ...(relatedClipId ? { relatedClipId } : {}),
    kind,
    severity,
    time: normalizeFaultlineTime(timeSeconds),
    label,
    color: FAULTLINE_COLORS[kind],
  };
}

function findingOrder(a: FaultlineFinding, b: FaultlineFinding): number {
  const severity = (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1);
  if (severity !== 0) return severity;
  return a.time - b.time || a.id.localeCompare(b.id);
}

function timelineOrder(a: FaultlineFinding, b: FaultlineFinding): number {
  return a.time - b.time || a.id.localeCompare(b.id);
}

/** Find deterministic structural anomalies without claiming render analysis. */
export function deriveFaultlineFindings(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): FaultlineFinding[] {
  const trackIds = new Set(snapshot.tracks.map((track) => track.id));
  const ordered = [...snapshot.clips]
    .sort(clipOrder)
    .slice(0, MAX_FAULTLINE_SCAN_CLIPS);
  const findings: FaultlineFinding[] = [];
  const add = (item: FaultlineFinding): void => { findings.push(item); };

  for (const clip of ordered) {
    const start = finite(clip.at) ? clip.at : 0;
    if (!finite(clip.at) || !finite(clip.duration)) {
      add(finding(clip.id, 'non-finite', start, 'error', 'non-finite clip timing'));
    }
    if (finite(clip.at) && clip.at < 0) {
      add(finding(clip.id, 'negative-start', 0, 'error', 'clip starts before timeline zero'));
    }
    if (finite(clip.duration) && clip.duration < 0) {
      add(finding(clip.id, 'negative-duration', start, 'error', 'clip has negative duration'));
    } else if (finite(clip.duration) && clip.duration === 0) {
      add(finding(clip.id, 'zero-duration', start, 'warning', 'zero-duration clip'));
    }
    if (!trackIds.has(clip.track)) {
      add(finding(clip.id, 'missing-track', start, 'error', `clip references missing track ${clip.track}`));
    }
  }

  const primary = primaryEditorialTrack(snapshot.tracks);
  const primaryClips = primary
    ? ordered.filter((clip) => validContinuityClip(clip, primary.id))
    : [];
  let previous: TimelineClipSummary | undefined;
  let previousEnd = 0;
  for (const clip of primaryClips.sort((a, b) => (
    a.at - b.at || a.id.localeCompare(b.id)
  ))) {
    const end = clip.at + clip.duration;
    if (previous) {
      if (clip.at < previousEnd) {
        add(finding(clip.id, 'overlap', clip.at, 'warning', `overlaps ${previous.id}`, previous.id));
      } else if (clip.at > previousEnd) {
        add(finding(clip.id, 'gap', previousEnd, 'warning', `gap before ${clip.id}`, previous.id));
      }
    }
    if (end > previousEnd) {
      previousEnd = end;
      previous = clip;
    }
  }

  // Preserve timeline order for markers, but choose errors first when the
  // bounded output needs truncation.
  return findings
    .slice()
    .sort(findingOrder)
    .slice(0, MAX_FAULTLINE_FINDINGS)
    .sort(timelineOrder);
}

function isFaultlineFinding(value: unknown): value is FaultlineFinding {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && (candidate.relatedClipId === undefined || typeof candidate.relatedClipId === 'string')
    && typeof candidate.kind === 'string'
    && candidate.kind in FAULTLINE_COLORS
    && (candidate.severity === 'warning' || candidate.severity === 'error')
    && typeof candidate.time === 'number'
    && finite(candidate.time)
    && typeof candidate.label === 'string'
    && typeof candidate.color === 'string';
}

function readFaultlineEnvelopeValue(value: unknown): FaultlineEnvelope | null {
  if (Array.isArray(value)) {
    return {
      schemaVersion: TIMELINE_FAULTLINE_SCHEMA_VERSION,
      generatedFromVersion: 0,
      entries: value.filter(isFaultlineFinding)
        .map((item) => ({ ...item, time: normalizeFaultlineTime(item.time) })),
    };
  }
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.entries)) return null;
  return {
    schemaVersion: typeof candidate.schemaVersion === 'number' ? candidate.schemaVersion : 0,
    generatedFromVersion: typeof candidate.generatedFromVersion === 'number'
      && finite(candidate.generatedFromVersion)
      ? candidate.generatedFromVersion
      : 0,
    entries: candidate.entries.filter(isFaultlineFinding)
      .map((item) => ({ ...item, time: normalizeFaultlineTime(item.time) })),
  };
}

export function readFaultlineEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = TIMELINE_FAULTLINE_EXTENSION_ID,
): FaultlineEnvelope {
  const app = snapshot.app[extensionId];
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: TIMELINE_FAULTLINE_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
  }
  const raw = (app as Record<string, unknown>)[TIMELINE_FAULTLINE_DATA_KEY];
  return readFaultlineEnvelopeValue(raw)
    ?? { schemaVersion: TIMELINE_FAULTLINE_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
}

export function readFaultlineFindings(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = TIMELINE_FAULTLINE_EXTENSION_ID,
): FaultlineFinding[] {
  return readFaultlineEnvelope(snapshot, extensionId).entries
    .slice(0, MAX_FAULTLINE_FINDINGS)
    .sort(timelineOrder);
}

export function buildFaultlinePatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  findings: readonly FaultlineFinding[],
): TimelinePatch {
  const generatedFromVersion = snapshot.baseVersion;
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'timeline-faultline-build',
      generatedFromVersion,
      analysis: 'public-structural-read-only-proxy',
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: TIMELINE_FAULTLINE_DATA_KEY,
        value: {
          schemaVersion: TIMELINE_FAULTLINE_SCHEMA_VERSION,
          generatedFromVersion,
          entries: findings.slice(0, MAX_FAULTLINE_FINDINGS),
        } satisfies FaultlineEnvelope,
        mode: 'replace',
      },
    }],
  };
}

function renderFaultlineMarker(marker: { data?: FaultlineFinding }): unknown {
  const item = marker.data;
  if (!item) return null;
  return createElement('span', {
    'data-faultline-marker': item.id,
    'aria-label': `Read-only structural faultline from ${item.sourceClipId}: ${item.severity} ${item.kind}`,
    style: {
      display: 'inline-block',
      width: item.severity === 'error' ? 10 : 7,
      height: item.severity === 'error' ? 16 : 10,
      backgroundColor: item.color,
      borderRadius: 2,
    },
  });
}

function renderFaultlineOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const findings = readFaultlineFindings(ctx.creative.reader.snapshot(), ctx.extension.id as string);
  const markers = clusterTimelineMarkers(findings, {
    getId: (item) => item.id,
    getTime: (item) => item.time,
    getLabel: (item) => `${item.severity} · ${item.kind} · ${item.sourceClipId}`,
    getColor: (item) => item.color,
  });
  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: false,
    snap: false,
    renderMarker: renderFaultlineMarker,
  });
}

function disposeTogether(ctx: ExtensionContext, handles: readonly DisposeHandle[]): void {
  for (const handle of handles) {
    try {
      handle.dispose();
    } catch (error) {
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'timeline-faultline/dispose-failed',
        message: `Timeline Faultline cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const timelineFaultlineExtension: ReighExtension = defineExtension({
  manifest: {
    id: TIMELINE_FAULTLINE_EXTENSION_ID,
    version: '1.0.0',
    label: 'Timeline Faultline',
    description:
      'Read-only structural continuity proxy for the primary unmuted visual track; it does not analyze pixels, audio, or render corruption.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-faultline' as ContributionId,
        kind: 'command',
        command: BUILD_TIMELINE_FAULTLINE_COMMAND,
        label: 'Build Timeline Faultline',
        category: 'Timeline Faultline',
        order: 10,
      },
      {
        id: 'faultline-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: TIMELINE_FAULTLINE_OVERLAY_RENDER_ID,
        label: 'Faultline (read-only timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Timeline Faultline ready — scan the primary visual continuity proxy (read-only).',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_TIMELINE_FAULTLINE_COMMAND,
      (_run: CommandRunContext): void => {
        const snapshot = ctx.creative.reader.snapshot();
        const findings = deriveFaultlineFindings(snapshot);
        ctx.creative.timeline.apply(buildFaultlinePatch(ctx.extension.id as string, snapshot, findings));
        ctx.chrome.toast(`Faultline proxy built: ${findings.length} structural findings.`, 'info');
      },
      { label: 'Build Timeline Faultline', category: 'Timeline Faultline' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      TIMELINE_FAULTLINE_OVERLAY_RENDER_ID,
      (props) => renderFaultlineOverlay(ctx, props),
    );
    ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    let disposed = false;
    return {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        disposeTogether(ctx, [commandHandle, overlayHandle]);
      },
    };
  },
});
