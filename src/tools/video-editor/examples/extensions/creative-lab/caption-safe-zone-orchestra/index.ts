/**
 * Caption Safe-Zone Orchestra — a structural caption accessibility pass.
 *
 * V1 intentionally does not inspect rendered pixels or caption text: the
 * public TimelineSnapshot exposes clip timing, clipType, and track summaries,
 * but not caption boxes or text layout. It therefore reports bounded,
 * deterministic structural proxies (brief caption clips, overlaps, negative
 * starts, and captions on non-visual tracks), persists them in extension-owned
 * project data, and renders them on the host-owned timeline ruler.
 */

import { combineDisposeHandles, defineExtension } from '@reigh/editor-sdk';
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
} from '@reigh/editor-sdk';
import { clusterTimelineMarkers } from '../timelineMarkerClusters';

export const CAPTION_SAFE_ZONE_EXTENSION_ID =
  'com.reigh.creative-lab.caption-safe-zone-orchestra' as ExtensionId;
export const BUILD_CAPTION_FINDINGS_COMMAND =
  `${CAPTION_SAFE_ZONE_EXTENSION_ID}.buildFindings`;
export const CAPTION_FINDINGS_DATA_KEY = 'captionSafetyFindings';
export const CAPTION_OVERLAY_RENDER_ID = 'caption-safe-zone-orchestra/timeline-overlay';

/** A caption shorter than this is a structural timing warning. */
export const MIN_CAPTION_SECONDS = 0.8;
/** Keep project data and marker rendering bounded. */
export const MAX_CAPTION_FINDINGS = 128;
/** Bound structural analysis work before overlap checks. */
export const MAX_CAPTION_SCAN_CLIPS = 512;
const FINDING_COLORS = {
  'too-brief': '#ffd166',
  overlap: '#ff4d8d',
  'non-visual-track': '#b388ff',
  'negative-start': '#52e8ff',
} as const;

export type CaptionFindingKind = keyof typeof FINDING_COLORS;
export type CaptionFindingSeverity = 'warning' | 'error';

export interface CaptionSafetyFinding {
  id: string;
  sourceClipId: string;
  relatedClipId?: string;
  kind: CaptionFindingKind;
  severity: CaptionFindingSeverity;
  time: number;
  label: string;
  color: string;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Normalize marker times without collapsing legitimate long timelines. */
export function normalizeCaptionTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const atDelta = finiteOrZero(a.at) - finiteOrZero(b.at);
  return atDelta !== 0 ? atDelta : a.id.localeCompare(b.id);
}

function isCaptionClip(clip: TimelineClipSummary): boolean {
  if (typeof clip.clipType !== 'string') return false;
  const normalized = clip.clipType.trim().toLowerCase();
  return normalized === 'caption' || normalized === 'subtitle' || normalized === 'text';
}

function isUsableClip(clip: TimelineClipSummary): boolean {
  return typeof clip.id === 'string'
    && typeof clip.track === 'string'
    && Number.isFinite(clip.at)
    && Number.isFinite(clip.duration);
}

function finding(
  sourceClipId: string,
  kind: CaptionFindingKind,
  time: number,
  label: string,
  relatedClipId?: string,
): CaptionSafetyFinding {
  const relation = relatedClipId ? `-${relatedClipId}` : '';
  return {
    id: `caption-${kind}-${sourceClipId}${relation}`,
    sourceClipId,
    ...(relatedClipId ? { relatedClipId } : {}),
    kind,
    severity: kind === 'negative-start' || kind === 'overlap' ? 'error' : 'warning',
    time: normalizeCaptionTime(time),
    label,
    color: FINDING_COLORS[kind],
  };
}

/**
 * Derive deterministic structural proxies from the public snapshot.
 *
 * This is not OCR, text measurement, safe-area geometry, or pixel contrast
 * analysis. Caption-like clips are identified only by their public clipType.
 */
export function deriveCaptionSafetyFindings(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): CaptionSafetyFinding[] {
  const tracks = new Map(snapshot.tracks.map((track) => [track.id, track.kind]));
  const captions = snapshot.clips
    .filter((clip) => isCaptionClip(clip) && isUsableClip(clip))
    .slice()
    .sort(clipOrder)
    .slice(0, MAX_CAPTION_SCAN_CLIPS);
  const findings: CaptionSafetyFinding[] = [];

  for (const clip of captions) {
    const startSeconds = clip.at;
    const durationSeconds = Math.max(0, clip.duration);

    if (clip.at < 0) {
      findings.push(finding(
        clip.id,
        'negative-start',
        0,
        'Caption starts before the timeline origin',
      ));
    }
    if (durationSeconds < MIN_CAPTION_SECONDS) {
      findings.push(finding(
        clip.id,
        'too-brief',
        startSeconds,
        `Caption is shorter than ${MIN_CAPTION_SECONDS}s`,
      ));
    }
    if (tracks.get(clip.track) === 'audio') {
      findings.push(finding(
        clip.id,
        'non-visual-track',
        startSeconds,
        'Caption-like clip is on an audio track',
      ));
    }
  }

  for (let leftIndex = 0; leftIndex < captions.length; leftIndex += 1) {
    const left = captions[leftIndex];
    const leftEnd = left.at + Math.max(0, left.duration);
    for (let rightIndex = leftIndex + 1; rightIndex < captions.length; rightIndex += 1) {
      const right = captions[rightIndex];
      // Captions are sorted by start time. Once the next start reaches this
      // caption's end, no later caption can overlap it.
      if (right.at >= leftEnd) break;
      if (right.track !== left.track) continue;
      const overlapStart = Math.max(left.at, right.at);
      const rightEnd = right.at + Math.max(0, right.duration);
      if (overlapStart < Math.min(leftEnd, rightEnd)) {
        findings.push(finding(
          right.id,
          'overlap',
          overlapStart,
          `Caption overlaps ${left.id}`,
          left.id,
        ));
      }
    }
  }

  return findings
    // Surface provable timing errors before lower-confidence warnings when a
    // hostile project exceeds the display bound, then restore timeline order
    // when persisted/read for the ruler.
    .sort((a, b) => (
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1)
      || a.time - b.time
      || a.id.localeCompare(b.id)
    ))
    .slice(0, MAX_CAPTION_FINDINGS);
}

