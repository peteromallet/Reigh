import { defineExtension } from '@reigh/editor-sdk';
import type { ContributionId, ExtensionId, ReighExtension } from '@reigh/editor-sdk';
import { renderRunawayTimelineLane, renderRunawayTransitionInspector } from './RunawayTimelineLaneView';
import { RUNAWAY_KIND_ID, RUNAWAY_SCHEMA_REF } from './runawayTimelineData';

export const RUNAWAY_TIMELINE_EXTENSION_ID = 'com.reigh.astrid-runaway-timeline' as ExtensionId;

export const runawayTimelineExtension: ReighExtension = defineExtension({
  manifest: {
    id: RUNAWAY_TIMELINE_EXTENSION_ID,
    version: '1.0.0',
    apiVersion: 1,
    license: 'MIT',
    label: 'Astrid Runaway Timeline',
    description: 'Views Astrid typed Runaway transition timing, prompts, colour regions, and run/task provenance as a selectable interval lane.',
    contributions: [{
      id: 'runaway-transition-kind' as ContributionId,
      kind: 'dataKind',
      kindId: RUNAWAY_KIND_ID,
      schemaRef: RUNAWAY_SCHEMA_REF,
      shape: 'interval',
      domain: 'timeline_seconds',
      label: 'Runaway transitions',
      order: 20,
    }],
  },
  activate(ctx) {
    return ctx.dataKinds.register(
      RUNAWAY_KIND_ID,
      renderRunawayTimelineLane,
      renderRunawayTransitionInspector,
      { supportsSparseItemWindows: true },
    );
  },
});
