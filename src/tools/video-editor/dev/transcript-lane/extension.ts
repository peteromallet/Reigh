/**
 * transcript-lane — dev-local dataKind example (dataKind V1, entry 21 of 22).
 *
 * The smallest complete typed-data extension: DECLARE a `dataKind`
 * contribution in the manifest, BIND a lane renderer (+ item inspector) at
 * activation via `ctx.dataKinds.register(kindId, laneRenderer, inspector?)`,
 * and the host DISPLAYS the lane under the timeline tracks. A third data
 * kind should be unremarkable — declare, bind, display.
 *
 * Division of labor (do not conflate):
 * - Host: adapts injected transcript segments (`adaptTranscript`), maps
 *   source seconds onto clips (trim/speed algebra), mounts the lane row.
 * - This extension: declares the vocabulary (kindId/schemaRef/shape/domain)
 *   and paints pre-mapped items. The renderer NEVER fetches (no
 *   `loadTranscript`) and never edits the timeline.
 *
 * The declared `schemaRef` matches the host transcript adapter's output
 * (`reigh.transcript_segment/v1`), so assembled lanes resolve this kind's
 * registered renderer; an unknown schemaRef would list opaquely with host
 * fallback paint instead.
 *
 * This file lives under src/tools/video-editor/dev/ (the author scratchpad
 * wired into VideoEditorPage via devLocalExtensions) and is excluded from
 * the video-editor-sdk-import governance check, but it imports only the
 * public SDK plus React and its own sibling renderer module.
 */

import {
  computeHostFingerprint,
  createHostGeneratedObjectMeta,
  defineExtension,
  readHostGenerationProvenance,
} from '@reigh/editor-sdk';
import type {
  ContributionId,
  DataItemInspectorProps,
  DataLaneRenderItem,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelinePatch,
  TimelinePatchOperation,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import { createElement, useCallback, useState, type ReactNode } from 'react';
import { readChipText, renderTranscriptItemInspector, renderTranscriptLane } from './TranscriptLaneView';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const TRANSCRIPT_LANE_EXTENSION_ID = 'com.reigh.transcript-lane' as ExtensionId;

/** Registered data-kind id (the `ctx.dataKinds.register()` key). */
export const TRANSCRIPT_KIND_ID = 'reigh.transcript';

/**
 * Qualified schema reference. Must equal the host transcript adapter's
 * output schemaRef so segments land in THIS kind's lane instead of an
 * opaque one ([CONVERGE-WITH-M1] literal).
 */
export const TRANSCRIPT_SCHEMA_REF = 'reigh.transcript_segment/v1';
export const TRANSCRIPT_CAPTION_TRACK_ID = 'transcript-caption-foundry-track';
export const TRANSCRIPT_CAPTION_CONTRIBUTION_ID = 'transcript-caption-foundry';
export const TRANSCRIPT_EXTENSION_VERSION = '1.3.0';
export const TRANSCRIPT_SOURCE_REVIEW_KEY_PREFIX = 'transcript-source-review:';

const MAX_CAPTION_SEGMENTS = 512;
const MIN_CAPTION_DURATION_SECONDS = 0.1;

/**
 * A caption interval has two independently rounded frame boundaries. Derive
 * its duration from those boundaries so `from + duration` reaches the same
 * frame as the source end even when the source starts between frames. Using
 * `round((end - start) * fps)` loses the last caption frame for common
 * fractional inputs (for example 0.771–1.250 at 23.976 and 30 fps).
 */
function captionDurationSeconds(start: number, end: number, fps: number | undefined): number {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return Math.max(MIN_CAPTION_DURATION_SECONDS, end - start);
  }
  const startFrame = Math.round(start * fps);
  const endFrame = Math.round(end * fps);
  const minimumFrames = Math.max(1, Math.ceil(MIN_CAPTION_DURATION_SECONDS * fps));
  return Math.max(minimumFrames, endFrame - startFrame) / fps;
}

export function transcriptCaptionClipId(itemId: string): string {
  return `transcript-caption-${computeHostFingerprint(itemId).split(':')[1]}`;
}

export type TranscriptCaptionMaterializeMode = 'preserve' | 'regenerate';

export interface TranscriptCaptionPatchOptions {
  /** Preserve human edits by default; regeneration is always explicit. */
  mode?: TranscriptCaptionMaterializeMode;
}

export type TranscriptSourceReviewStatus =
  | 'pending-review'
  | 'accepted-for-source-update'
  | 'acknowledged-by-source-owner'
  | 'rejected'
  | 'source-conflict';

export interface TranscriptSourceOwnerAcknowledgement {
  readonly schemaVersion: 1;
  /** Stable identity asserted by the upstream transcript integration. */
  readonly ownerId: string;
  /** Exact accepted handoff the owner consumed. */
  readonly handoffFingerprint: string;
  /** Revision returned by the upstream source after applying the update. */
  readonly sourceRevision: string | number;
  /** Host fingerprint of the source value the upstream owner says is applied. */
  readonly appliedSourceFingerprint: string;
  /** Local timeline revision at which the acknowledgement was recorded. */
  readonly acknowledgedAtRevision: number;
}

