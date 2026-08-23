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

import { defineExtension } from '@reigh/editor-sdk';
import type {
  ContributionId,
  DataLaneRenderItem,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
  TimelinePatch,
  TimelinePatchOperation,
  TimelineSnapshot,
} from '@reigh/editor-sdk';
import {
  readChipText,
  renderTranscriptItemInspector,
  renderTranscriptLane,
} from './TranscriptLaneView';

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

const MAX_CAPTION_SEGMENTS = 512;
const MIN_CAPTION_DURATION_SECONDS = 0.1;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function transcriptCaptionClipId(itemId: string): string {
  return `transcript-caption-${stableHash(itemId)}`;
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
): TimelinePatch {
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
    .slice(0, MAX_CAPTION_SEGMENTS);
  const existingClipIds = new Set(snapshot.clips.map((clip) => clip.id));
  const operations: TimelinePatchOperation[] = [];
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

  for (const item of normalized) {
    const clipId = transcriptCaptionClipId(item.id);
    const text = readChipText(item.payload).trim();
    const duration = Math.max(
      MIN_CAPTION_DURATION_SECONDS,
      item.timelineEnd - item.timelineStart,
    );
    if (existingClipIds.has(clipId)) continue;
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
    operations.push({
      op: 'clip.update',
      target: clipId,
      payload: {
        track: TRANSCRIPT_CAPTION_TRACK_ID,
        at: item.timelineStart,
        hold: duration,
        ...captionBox,
        text: {
          content: text,
          fontSize: Math.max(28, Math.round(compositionHeight * 0.067)),
          color: '#ffffff',
          bold: true,
          align: 'center',
        },
        label: text.length > 48 ? `${text.slice(0, 47)}…` : text,
        mode: 'merge',
      },
      order: order++,
    });
  }

  return {
    version: snapshot.baseVersion,
    source: extensionId,
    meta: {
      kind: 'transcript-caption-foundry/render-as-video-text',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      oneWaySourceToCaptions: true,
    },
    operations,
  };
}

function renderTranscriptAsCaptions(
  ctx: ExtensionContext,
  items: readonly DataLaneRenderItem[],
): void {
  const snapshot = ctx.creative.reader.snapshot();
  const patch = buildTranscriptCaptionPatch(snapshot, items, ctx.extension.id as string);
  const validation = ctx.creative.timeline.validate(patch);
  if (!validation.valid) {
    throw new Error(`Transcript caption patch rejected: ${validation.diagnostics.map((item) => item.message).join('; ')}`);
  }
  if (patch.operations.length === 0) {
    ctx.chrome.toast('Transcript caption clips already exist; existing edits were preserved.', 'info');
    return;
  }
  ctx.creative.timeline.apply(patch);
  const captionCount = patch.operations.filter((operation) => operation.op === 'clip.update').length;
  ctx.chrome.toast(`Rendered ${captionCount} editable transcript caption clip(s).`, 'success');
}

// ---------------------------------------------------------------------------
// Extension definition
// ---------------------------------------------------------------------------

export const transcriptLaneExtension: ReighExtension = defineExtension({
  manifest: {
    id: TRANSCRIPT_LANE_EXTENSION_ID,
    version: '1.0.0',
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
      (props) => renderTranscriptLane(
        props,
        (items) => renderTranscriptAsCaptions(ctx, items),
      ),
      renderTranscriptItemInspector,
    );

    return {
      dispose(): void {
        handle.dispose();
      },
    };
  },
});
