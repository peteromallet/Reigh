/**
 * Sequential Clip-Link Scaffolder — a transparent, non-executable cut map.
 *
 * V1 derives adjacent links from clip-end boundaries on the primary unmuted
 * visual track. It does not execute branches, alter clips, or imply terminal
 * semantics for the final clip; the links are editable authoring scaffolds.
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
  TimelineMarkerChange,
  TimelineOverlayRenderProps,
  TimelinePatch,
  TimelineSnapshot,
  TimelineTrackSummary,
} from '@reigh/editor-sdk';
import {
  clusterTimelineMarkers,
  moveTimelineMarkerCluster,
} from '../timelineMarkerClusters';

export const BRANCHING_CUT_EXTENSION_ID =
  'com.reigh.creative-lab.branching-cut' as ExtensionId;
export const BUILD_CHOICE_GATES_COMMAND =
  `${BRANCHING_CUT_EXTENSION_ID}.buildChoiceGates`;
/** Kept for project-data compatibility with the original creative-lab name. */
export const CHOICE_GATES_DATA_KEY = 'choiceGates';
export const CLIP_LINKS_DATA_KEY = CHOICE_GATES_DATA_KEY;
export const BRANCHING_CUT_OVERLAY_RENDER_ID = 'branching-cut/timeline-overlay';
export const SEQUENTIAL_LINK_SCHEMA_VERSION = 1;
export const MAX_CLIP_LINKS_DISPLAY = 64;

export interface ClipLink {
  id: string;
  sourceClipId: string;
  targetClipId: string;
  trackId: string;
  /** Structural boundary at the end of the source clip. */
  time: number;
  /** Explicit author adjustment from the source clip end. */
  offset: number;
  label: string;
}

export interface ClipLinkEnvelope {
  schemaVersion: number;
  generatedFromVersion: number;
  entries: ClipLink[];
}

export type ClipLinkPatchMode = 'build' | 'move';

export interface ClipLinkPatchOptions {
  mode?: ClipLinkPatchMode;
  generatedFromVersion?: number;
}

/** Compatibility aliases for callers that used the first experimental name. */
export type ChoiceGate = ClipLink;
export type ChoiceBranch = never;
export const MAX_CHOICE_GATES = MAX_CLIP_LINKS_DISPLAY;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function normalizeClipLinkTime(time: number): number {
  if (!Number.isFinite(time) || time <= 0) return 0;
  return Math.round(time * 1000) / 1000;
}

/** Compatibility export; this no longer clamps at one hour. */
export const normalizeChoiceGateTime = normalizeClipLinkTime;

function clipOrder(a: TimelineClipSummary, b: TimelineClipSummary): number {
  const atDelta = finiteOrZero(a.at) - finiteOrZero(b.at);
  return atDelta !== 0 ? atDelta : a.id.localeCompare(b.id);
}

function primaryEditorialTrack(
  tracks: readonly TimelineTrackSummary[],
): TimelineTrackSummary | undefined {
  return tracks.find((track) => track.kind === 'visual' && track.muted === false);
}

function isValidPrimaryClip(
  clip: TimelineClipSummary,
  primaryTrackId: string,
): boolean {
  return clip.track === primaryTrackId
    && typeof clip.id === 'string'
    && clip.id.length > 0
    && Number.isFinite(clip.at)
    && Number.isFinite(clip.duration)
    && clip.at >= 0
    && clip.duration > 0;
}

function linkFor(
  source: TimelineClipSummary,
  target: TimelineClipSummary,
): ClipLink {
  const sourceEnd = Math.max(0, finiteOrZero(source.at)) + Math.max(0, finiteOrZero(source.duration));
  return {
    id: `clip-link-${source.id}-to-${target.id}`,
    sourceClipId: source.id,
    targetClipId: target.id,
    trackId: source.track,
    time: normalizeClipLinkTime(sourceEnd),
    offset: 0,
    label: `Link ${source.id} → ${target.id}`,
  };
}

/** Compute the complete adjacent graph, without inventing a terminal link. */
export function deriveClipLinks(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
): ClipLink[] {
  const primary = primaryEditorialTrack(snapshot.tracks);
  if (!primary) return [];
  const clips = snapshot.clips
    .filter((clip) => isValidPrimaryClip(clip, primary.id))
    .slice()
    .sort(clipOrder);
  const links: ClipLink[] = [];
  for (let index = 0; index < clips.length - 1; index += 1) {
    const source = clips[index];
    const target = clips[index + 1];
    if (source && target) links.push(linkFor(source, target));
  }
  return links;
}

/** Compatibility export for the first experimental concept name. */
export const deriveChoiceGates = deriveClipLinks;

export function rebuildClipLinks(
  snapshot: Pick<TimelineSnapshot, 'clips' | 'tracks'>,
  previous: readonly ClipLink[] = [],
): ClipLink[] {
  const previousById = new Map(previous.map((link) => [link.id, link]));
  return deriveClipLinks(snapshot).map((link) => {
    const prior = previousById.get(link.id);
    const offset = Number.isFinite(prior?.offset) ? prior.offset : 0;
    return {
      ...link,
      label: prior?.label ?? link.label,
      offset: Math.round(offset * 1000) / 1000,
      time: normalizeClipLinkTime(link.time + offset),
    };
  });
}