export interface TranscriptSourceConsumptionAcknowledgement {
  readonly sourceItemId: string;
  readonly ownerId: string;
  readonly handoffFingerprint: string;
  readonly sourceRevision: string | number;
  readonly appliedSourceFingerprint: string;
}

export interface TranscriptSourceReviewRecord {
  readonly schemaVersion: 1;
  readonly status: TranscriptSourceReviewStatus;
  readonly sourceSchemaRef: typeof TRANSCRIPT_SCHEMA_REF;
  readonly sourceItemId: string;
  readonly sourceFingerprintAtGeneration: string;
  readonly currentSourceFingerprint: string;
  readonly generatedOutputFingerprint: string;
  readonly editedOutputFingerprint: string;
  readonly proposedText: string;
  readonly proposedTimelineStart: number;
  readonly proposedTimelineEnd: number;
  readonly generatorVersion: string;
  readonly handoffFingerprint?: string;
  readonly decisionRevision?: number;
  readonly conflictReason?: 'source-item-missing' | 'source-changed-after-proposal';
  readonly resolvedSourceFingerprint?: string;
  readonly acknowledgement?: TranscriptSourceOwnerAcknowledgement;
}

export type TranscriptSourceReviewDecision = 'accept' | 'reject';

export interface TranscriptSourceReviewDecisionOptions {
  /** Omit for the existing batch action; provide ids for a per-record decision. */
  readonly sourceItemIds?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTranscriptSourceOwnerAcknowledgement(
  value: unknown,
): value is TranscriptSourceOwnerAcknowledgement {
  if (!isRecord(value)) return false;
  const validRevision = (
    typeof value.sourceRevision === 'string'
    && value.sourceRevision.trim() !== ''
  ) || (
    typeof value.sourceRevision === 'number'
    && Number.isFinite(value.sourceRevision)
  );
  return (
    value.schemaVersion === 1
    && typeof value.ownerId === 'string'
    && value.ownerId.trim() !== ''
    && typeof value.handoffFingerprint === 'string'
    && value.handoffFingerprint !== ''
    && validRevision
    && typeof value.appliedSourceFingerprint === 'string'
    && value.appliedSourceFingerprint !== ''
    && typeof value.acknowledgedAtRevision === 'number'
    && Number.isFinite(value.acknowledgedAtRevision)
  );
}

function isTranscriptSourceReviewRecord(value: unknown): value is TranscriptSourceReviewRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1
    && typeof value.status === 'string'
    && [
      'pending-review',
      'accepted-for-source-update',
      'acknowledged-by-source-owner',
      'rejected',
      'source-conflict',
    ].includes(value.status)
    && value.sourceSchemaRef === TRANSCRIPT_SCHEMA_REF
    && typeof value.sourceItemId === 'string'
    && typeof value.sourceFingerprintAtGeneration === 'string'
    && typeof value.currentSourceFingerprint === 'string'
    && typeof value.generatedOutputFingerprint === 'string'
    && typeof value.editedOutputFingerprint === 'string'
    && typeof value.proposedText === 'string'
    && typeof value.proposedTimelineStart === 'number'
    && Number.isFinite(value.proposedTimelineStart)
    && typeof value.proposedTimelineEnd === 'number'
    && Number.isFinite(value.proposedTimelineEnd)
    && typeof value.generatorVersion === 'string'
    && (
      value.handoffFingerprint === undefined
      || (typeof value.handoffFingerprint === 'string' && value.handoffFingerprint !== '')
    )
    && (
      value.status !== 'acknowledged-by-source-owner'
      || (
        isTranscriptSourceOwnerAcknowledgement(value.acknowledgement)
        && value.handoffFingerprint === value.acknowledgement.handoffFingerprint
      )
    )
  );
}

export function transcriptSourceReviewHandoffFingerprint(
  record: Pick<
    TranscriptSourceReviewRecord,
    | 'sourceSchemaRef'
    | 'sourceItemId'
    | 'currentSourceFingerprint'
    | 'editedOutputFingerprint'
    | 'proposedText'
    | 'proposedTimelineStart'
    | 'proposedTimelineEnd'
    | 'generatorVersion'
  >,
): string {
  return computeHostFingerprint({
    contract: 'reigh.transcript-source-review-handoff/v1',
    sourceSchemaRef: record.sourceSchemaRef,
    sourceItemId: record.sourceItemId,
    currentSourceFingerprint: record.currentSourceFingerprint,
    editedOutputFingerprint: record.editedOutputFingerprint,
    proposedText: record.proposedText,
    proposedTimelineStart: record.proposedTimelineStart,
    proposedTimelineEnd: record.proposedTimelineEnd,
    generatorVersion: record.generatorVersion,
  });
}

