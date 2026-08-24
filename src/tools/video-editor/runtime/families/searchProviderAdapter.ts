/**
 * Search provider placeholder adapter.
 *
 * Wraps {@link buildSearchProviderDescriptors} as a delegated HostFamilyAdapter.
 *
 * @module families/searchProviderAdapter
 */

import { createPlaceholderAdapter } from './placeholderAdapterFactory';
import { buildSearchProviderDescriptors } from './projectors/searchProviderProjector';
import { toCollectedContributions } from './familyAdapterUtils';

export const searchProviderAdapter = createPlaceholderAdapter(
  'searchProvider',
  ({ contributions, extensionOrder }) => ({
    descriptors: buildSearchProviderDescriptors(toCollectedContributions(contributions), extensionOrder),
  }),
  {
    description: 'Delegated placeholder for search provider projection.',
    owner: 'video-editor-runtime',
    reason: 'Search provider execution is reserved for M6/M12; only declaration descriptors are surfaced.',
    expiration: 'M12',
  },
);
