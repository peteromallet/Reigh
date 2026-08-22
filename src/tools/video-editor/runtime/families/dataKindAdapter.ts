/**
 * Data kind real compatibility adapter.
 *
 * @module families/dataKindAdapter
 */

import { createCompatibilityAdapter } from './compatibilityAdapterFactory';

export const dataKindAdapter = createCompatibilityAdapter({
  adapterId: 'dataKind-default',
  kind: 'dataKind',
  maturity: 'host-integrated',
  description:
    'Compatibility adapter for dataKind contributions — lane state binds via ' +
    'the host DataKindRegistry, so no descriptors are projected.',
});