/** Read only well-formed review records owned by this extension. */
export function readTranscriptSourceReviews(
  snapshot: Pick<TimelineSnapshot, 'app'>,
  extensionId: string = TRANSCRIPT_LANE_EXTENSION_ID,
): Array<{ key: string; value: TranscriptSourceReviewRecord }> {
  const extensionData = snapshot.app[extensionId];
  if (!isRecord(extensionData)) return [];
  return Object.entries(extensionData)
    .filter(([key, value]) => (
      key.startsWith(TRANSCRIPT_SOURCE_REVIEW_KEY_PREFIX)
      && isTranscriptSourceReviewRecord(value)
    ))
    .map(([key, value]) => ({ key, value: value as TranscriptSourceReviewRecord }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function currentTranscriptSourceValue(item: DataLaneRenderItem) {
  const sourceItemId = item.sourceItemId ?? item.id;
  return {
    schemaRef: TRANSCRIPT_SCHEMA_REF,
    sourceItemId,
    payload: item.payload,
    timelineStart: item.timelineStart,
    timelineEnd: item.timelineEnd,
  };
}

/**
 * Convert already host-mapped transcript intervals into ordinary built-in
 * text clips. Re-running updates the same deterministic clip IDs, so the
 * action is idempotent and generated captions stay editable in the normal
 * preview/inspector surfaces.
 */
export function buildTranscriptCaptionPatch(
  snapshot: Pick<TimelineSnapshot, 'baseVersion' | 'tracks' | 'clips' | 'outputMetadata'>,
  items: readonly DataLaneRenderItem[],
  extensionId: string = TRANSCRIPT_LANE_EXTENSION_ID,
  options: TranscriptCaptionPatchOptions = {},
): TimelinePatch {
  const mode = options.mode ?? 'preserve';
  const resolutionMatch = snapshot.outputMetadata?.resolution.match(/^(\d+)x(\d+)$/i);
  const compositionWidth = resolutionMatch ? Number(resolutionMatch[1]) : 1280;
  const compositionHeight = resolutionMatch ? Number(resolutionMatch[2]) : 720;
  const captionBox = {
    x: Math.round(compositionWidth * 0.1),
    // Sit in the lower third but above the editor player's paused controls;
    // exported video has no chrome, while authoring must remain readable too.
    y: Math.round(compositionHeight * 0.58),
    width: Math.round(compositionWidth * 0.8),
    height: Math.round(compositionHeight * 0.14),
  };
  const normalized = items
    .filter((item) => (
      Number.isFinite(item.timelineStart)
      && Number.isFinite(item.timelineEnd)
      && item.timelineEnd > item.timelineStart
      && readChipText(item.payload).trim() !== ''
      && readChipText(item.payload) !== '(no text)'
    ))
    .sort((left, right) => (
      (left.timelineStart - right.timelineStart)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, MAX_CAPTION_SEGMENTS);
  const existingClips = new Map(snapshot.clips.map((clip) => [clip.id, clip]));
  const desiredClipIds = new Set(normalized.map((item) => transcriptCaptionClipId(item.id)));
  const operations: TimelinePatchOperation[] = [];
  // Interval-partition overlapping speakers into the first available vertical
  // lane. Gaps reuse lane zero; overlaps no longer paint two strings into the
  // same pixels. `normalized` is sorted above so direct SDK callers get the
  // same placement even if their source items are shuffled.
  const collisionGroups: Array<Array<{ item: DataLaneRenderItem; lane: number }>> = [];
  let currentGroup: Array<{ item: DataLaneRenderItem; lane: number }> = [];
  let overlapLaneEnds: number[] = [];
  let currentGroupEnd = Number.NEGATIVE_INFINITY;
  for (const item of normalized) {
    // Once the next caption starts after every interval in this connected
    // collision group, reset sizing. One pathological burst must not leave
    // every later isolated caption permanently tiny.
    if (currentGroup.length > 0 && item.timelineStart >= currentGroupEnd) {
      collisionGroups.push(currentGroup);
      currentGroup = [];
      overlapLaneEnds = [];
      currentGroupEnd = Number.NEGATIVE_INFINITY;
    }
    let lane = overlapLaneEnds.findIndex((laneEnd) => laneEnd <= item.timelineStart);
    if (lane === -1) {
      lane = overlapLaneEnds.length;
      overlapLaneEnds.push(item.timelineEnd);
    } else {
      overlapLaneEnds[lane] = item.timelineEnd;
    }
    currentGroup.push({ item, lane });
    currentGroupEnd = Math.max(currentGroupEnd, item.timelineEnd);
  }
  if (currentGroup.length > 0) collisionGroups.push(currentGroup);
  const placed = collisionGroups.flatMap((group) => {
    const groupLaneCount = Math.max(...group.map(({ lane }) => lane)) + 1;
    return group.map((placement) => ({ ...placement, groupLaneCount }));
  });
  // Preserve the normal lower-third box for one or two speakers. At higher
  // concurrency, divide all remaining safe canvas height evenly instead of
  // clamping later lanes onto the same bottom coordinate. Font size follows
  // the bounded row height, making extreme concurrency explicitly degraded
  // (small) but never silently overpainted.
  const captionBottomMargin = Math.round(compositionHeight * 0.06);
  const availableCaptionHeight = Math.max(
    1,
    compositionHeight - captionBox.y - captionBottomMargin,
  );
  const baseCaptionFontSize = Math.max(28, Math.round(compositionHeight * 0.067));
  let order = 0;

  if (!snapshot.tracks.some((track) => track.id === TRANSCRIPT_CAPTION_TRACK_ID)) {
    const topVisualTrackId = snapshot.tracks.find((track) => track.kind === 'visual')?.id;
    operations.push({
      op: 'track.add',
      target: TRANSCRIPT_CAPTION_TRACK_ID,
      payload: {
        kind: 'visual',
        label: 'Transcript Captions',
        ...(topVisualTrackId ? { before: topVisualTrackId } : {}),
      },
      order: order++,
    });
  }

  for (const { item, lane: overlapLane, groupLaneCount } of placed) {
    const clipId = transcriptCaptionClipId(item.id);
    const text = readChipText(item.payload).trim();
    const duration = captionDurationSeconds(
      item.timelineStart,
      item.timelineEnd,
      snapshot.outputMetadata?.fps,
    );
    const captionRows = Math.min(groupLaneCount, availableCaptionHeight);
    const captionColumns = Math.ceil(groupLaneCount / captionRows);
    const captionRowHeight = Math.max(
      1,
      Math.min(captionBox.height, Math.floor(availableCaptionHeight / captionRows)),
    );
    const captionColumnWidth = Math.max(1, Math.floor(captionBox.width / captionColumns));
    const captionFontSize = Math.max(
      1,
      Math.min(baseCaptionFontSize, Math.floor(captionRowHeight * 0.67)),
    );
    const captionColumn = Math.floor(overlapLane / captionRows);
    const captionRow = overlapLane % captionRows;
    const captionX = captionBox.x + (captionColumn * captionColumnWidth);
    const itemCaptionBox = {
      ...captionBox,
      x: captionX,
      y: captionBox.y + (captionRow * captionRowHeight),
      width: captionColumn === captionColumns - 1
        ? captionBox.x + captionBox.width - captionX
        : captionColumnWidth,
      height: captionRowHeight,
    };
    const label = text.length > 48 ? `${text.slice(0, 47)}…` : text;
    const textStyle = {
      content: text,
      fontSize: captionFontSize,
      color: '#ffffff',
      bold: true,
      align: 'center',
    };
    const outputValue = {
      track: TRANSCRIPT_CAPTION_TRACK_ID,
      at: item.timelineStart,
      duration,
      clipType: 'text',
      label,
      text: textStyle,
      ...itemCaptionBox,
    };
    const sourceItemId = item.sourceItemId ?? item.id;
    const generatedMeta = createHostGeneratedObjectMeta({
      extensionId,
      contributionId: TRANSCRIPT_CAPTION_CONTRIBUTION_ID,
      extensionVersion: TRANSCRIPT_EXTENSION_VERSION,
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId,
      sourceRevision: snapshot.baseVersion,
      sourceValue: {
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        sourceItemId,
        payload: item.payload,
        timelineStart: item.timelineStart,
        timelineEnd: item.timelineEnd,
      },
      outputValue,
      conflictPolicy: mode === 'regenerate' ? 'regenerate-output' : 'preserve-output',
    });
    const existing = existingClips.get(clipId);
    if (existing && mode === 'preserve') continue;
    if (!existing) {
      operations.push({
        op: 'clip.add',
        target: clipId,
        payload: {
          track: TRANSCRIPT_CAPTION_TRACK_ID,
          at: item.timelineStart,
          clipType: 'text',
        },
        order: order++,
      });
    }
    operations.push({
      op: 'clip.update',
      target: clipId,
      payload: {
        track: TRANSCRIPT_CAPTION_TRACK_ID,
        at: item.timelineStart,
        hold: duration,
        ...itemCaptionBox,
        text: textStyle,
        label,
        app: { __generated__: generatedMeta },
        mode: 'merge',
      },
      order: order++,
    });
  }

  if (mode === 'regenerate') {
    for (const clip of snapshot.clips) {
      const provenance = readHostGenerationProvenance(clip.generatedMeta);
      if (
        clip.track !== TRANSCRIPT_CAPTION_TRACK_ID
        || clip.generatedMeta?.extensionId !== extensionId
        || clip.generatedMeta.contributionId !== TRANSCRIPT_CAPTION_CONTRIBUTION_ID
        || provenance?.sourceSchemaRef !== TRANSCRIPT_SCHEMA_REF
        || desiredClipIds.has(clip.id)
      ) continue;
      operations.push({ op: 'clip.remove', target: clip.id, order: order++ });
    }
  }

  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'transcript-caption-foundry/render-as-video-text',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      roundTripPolicy: mode,
      hostProvenanceContract: 1,
    },
    operations,
  };
}

/**
 * Convert human-edited generated captions into explicit review records.
 * This never mutates the transcript source directly: an upstream owner can
 * accept/reject each proposal using the recorded source fingerprint.
 */
export function buildTranscriptSourceReviewPatch(
  snapshot: Pick<TimelineSnapshot, 'baseVersion' | 'clips'>,
  items: readonly DataLaneRenderItem[],
  extensionId: string = TRANSCRIPT_LANE_EXTENSION_ID,
): TimelinePatch {
  const operations: TimelinePatchOperation[] = [];
  const existingClips = new Map(snapshot.clips.map((clip) => [clip.id, clip]));
  let order = 0;
  for (const item of items) {
    const clip = existingClips.get(transcriptCaptionClipId(item.id));
    if (!clip || typeof clip.textContent !== 'string' || !clip.contentFingerprint) continue;
    const provenance = readHostGenerationProvenance(clip.generatedMeta);
    if (!provenance || provenance.sourceSchemaRef !== TRANSCRIPT_SCHEMA_REF) continue;
    if (clip.contentFingerprint === provenance.outputFingerprint) continue;

    const sourceItemId = item.sourceItemId ?? item.id;
    const currentSourceValue = currentTranscriptSourceValue(item);
    const proposedRecord: TranscriptSourceReviewRecord = {
      schemaVersion: 1 as const,
      status: 'pending-review' as const,
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId,
      sourceFingerprintAtGeneration: provenance.sourceFingerprint,
      currentSourceFingerprint: computeHostFingerprint(currentSourceValue),
      generatedOutputFingerprint: provenance.outputFingerprint,
      editedOutputFingerprint: clip.contentFingerprint,
      proposedText: clip.textContent,
      proposedTimelineStart: clip.at,
      proposedTimelineEnd: clip.at + clip.duration,
      generatorVersion: provenance.generatorVersion,
    };
    operations.push({
      op: 'project-data.write',
      target: extensionId,
      payload: {
        key: `${TRANSCRIPT_SOURCE_REVIEW_KEY_PREFIX}${encodeURIComponent(sourceItemId)}`,
        value: {
          ...proposedRecord,
          handoffFingerprint: transcriptSourceReviewHandoffFingerprint(proposedRecord),
        },
        mode: 'replace',
      },
      order: order++,
    });
  }
  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'transcript-caption-foundry/propose-source-updates',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      policy: 'propose-source-update',
      proposalCount: operations.length,
    },
    operations,
  };
}