function isCaptionFinding(value: unknown): value is CaptionSafetyFinding {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && (candidate.relatedClipId === undefined || typeof candidate.relatedClipId === 'string')
    && typeof candidate.kind === 'string'
    && Object.prototype.hasOwnProperty.call(FINDING_COLORS, candidate.kind)
    && (candidate.severity === 'warning' || candidate.severity === 'error')
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && typeof candidate.label === 'string'
    && typeof candidate.color === 'string';
}

/** Read and defensively normalize this extension's project data. */
export function readCaptionSafetyFindings(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = CAPTION_SAFE_ZONE_EXTENSION_ID,
): CaptionSafetyFinding[] {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) return [];
  const raw = (app as Record<string, unknown>)[CAPTION_FINDINGS_DATA_KEY];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter(isCaptionFinding)
    .slice(0, MAX_CAPTION_FINDINGS)
    .map((entry) => ({ ...entry, time: normalizeCaptionTime(entry.time) }))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Build the extension-owned project-data write used by commands and drags. */
export function buildCaptionSafeZonePatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  findings: readonly CaptionSafetyFinding[],
): TimelinePatch {
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: { kind: 'caption-safe-zone-orchestra-build', analysis: 'structural-proxy' },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: CAPTION_FINDINGS_DATA_KEY,
        value: findings.slice(0, MAX_CAPTION_FINDINGS),
        mode: 'replace',
      },
    }],
  };
}

function buildCaptionFindings(ctx: ExtensionContext): CaptionSafetyFinding[] {
  const snapshot = ctx.creative.reader.snapshot();
  const findings = deriveCaptionSafetyFindings(snapshot);
  ctx.creative.timeline.apply(
    buildCaptionSafeZonePatch(ctx.extension.id as string, snapshot, findings),
  );
  ctx.chrome.toast(`Caption safety pass found ${findings.length} structural finding(s).`, 'info');
  return findings;
}

function renderCaptionOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const findings = readCaptionSafetyFindings(
    ctx.creative.reader.snapshot(),
    ctx.extension.id as string,
  );
  const markers = clusterTimelineMarkers(findings, {
    getId: (item) => item.id,
    getTime: (item) => item.time,
    getLabel: (item) => `timing proxy: ${item.kind} · ${item.sourceClipId}`,
    getColor: (item) => item.color,
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    // These are derived facts tied to source clips. Moving only the marker
    // would create a persisted falsehood without fixing the source timing.
    interactive: false,
    snap: false,
  });
}

export const captionSafeZoneOrchestraExtension: ReighExtension = defineExtension({
  manifest: {
    id: CAPTION_SAFE_ZONE_EXTENSION_ID,
    version: '1.0.0',
    label: 'Caption Timing Proxy Orchestra',
    description:
      'Finds bounded caption-timing proxies from public timeline metadata and renders them on the ruler; it cannot inspect safe zones, pixels, layout, or caption text.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-caption-findings' as ContributionId,
        kind: 'command',
        command: BUILD_CAPTION_FINDINGS_COMMAND,
        label: 'Scan Caption Timing Proxies',
        category: 'Caption Timing Proxy',
        order: 10,
      },
      {
        id: 'caption-findings-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: CAPTION_OVERLAY_RENDER_ID,
        label: 'Caption Timing Proxy Findings (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Caption Timing Proxy Orchestra ready — no safe-zone or pixel analysis is claimed.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_CAPTION_FINDINGS_COMMAND,
      (_run: CommandRunContext): void => {
        buildCaptionFindings(ctx);
      },
      { label: 'Scan Caption Timing Proxies', category: 'Caption Timing Proxy' },
    );
    let overlayHandle: DisposeHandle;
    try {
      overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
        CAPTION_OVERLAY_RENDER_ID,
        (props) => renderCaptionOverlay(ctx, props),
      );
    } catch (error) {
      commandHandle.dispose();
      throw error;
    }
    ctx.chrome.toast(ctx.services.i18n.t('ready'), 'info');
    return combineDisposeHandles(commandHandle, overlayHandle);
  },
});
