/**
 * Output format placeholder adapter.
 *
 * Wraps {@link buildOutputFormatDescriptors} as a delegated
 * HostFamilyAdapter so output formats continue to surface planner-ready
 * descriptors while execution remains reserved.
 *
 * @module families/outputFormatAdapter
 */

import { createPlaceholderAdapter } from './placeholderAdapterFactory';
import { buildOutputFormatDescriptors } from './projectors/outputFormatProjector';
import { toCollectedContributions } from './familyAdapterUtils';

export const outputFormatAdapter = createPlaceholderAdapter(
  'outputFormat',
  ({ contributions, extensionOrder }) => ({
    descriptors: buildOutputFormatDescriptors(toCollectedContributions(contributions), extensionOrder),
  }),
  {
    description: 'Delegated placeholder for output format projection.',
    owner: 'video-editor-runtime',
    reason: 'Output format execution is reserved for M12; only declaration-time planner descriptors are projected in M6.',
    expiration: 'M12',
  },
);