/**
 * Resolve pending review records without mutating the read-only transcript
 * adapter. Acceptance is fail-closed: it produces an upstream-consumable
 * `accepted-for-source-update` record only while the source fingerprint still
 * matches the value inspected when the proposal was created. Missing or
 * changed source becomes an explicit conflict. Rejection is always durable.
 */
export function buildTranscriptSourceReviewDecisionPatch(
  snapshot: Pick<TimelineSnapshot, 'baseVersion' | 'app'>,
  items: readonly DataLaneRenderItem[],
  decision: TranscriptSourceReviewDecision,
  extensionId: string = TRANSCRIPT_LANE_EXTENSION_ID,
  options: TranscriptSourceReviewDecisionOptions = {},
): TimelinePatch {
  const itemBySourceId = new Map(
    items.map((item) => [item.sourceItemId ?? item.id, item]),
  );
  const requestedSourceIds = options.sourceItemIds
    ? new Set(options.sourceItemIds)
    : undefined;
  const operations: TimelinePatchOperation[] = [];
  let acceptedCount = 0;
  let rejectedCount = 0;
  let conflictCount = 0;

  for (const { key, value } of readTranscriptSourceReviews(snapshot, extensionId)) {
    if (value.status !== 'pending-review') continue;
    if (requestedSourceIds && !requestedSourceIds.has(value.sourceItemId)) continue;
    let nextValue: TranscriptSourceReviewRecord;
    if (decision === 'reject') {
      rejectedCount += 1;
      nextValue = {
        ...value,
        status: 'rejected',
        decisionRevision: snapshot.baseVersion,
      };
    } else {
      const item = itemBySourceId.get(value.sourceItemId);
      if (!item) {
        conflictCount += 1;
        nextValue = {
          ...value,
          status: 'source-conflict',
          conflictReason: 'source-item-missing',
          decisionRevision: snapshot.baseVersion,
        };
      } else {
        const resolvedSourceFingerprint = computeHostFingerprint(
          currentTranscriptSourceValue(item),
        );
        if (resolvedSourceFingerprint !== value.currentSourceFingerprint) {
          conflictCount += 1;
          nextValue = {
            ...value,
            status: 'source-conflict',
            conflictReason: 'source-changed-after-proposal',
            resolvedSourceFingerprint,
            decisionRevision: snapshot.baseVersion,
          };
        } else {
          acceptedCount += 1;
          nextValue = {
            ...value,
            status: 'accepted-for-source-update',
            handoffFingerprint: value.handoffFingerprint
              ?? transcriptSourceReviewHandoffFingerprint(value),
            resolvedSourceFingerprint,
            decisionRevision: snapshot.baseVersion,
          };
        }
      }
    }
    operations.push({
      op: 'project-data.write',
      target: extensionId,
      payload: { key, value: nextValue, mode: 'replace' },
      order: operations.length,
    });
  }

  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'transcript-caption-foundry/review-decision',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      policy: 'upstream-consumes-accepted-records',
      decision,
      acceptedCount,
      rejectedCount,
      conflictCount,
      scope: requestedSourceIds ? 'selected-records' : 'all-pending-records',
    },
    operations,
  };
}

