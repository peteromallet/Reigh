import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Incompatible API fixture.
 *
 * The manifest declares `apiVersion: "2.0.0"` which does not match the
 * runtime's `RUNTIME_API_VERSION` ("1.0.0") under same-major semver
 * matching. The loader should reject this package with an
 * `api_version_mismatch` diagnostic.
 */
export const incompatibleApiPackage: ExtensionPackage = {
  manifest: {
    id: 'com.example.incompatible',
    name: 'Incompatible API Extension',
    version: '1.0.0',
    apiVersion: '2.0.0',
    description: 'Fixture whose apiVersion is incompatible with the runtime.',
  },
  config: {},
};
