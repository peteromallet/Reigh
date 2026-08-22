/**
 * transcript-lane — dev-local dataKind example (dataKind V1, kind 22).
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
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
} from '@reigh/editor-sdk';
import { renderTranscriptItemInspector, renderTranscriptLane } from './TranscriptLaneView';

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

// ---------------------------------------------------------------------------
// Extension definition
// ---------------------------------------------------------------------------

export const transcriptLaneExtension: ReighExtension = defineExtension({
  manifest: {
    id: TRANSCRIPT_LANE_EXTENSION_ID,
    version: '1.0.0',
    apiVersion: 1,
    license: 'MIT',
    label: 'Transcript Lane',
    description:
      'Dev example for the dataKind family: renders host-adapted transcript '
      + 'segments as a duration-neutral lane under the timeline tracks.',
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
      renderTranscriptItemInspector,
    );

    return {
      dispose(): void {
        handle.dispose();
      },
    };
  },
});