/**
 * Record the upstream owner's explicit consumption acknowledgement.
 *
 * This function only updates the extension-owned handoff record. It cannot
 * mutate the transcript adapter or infer application from an accepted record.
 * The owner must bind its acknowledgement to the exact handoff fingerprint
 * and report the source revision/fingerprint it actually applied.
 */
export function buildTranscriptSourceConsumptionAcknowledgementPatch(
  snapshot: Pick<TimelineSnapshot, 'baseVersion' | 'app'>,
  acknowledgements: readonly TranscriptSourceConsumptionAcknowledgement[],
  extensionId: string = TRANSCRIPT_LANE_EXTENSION_ID,
): TimelinePatch {
  const records = readTranscriptSourceReviews(snapshot, extensionId);
  const recordBySourceId = new Map(records.map((entry) => [entry.value.sourceItemId, entry]));
  const operations: TimelinePatchOperation[] = [];
  const seenSourceIds = new Set<string>();
  let acknowledgedCount = 0;
  let idempotentCount = 0;
  let ignoredCount = 0;
  let conflictCount = 0;

  for (const acknowledgement of acknowledgements) {
    const validRevision = (
      typeof acknowledgement.sourceRevision === 'string'
      && acknowledgement.sourceRevision.trim() !== ''
    ) || (
      typeof acknowledgement.sourceRevision === 'number'
      && Number.isFinite(acknowledgement.sourceRevision)
    );
    if (
      acknowledgement.sourceItemId.trim() === ''
      || acknowledgement.sourceItemId !== acknowledgement.sourceItemId.trim()
      || acknowledgement.ownerId.trim() === ''
      || acknowledgement.ownerId !== acknowledgement.ownerId.trim()
      || acknowledgement.ownerId.length > 128
      || acknowledgement.handoffFingerprint.trim() === ''
      || acknowledgement.handoffFingerprint !== acknowledgement.handoffFingerprint.trim()
      || acknowledgement.appliedSourceFingerprint.trim() === ''
      || acknowledgement.appliedSourceFingerprint !== acknowledgement.appliedSourceFingerprint.trim()
      || !validRevision
      || seenSourceIds.has(acknowledgement.sourceItemId)
    ) {
      conflictCount += 1;
      continue;
    }
    seenSourceIds.add(acknowledgement.sourceItemId);
    const entry = recordBySourceId.get(acknowledgement.sourceItemId);
    if (!entry) {
      ignoredCount += 1;
      continue;
    }
    const { key, value } = entry;
    const expectedHandoff = value.handoffFingerprint
      ?? transcriptSourceReviewHandoffFingerprint(value);
    if (value.status === 'acknowledged-by-source-owner') {
      const existing = value.acknowledgement;
      if (
        existing?.ownerId === acknowledgement.ownerId
        && existing.handoffFingerprint === acknowledgement.handoffFingerprint
        && existing.sourceRevision === acknowledgement.sourceRevision
        && existing.appliedSourceFingerprint === acknowledgement.appliedSourceFingerprint
      ) {
        idempotentCount += 1;
      } else {
        conflictCount += 1;
      }
      continue;
    }
    if (value.status !== 'accepted-for-source-update') {
      ignoredCount += 1;
      continue;
    }
    if (acknowledgement.handoffFingerprint !== expectedHandoff) {
      conflictCount += 1;
      continue;
    }
    const nextValue: TranscriptSourceReviewRecord = {
      ...value,
      status: 'acknowledged-by-source-owner',
      handoffFingerprint: expectedHandoff,
      acknowledgement: {
        schemaVersion: 1,
        ownerId: acknowledgement.ownerId,
        handoffFingerprint: acknowledgement.handoffFingerprint,
        sourceRevision: acknowledgement.sourceRevision,
        appliedSourceFingerprint: acknowledgement.appliedSourceFingerprint,
        acknowledgedAtRevision: snapshot.baseVersion,
      },
    };
    operations.push({
      op: 'project-data.write',
      target: extensionId,
      payload: { key, value: nextValue, mode: 'replace' },
      order: operations.length,
    });
    acknowledgedCount += 1;
  }

  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'transcript-caption-foundry/source-owner-acknowledgement',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      policy: 'source-owner-must-acknowledge-consumption',
      acknowledgedCount,
      idempotentCount,
      ignoredCount,
      conflictCount,
    },
    operations,
  };
}

