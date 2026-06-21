import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Invalid package fixture.
 *
 * The manifest is missing the required `name` field, so schema validation
 * produces a `manifest_schema_invalid` diagnostic. This lets acceptance
 * tests verify that invalid packages are rejected and reported through
 * the diagnostics UI without crashing the editor.
 */
export const invalidPackage: ExtensionPackage = {
  manifest: {
    // Intentional: missing `name` — required by schema
    id: 'com.example.invalid',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Fixture with an intentionally invalid manifest (missing name).',
  } as any,
  config: {},
};