function isClipLink(value: unknown): value is ClipLink {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.sourceClipId === 'string'
    && typeof candidate.targetClipId === 'string'
    && typeof candidate.trackId === 'string'
    && typeof candidate.time === 'number'
    && Number.isFinite(candidate.time)
    && (candidate.offset === undefined || typeof candidate.offset === 'number')
    && typeof candidate.label === 'string';
}

function migrateLegacyChoiceGate(value: unknown): ClipLink | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.anchorClipId !== 'string'
    || typeof candidate.trackId !== 'string'
    || typeof candidate.time !== 'number'
    || !Number.isFinite(candidate.time)
    || !Array.isArray(candidate.branches)) return null;
  const target = candidate.branches
    .map((branch) => (branch !== null && typeof branch === 'object'
      ? (branch as Record<string, unknown>).targetClipId
      : undefined))
    .find((targetClipId): targetClipId is string => (
      typeof targetClipId === 'string' && targetClipId !== candidate.anchorClipId
    ));
  if (!target) return null;
  return {
    id: `clip-link-${candidate.anchorClipId}-to-${target}`,
    sourceClipId: candidate.anchorClipId,
    targetClipId: target,
    trackId: candidate.trackId,
    time: normalizeClipLinkTime(candidate.time),
    offset: 0,
    label: typeof candidate.label === 'string'
      ? `Migrated ${candidate.label}`
      : `Link ${candidate.anchorClipId} → ${target}`,
  };
}

function readClipLinkEnvelopeValue(value: unknown): ClipLinkEnvelope | null {
  const legacyArray = Array.isArray(value);
  const rawEntries = legacyArray
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).entries)
      ? (value as Record<string, unknown>).entries
      : null;
  if (!rawEntries) return null;
  const objectValue = !legacyArray && value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
  return {
    schemaVersion: typeof objectValue?.schemaVersion === 'number'
      ? objectValue.schemaVersion
      : SEQUENTIAL_LINK_SCHEMA_VERSION,
    generatedFromVersion: typeof objectValue?.generatedFromVersion === 'number'
      && Number.isFinite(objectValue.generatedFromVersion)
      ? objectValue.generatedFromVersion
      : 0,
    entries: rawEntries.flatMap((entry) => {
      if (isClipLink(entry)) {
        return [{
          ...entry,
          offset: Number.isFinite(entry.offset) ? entry.offset : 0,
          time: normalizeClipLinkTime(entry.time),
        }];
      }
      const migrated = migrateLegacyChoiceGate(entry);
      return migrated ? [migrated] : [];
    }),
  };
}

export function readClipLinkEnvelope(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = BRANCHING_CUT_EXTENSION_ID,
): ClipLinkEnvelope {
  const app = snapshot.app[extensionId];
  if (app === null || typeof app !== 'object' || Array.isArray(app)) {
    return { schemaVersion: SEQUENTIAL_LINK_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
  }
  return readClipLinkEnvelopeValue((app as Record<string, unknown>)[CLIP_LINKS_DATA_KEY])
    ?? { schemaVersion: SEQUENTIAL_LINK_SCHEMA_VERSION, generatedFromVersion: 0, entries: [] };
}

export function readClipLinks(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = BRANCHING_CUT_EXTENSION_ID,
): ClipLink[] {
  return readClipLinkEnvelope(snapshot, extensionId).entries
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

/** Compatibility export for the first experimental concept name. */
export const readChoiceGates = readClipLinks;

export function buildClipLinksPatch(
  extensionId: string,
  snapshot: Pick<TimelineSnapshot, 'baseVersion'>,
  links: readonly ClipLink[],
  options: ClipLinkPatchOptions = {},
): TimelinePatch {
  const mode = options.mode ?? 'build';
  const generatedFromVersion = options.generatedFromVersion ?? snapshot.baseVersion;
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: mode === 'move'
        ? 'sequential-clip-link-scaffolder-move'
        : 'sequential-clip-link-scaffolder-build',
      generatedFromVersion,
      executableBranchEdits: false,
      analysis: 'structural-adjacent-clip-links-only',
    },
    operations: [{
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: CLIP_LINKS_DATA_KEY,
        value: {
          schemaVersion: SEQUENTIAL_LINK_SCHEMA_VERSION,
          generatedFromVersion,
          // Keep the complete graph in owned state; only the ruler display is bounded.
          entries: links.map((link) => ({
            ...link,
            offset: Number.isFinite(link.offset) ? link.offset : 0,
            time: normalizeClipLinkTime(link.time),
          })),
        } satisfies ClipLinkEnvelope,
        mode: 'replace',
      },
    }],
  };
}

/** Compatibility export for the first experimental concept name. */
export const buildChoiceGatesPatch = buildClipLinksPatch;