function renderTranscriptAsCaptions(
  ctx: ExtensionContext,
  items: readonly DataLaneRenderItem[],
  mode: TranscriptCaptionMaterializeMode = 'preserve',
): void {
  const snapshot = ctx.creative.reader.snapshot();
  const patch = buildTranscriptCaptionPatch(snapshot, items, ctx.extension.id as string, { mode });
  // An idempotent preserve pass intentionally produces no operations when all
  // deterministic captions already exist. Empty patches are invalid at the
  // host boundary, so handle the successful no-op before asking it to validate.
  if (patch.operations.length === 0) {
    ctx.chrome.toast('Transcript caption clips already exist; existing edits were preserved.', 'info');
    return;
  }
  const validation = ctx.creative.timeline.validate(patch);
  if (!validation.valid) {
    throw new Error(`Transcript caption patch rejected: ${validation.diagnostics.map((item) => item.message).join('; ')}`);
  }
  ctx.creative.timeline.apply(patch);
  const captionCount = patch.operations.filter((operation) => operation.op === 'clip.update').length;
  ctx.chrome.toast(`Rendered ${captionCount} editable transcript caption clip(s).`, 'info');
}

function proposeTranscriptSourceUpdates(
  ctx: ExtensionContext,
  items: readonly DataLaneRenderItem[],
): void {
  const patch = buildTranscriptSourceReviewPatch(
    ctx.creative.reader.snapshot(),
    items,
    ctx.extension.id as string,
  );
  if (patch.operations.length === 0) {
    ctx.chrome.toast('No human-edited generated captions need transcript review.', 'info');
    return;
  }
  const validation = ctx.creative.timeline.validate(patch);
  if (!validation.valid) {
    throw new Error(`Transcript review patch rejected: ${validation.diagnostics.map((item) => item.message).join('; ')}`);
  }
  ctx.creative.timeline.apply(patch);
  ctx.chrome.toast(`Created ${patch.operations.length} transcript source review proposal(s).`, 'info');
}

