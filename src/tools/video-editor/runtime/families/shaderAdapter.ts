/**
 * Shader placeholder adapter.
 *
 * Wraps {@link buildShaderDescriptors} as a delegated HostFamilyAdapter.
 *
 * @module families/shaderAdapter
 */

import { createPlaceholderAdapter } from './placeholderAdapterFactory';
import { buildShaderDescriptors } from './projectors/shaderProjector';
import { toCollectedContributions } from './familyAdapterUtils';

export const shaderAdapter = createPlaceholderAdapter(
  'shader',
  ({ contributions, extensionOrder }) => buildShaderDescriptors(toCollectedContributions(contributions), extensionOrder),
  {
    description: 'Delegated placeholder for shader descriptor projection.',
    owner: 'video-editor-runtime',
    reason: 'Shader descriptor projection is delegated pending a dedicated real adapter.',
    expiration: 'M13',
  },
);
