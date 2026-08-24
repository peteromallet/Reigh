/**
 * Parser placeholder adapter.
 *
 * Wraps {@link buildParserDescriptors} as a delegated HostFamilyAdapter.
 *
 * @module families/parserAdapter
 */

import { createPlaceholderAdapter } from './placeholderAdapterFactory';
import { buildParserDescriptors } from './projectors/parserProjector';
import { toCollectedContributions } from './familyAdapterUtils';

export const parserAdapter = createPlaceholderAdapter(
  'parser',
  ({ contributions, extensionOrder }) => ({
    descriptors: buildParserDescriptors(toCollectedContributions(contributions), extensionOrder),
  }),
  {
    description: 'Delegated placeholder for parser descriptor projection.',
    owner: 'video-editor-runtime',
    reason: 'Parser descriptor projection is delegated pending a dedicated real adapter.',
    expiration: 'M6',
  },
);
