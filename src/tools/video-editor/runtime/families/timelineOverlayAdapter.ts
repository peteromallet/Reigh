/**
 * Timeline overlay real compatibility adapter.
 *
 * Preserves M2 host-integrated timeline overlay behavior through the
 * dedicated {@link buildTimelineOverlayDescriptors} projector: it projects
 * `{ extensionId, id, renderId, order }` directly from collected
 * contributions and never fabricates callable renderers or `render: null`
 * placeholders.
 *
 * @module families/timelineOverlayAdapter
 */

import type {
  HostFamilyAdapter,
  HostAdapterManifest,
  NormalizeFamilyInput,
  FamilyNormalizeResult,
  FamilyConformanceReport,
  ExecutionMaturity,
  TimelineOverlayDescriptor,
} from '@reigh/editor-sdk';
import { getVideoFamilyDefinition } from '@reigh/editor-sdk';
import { buildTimelineOverlayDescriptors } from './projectors/timelineOverlayProjector';
import { toCollectedContributions } from './familyAdapterUtils';
import { buildConformanceReport } from '@/sdk/core/families/conformance';

const MANIFEST: HostAdapterManifest = Object.freeze({
  adapterId: 'timelineOverlay-default',
  kind: 'timelineOverlay',
  version: '1.0.0',
  maturity: 'host-integrated' as ExecutionMaturity,
  description: 'Compatibility adapter for M2 timeline overlay contributions (dedicated projector).',
  metadata: Object.freeze({ classification: 'real' }),
});

export const timelineOverlayAdapter: HostFamilyAdapter<
  'timelineOverlay',
  unknown,
  TimelineOverlayDescriptor
> = Object.freeze({
  kind: 'timelineOverlay' as const,
  classification: 'real',
  manifest: MANIFEST,

  normalize(
    input: NormalizeFamilyInput<unknown>,
  ): FamilyNormalizeResult<TimelineOverlayDescriptor> {
    const descriptors = buildTimelineOverlayDescriptors(
      toCollectedContributions(input.contributions),
      input.extensionOrder,
    );
    return {
      descriptors,
    };
  },

  buildConformanceReport(): FamilyConformanceReport<'timelineOverlay'> {
    const definition = getVideoFamilyDefinition('timelineOverlay');
    if (!definition) {
      throw new Error('timelineOverlayAdapter: family definition not found for kind "timelineOverlay".');
    }
    return buildConformanceReport(definition);
  },
});