function buildClipLinks(ctx: ExtensionContext): void {
  const snapshot = ctx.creative.reader.snapshot();
  const links = rebuildClipLinks(snapshot, readClipLinks(snapshot, ctx.extension.id as string));
  ctx.creative.timeline.apply(buildClipLinksPatch(ctx.extension.id as string, snapshot, links));
  ctx.chrome.toast(`Sequential Clip-Link Scaffolder: ${links.length} non-executable links.`, 'info');
}

function renderClipLinkMarker(marker: { data?: ClipLink }): unknown {
  const link = marker.data;
  if (!link) return null;
  return createElement('span', {
    'data-clip-link-marker': link.id,
    'aria-label': `Non-executable clip link from ${link.sourceClipId} to ${link.targetClipId} at source clip end`,
    style: {
      display: 'inline-block',
      width: 8,
      height: 14,
      backgroundColor: '#c084fc',
      borderRadius: 2,
    },
  });
}

function renderClipLinkOverlay(
  ctx: ExtensionContext,
  props: TimelineOverlayRenderProps,
): unknown {
  const snapshot = ctx.creative.reader.snapshot();
  const links = readClipLinks(snapshot, ctx.extension.id as string);
  const visibleLinks = links.slice(0, MAX_CLIP_LINKS_DISPLAY);
  const markers = clusterTimelineMarkers(visibleLinks, {
    getId: (link) => link.id,
    getTime: (link) => link.time,
    getLabel: (link) => `${link.sourceClipId} → ${link.targetClipId} · scaffold`,
    getColor: () => '#c084fc',
  });

  return props.primitives.markerLayer({
    markers,
    placement: 'ruler',
    interactive: true,
    snap: true,
    renderMarker: renderClipLinkMarker,
    onChange: (change: TimelineMarkerChange): void => {
      if (change.phase !== 'commit') return;
      const freshSnapshot = ctx.creative.reader.snapshot();
      const freshLinks = readClipLinks(freshSnapshot, ctx.extension.id as string);
      const baseline = new Map(deriveClipLinks(freshSnapshot).map((link) => [link.id, link]));
      const moved = moveTimelineMarkerCluster(
        freshLinks,
        change.id,
        normalizeClipLinkTime(change.time),
        {
          getId: (link) => link.id,
          getTime: (link) => link.time,
          updateTime: (link, nextTime) => {
            const base = baseline.get(link.id);
            return {
              ...link,
              time: nextTime,
              offset: Math.round((nextTime - (base?.time ?? nextTime)) * 1000) / 1000,
            };
          },
        },
      );
      if (moved.moved) {
        const envelope = readClipLinkEnvelope(freshSnapshot, ctx.extension.id as string);
        ctx.creative.timeline.apply(buildClipLinksPatch(ctx.extension.id as string, freshSnapshot, moved.entries, {
          mode: 'move',
          generatedFromVersion: envelope.generatedFromVersion,
        }));
      }
    },
  });
}

function disposeTogether(ctx: ExtensionContext, handles: readonly DisposeHandle[]): void {
  for (const handle of handles) {
    try {
      handle.dispose();
    } catch (error) {
      ctx.services.diagnostics.report({
        severity: 'error',
        code: 'sequential-clip-link-scaffolder/dispose-failed',
        message: `Sequential Clip-Link Scaffolder cleanup failed: ${String(error)}`,
      });
    }
  }
}

export const branchingCutExtension: ReighExtension = defineExtension({
  manifest: {
    id: BRANCHING_CUT_EXTENSION_ID,
    version: '1.0.0',
    label: 'Sequential Clip-Link Scaffolder',
    description:
      'Creates editable, non-executable links between adjacent primary visual clips at source clip ends; it never executes branches or edits clips.',
    apiVersion: 1,
    contributions: [
      {
        id: 'build-choice-gates' as ContributionId,
        kind: 'command',
        command: BUILD_CHOICE_GATES_COMMAND,
        label: 'Build Sequential Clip-Link Scaffolds',
        category: 'Sequential Clip-Link Scaffolder',
        order: 10,
      },
      {
        id: 'branching-cut-overlay' as ContributionId,
        kind: 'timelineOverlay',
        render: BRANCHING_CUT_OVERLAY_RENDER_ID,
        label: 'Clip-Link Scaffolds (timeline ruler)',
        order: 10,
      },
    ],
    messages: {
      ready: 'Sequential Clip-Link Scaffolder ready — inspect non-executable adjacent links.',
    },
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const commandHandle = ctx.commands.registerCommand(
      BUILD_CHOICE_GATES_COMMAND,
      (_run: CommandRunContext): void => { buildClipLinks(ctx); },
      { label: 'Build Sequential Clip-Link Scaffolds', category: 'Sequential Clip-Link Scaffolder' },
    );
    const overlayHandle = ctx.ui.registerRenderer<TimelineOverlayRenderProps>(
      BRANCHING_CUT_OVERLAY_RENDER_ID,
      (props) => renderClipLinkOverlay(ctx, props),
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