function decideTranscriptSourceUpdates(
  ctx: ExtensionContext,
  items: readonly DataLaneRenderItem[],
  decision: TranscriptSourceReviewDecision,
  options: TranscriptSourceReviewDecisionOptions = {},
): TimelinePatch | undefined {
  const patch = buildTranscriptSourceReviewDecisionPatch(
    ctx.creative.reader.snapshot(),
    items,
    decision,
    ctx.extension.id as string,
    options,
  );
  if (patch.operations.length === 0) {
    ctx.chrome.toast('No pending transcript source review proposals.', 'info');
    return undefined;
  }
  const validation = ctx.creative.timeline.validate(patch);
  if (!validation.valid) {
    throw new Error(`Transcript review decision rejected: ${validation.diagnostics.map((item) => item.message).join('; ')}`);
  }
  ctx.creative.timeline.apply(patch);
  const accepted = Number(patch.meta?.acceptedCount ?? 0);
  const rejected = Number(patch.meta?.rejectedCount ?? 0);
  const conflicts = Number(patch.meta?.conflictCount ?? 0);
  ctx.chrome.toast(
    `Transcript review resolved: ${accepted} accepted, ${rejected} rejected, ${conflicts} conflict(s).`,
    conflicts > 0 ? 'warning' : 'info',
  );
  return patch;
}

interface TranscriptSourceReviewInspectorProps {
  readonly ctx: ExtensionContext;
  readonly inspectorProps: DataItemInspectorProps;
}

function reviewStatusLabel(record: TranscriptSourceReviewRecord): string {
  switch (record.status) {
    case 'pending-review':
      return 'Pending individual review';
    case 'accepted-for-source-update':
      return 'Accepted for source update — awaiting upstream acknowledgement';
    case 'acknowledged-by-source-owner':
      return `Applied acknowledgement received from ${record.acknowledgement?.ownerId ?? 'upstream owner'}`;
    case 'rejected':
      return 'Rejected';
    case 'source-conflict':
      return `Source conflict: ${record.conflictReason ?? 'source no longer matches'}`;
  }
}

function TranscriptSourceReviewInspector({
  ctx,
  inspectorProps,
}: TranscriptSourceReviewInspectorProps): ReactNode {
  const [, setRefreshRevision] = useState(0);
  const sourceItemId = inspectorProps.item.sourceItemId ?? inspectorProps.item.id;
  const snapshot = ctx.creative.reader.snapshot();
  const record = readTranscriptSourceReviews(
    snapshot,
    ctx.extension.id as string,
  ).find((entry) => entry.value.sourceItemId === sourceItemId)?.value;

  const decide = useCallback((decision: TranscriptSourceReviewDecision) => {
    decideTranscriptSourceUpdates(
      ctx,
      [inspectorProps.item],
      decision,
      { sourceItemIds: [sourceItemId] },
    );
    // Timeline apply is synchronous for this host contract. The editor store
    // also re-renders the inspector, while this bump makes isolated hosts and
    // tests immediately re-read the durable snapshot.
    setRefreshRevision((current) => current + 1);
  }, [ctx, inspectorProps.item, sourceItemId]);

  const reviewBody = record
    ? createElement(
      'div',
      { style: { display: 'grid', gap: 6 } },
      createElement(
        'div',
        {
          role: 'status',
          'aria-live': 'polite',
          'data-testid': 'transcript-review-status',
          'data-review-status': record.status,
          style: { fontWeight: 600 },
        },
        reviewStatusLabel(record),
      ),
      createElement(
        'dl',
        { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', margin: 0 } },
        createElement('dt', { style: { color: 'var(--muted-foreground)' } }, 'Current source'),
        createElement('dd', { 'data-testid': 'transcript-review-source', style: { margin: 0, whiteSpace: 'pre-wrap' } }, readChipText(inspectorProps.item.payload)),
        createElement('dt', { style: { color: 'var(--muted-foreground)' } }, 'Proposed output'),
        createElement('dd', { 'data-testid': 'transcript-review-proposed', style: { margin: 0, whiteSpace: 'pre-wrap' } }, record.proposedText),
        createElement('dt', { style: { color: 'var(--muted-foreground)' } }, 'Proposed timing'),
        createElement('dd', { style: { margin: 0 } }, `${record.proposedTimelineStart.toFixed(2)}s – ${record.proposedTimelineEnd.toFixed(2)}s`),
        ...(record.acknowledgement
          ? [
              createElement('dt', { key: 'ack-label', style: { color: 'var(--muted-foreground)' } }, 'Source revision'),
              createElement('dd', { key: 'ack-value', style: { margin: 0 } }, String(record.acknowledgement.sourceRevision)),
            ]
          : []),
      ),
      record.status === 'pending-review'
        ? createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'transcript-review-accept',
              'aria-label': `Accept proposed transcript update for ${sourceItemId}`,
              title: 'Accept this proposal for upstream source consumption',
              onClick: () => decide('accept'),
            },
            'Accept this proposal',
          ),
          createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'transcript-review-reject',
              'aria-label': `Reject proposed transcript update for ${sourceItemId}`,
              title: 'Reject this proposal without changing transcript source',
              onClick: () => decide('reject'),
            },
            'Reject this proposal',
          ),
        )
        : null,
      record.status === 'accepted-for-source-update'
        ? createElement(
          'p',
          { 'data-testid': 'transcript-review-awaiting-ack', style: { margin: 0 } },
          'The caption edit is accepted as a handoff only. It is not applied until the upstream source owner acknowledges consumption.',
        )
        : null,
    )
    : createElement(
      'p',
      { 'data-testid': 'transcript-review-empty', style: { margin: 0 } },
      'No source update proposal exists for this transcript item.',
    );

  return createElement(
    'div',
    { style: { display: 'grid', gap: 10 } },
    renderTranscriptItemInspector(inspectorProps) as ReactNode,
    createElement(
      'section',
      {
        role: 'region',
        'aria-label': `Transcript proposal review for ${sourceItemId}`,
        'data-testid': 'transcript-source-review-inspector',
        style: { display: 'grid', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 11 },
      },
      createElement('h4', { style: { margin: 0, fontSize: 11 } }, 'Source update review'),
      reviewBody,
    ),
  );
}

export function renderTranscriptSourceReviewInspector(
  ctx: ExtensionContext,
  props: DataItemInspectorProps,
): unknown {
  return createElement(TranscriptSourceReviewInspector, { ctx, inspectorProps: props });
}

// ---------------------------------------------------------------------------
// Extension definition
// ---------------------------------------------------------------------------

export const transcriptLaneExtension: ReighExtension = defineExtension({
  manifest: {
    id: TRANSCRIPT_LANE_EXTENSION_ID,
    version: TRANSCRIPT_EXTENSION_VERSION,
    apiVersion: 1,
    license: 'MIT',
    label: 'Transcript Caption Foundry',
    description:
      'Renders host-adapted transcript segments as readable timed text and can '
      + 'materialize them as editable built-in video text clips.',
    contributions: [
      {
        id: 'transcript-lane-kind' as ContributionId,
        kind: 'dataKind',
        kindId: TRANSCRIPT_KIND_ID,
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        shape: 'interval',
        domain: 'source_seconds',
        label: 'Transcript',
        order: 10,
      },
    ],
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    // Single bind model (clipType analog): the manifest DECLARED the kind;
    // activation BINDS its renderers into the host DataKindRegistry through
    // the gated ctx.dataKinds service. An undeclared kindId here would emit
    // `dataKinds/undeclared-kind` and no-op.
    const handle = ctx.dataKinds.register(
      TRANSCRIPT_KIND_ID,
      renderTranscriptLane,
      (props) => renderTranscriptSourceReviewInspector(ctx, props),
      {
        supportsSparseItemWindows: true,
        actions: [
          {
            id: 'create-caption-clips',
            label: 'Add missing',
            ariaLabel: 'Render transcript as editable video text',
            title: 'Create missing editable video text clips and preserve existing edits',
            invoke: (items) => renderTranscriptAsCaptions(ctx, items, 'preserve'),
          },
          {
            id: 'regenerate-caption-clips',
            label: 'Regenerate',
            ariaLabel: 'Regenerate transcript captions and replace edits',
            title: 'Explicitly regenerate caption clips, replacing human edits',
            invoke: (items) => renderTranscriptAsCaptions(ctx, items, 'regenerate'),
          },
          {
            id: 'propose-source-updates',
            label: 'Propose edits',
            ariaLabel: 'Propose caption edits back to transcript source',
            title: 'Create review proposals from human-edited caption text',
            invoke: (items) => proposeTranscriptSourceUpdates(ctx, items),
          },
          {
            id: 'accept-source-updates',
            label: 'Accept proposals',
            ariaLabel: 'Accept pending caption edits for transcript source update',
            title: 'Accept only proposals whose transcript source has not changed',
            invoke: (items) => decideTranscriptSourceUpdates(ctx, items, 'accept'),
          },
          {
            id: 'reject-source-updates',
            label: 'Reject proposals',
            ariaLabel: 'Reject pending caption edits for transcript source update',
            title: 'Reject all pending transcript source update proposals',
            invoke: (items) => decideTranscriptSourceUpdates(ctx, items, 'reject'),
          },
        ],
      },
    );

    return {
      dispose(): void {
        handle.dispose();
      },
    };
  },
});
