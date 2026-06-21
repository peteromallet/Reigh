import { describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ReactNode } from 'react';
import {
  validateManifestSchema,
  validateApiVersionCompatibility,
  validateManifestPermissions,
  validateDuplicateContributionIdsAcrossCollections,
  validateContributionDescriptorMatch,
  validateExtensionPackage,
  isValidPackage,
  filterValidPackages,
} from './extensionManifest.ts';
import type {
  ExtensionManifest,
  ExtensionPackage,
} from './extensionManifest.ts';
import type {
  VideoEditorExtensionConfig,
  VideoEditorRenderContext,
} from './extensionSurface.ts';

// ---------------------------------------------------------------------------
// Load schema
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = resolve(
  __dirname,
  '../../../../config/contracts/reigh-extension.schema.json',
);
const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schemaJson);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid manifest that passes the schema. */
function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'com.example.test-extension',
    name: 'Test Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    ...overrides,
  };
}

/** Run validation and return errors summary for inspection. */
function validateManifest(manifest: unknown): { valid: boolean; errors: string | null } {
  const valid = validate(manifest);
  if (valid) return { valid: true, errors: null };
  const messages = (validate.errors ?? [])
    .map((e) => `${e.instancePath} ${e.message}`)
    .join('; ');
  return { valid: false, errors: messages };
}

// Re-validate after each test to ensure isolate (AJV compile is stateful for
// some keyword caches, but standard validate() call is pure).
afterEach(() => {
  // no-op — validate() is stateless
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reigh-extension.schema.json validation', () => {
  // ---- valid manifest ----

  it('accepts a complete valid manifest', () => {
    const manifest = validManifest({
      description: 'A test extension.',
      author: 'Test Author',
      permissions: ['timeline:read', 'assets:read'],
      settingsSchema: {
        type: 'object',
        properties: { debug: { type: 'boolean', default: false } },
      },
      contributions: {
        slots: [{ slot: 'toolbar', id: 'my-toolbar-button' }],
        dialogs: [{ id: 'my-dialog' }],
        panels: [{ id: 'my-panel' }],
        inspectorSections: [{ id: 'my-section', placement: 'before-default' }],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(true);
    // No extra detail needed if valid
  });

  it('accepts a minimal valid manifest (only required fields)', () => {
    const manifest = validManifest();
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  // ---- missing required fields ----

  it('rejects a manifest missing id', () => {
    const { id: _id, ...noId } = validManifest();
    const { valid, errors } = validateManifest(noId);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('id');
  });

  it('rejects a manifest missing name', () => {
    const { name: _name, ...noName } = validManifest();
    const { valid, errors } = validateManifest(noName);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('name');
  });

  it('rejects a manifest missing version', () => {
    const { version: _ver, ...noVersion } = validManifest();
    const { valid, errors } = validateManifest(noVersion);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('version');
  });

  it('rejects a manifest missing apiVersion', () => {
    const { apiVersion: _api, ...noApiVersion } = validManifest();
    const { valid, errors } = validateManifest(noApiVersion);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('apiVersion');
  });

  // ---- malformed semver ----

  it('rejects a manifest with malformed semver version (non-numeric)', () => {
    const { valid, errors } = validateManifest(
      validManifest({ version: 'not-a-version' }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a manifest with partial semver version (missing patch)', () => {
    const { valid, errors } = validateManifest(
      validManifest({ version: '1.0' }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a manifest with leading zero in semver version', () => {
    const { valid, errors } = validateManifest(
      validManifest({ version: '01.0.0' }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a manifest with malformed semver apiVersion', () => {
    const { valid, errors } = validateManifest(
      validManifest({ apiVersion: 'v1.0' }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('accepts a valid pre-release semver tag', () => {
    const { valid } = validateManifest(
      validManifest({ version: '2.0.0-beta.1' }),
    );
    expect(valid).toBe(true);
  });

  it('accepts a valid build metadata semver tag', () => {
    const { valid } = validateManifest(
      validManifest({ version: '2.0.0+20210101' }),
    );
    expect(valid).toBe(true);
  });

  // ---- unknown permission strings ----

  it('rejects a manifest with an unknown permission string', () => {
    const { valid, errors } = validateManifest(
      validManifest({ permissions: ['timeline:read', 'unknown:perm'] }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });

  it('rejects a manifest with a completely unknown permission string', () => {
    const { valid, errors } = validateManifest(
      validManifest({ permissions: ['superuser:admin'] }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });

  it('accepts a manifest with only allowed permissions', () => {
    const { valid } = validateManifest(
      validManifest({
        permissions: ['timeline:read', 'timeline:write', 'assets:read', 'assets:write'],
      }),
    );
    expect(valid).toBe(true);
  });

  it('accepts a manifest with no permissions', () => {
    const { valid } = validateManifest(validManifest({ permissions: undefined }));
    expect(valid).toBe(true);
  });

  // ---- unknown contribution keys ----

  it('rejects a manifest with unknown contribution collection keys', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          slots: [{ slot: 'toolbar', id: 'my-button' }],
          unknownCollection: [{ id: 'thing' }],
        },
      }),
    );
    expect(valid).toBe(false);
    // additionalProperties: false on contributions
    expect(errors).toContain('must NOT have additional properties');
  });

  it('rejects a manifest with an unknown top-level property', () => {
    const { valid, errors } = validateManifest(
      validManifest({ unknownField: 'should-not-be-here' }),
    );
    expect(valid).toBe(false);
    // additionalProperties: false on root
    expect(errors).toContain('must NOT have additional properties');
  });

  // ---- invalid contribution shapes ----

  it('rejects a slot contribution missing the slot name', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          slots: [{ id: 'no-slot' }], // missing required "slot"
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('slot');
  });

  it('rejects a slot contribution with an invalid slot name', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          slots: [{ slot: 'nonexistentSlot', id: 'bad-slot' }],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });

  it('rejects a dialog contribution missing the id', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          dialogs: [{ order: 1 }], // missing required "id"
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('id');
  });

  it('rejects an inspector section contribution missing placement', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          inspectorSections: [{ id: 'no-placement' }], // missing required "placement"
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('placement');
  });

  // ---- duplicate contribution IDs (where Ajv uniqueItems can detect) ----

  it('rejects duplicate slot contribution items within the same manifest', () => {
    // uniqueItems uses deep equality — items must be identical
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          slots: [
            { slot: 'toolbar', id: 'duplicate-id' },
            { slot: 'toolbar', id: 'duplicate-id' },
          ],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  it('rejects duplicate dialog contribution IDs within the same manifest', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          dialogs: [
            { id: 'dup' },
            { id: 'dup' },
          ],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  it('rejects duplicate panel contribution IDs within the same manifest', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          panels: [
            { id: 'dup' },
            { id: 'dup' },
          ],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  it('rejects duplicate inspector section contribution items within the same manifest', () => {
    // uniqueItems uses deep equality — items must be identical
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          inspectorSections: [
            { id: 'dup', placement: 'before-default' },
            { id: 'dup', placement: 'before-default' },
          ],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  // ---- duplicate permission entries (uniqueItems: true) ----

  it('rejects duplicate permission entries', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        permissions: ['timeline:read', 'timeline:read'],
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  // ---- id pattern ----

  it('rejects a manifest with an id containing invalid characters', () => {
    const { valid, errors } = validateManifest(
      validManifest({ id: 'Bad Extension!' }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('accepts a dot-separated extension id', () => {
    const { valid } = validateManifest(
      validManifest({ id: 'com.example.my-extension' }),
    );
    expect(valid).toBe(true);
  });

  it('accepts a simple single-segment id', () => {
    const { valid } = validateManifest(
      validManifest({ id: 'myextension' }),
    );
    expect(valid).toBe(true);
  });

  // ---- settingsSchema shape ----

  it('accepts a settingsSchema as a JSON Schema object', () => {
    const { valid } = validateManifest(
      validManifest({
        settingsSchema: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['light', 'dark'], default: 'light' },
          },
        },
      }),
    );
    expect(valid).toBe(true);
  });

  it('accepts settingsSchema as boolean true', () => {
    const { valid } = validateManifest(
      validManifest({ settingsSchema: true }),
    );
    expect(valid).toBe(true);
  });

  it('accepts settingsSchema as boolean false', () => {
    const { valid } = validateManifest(
      validManifest({ settingsSchema: false }),
    );
    expect(valid).toBe(true);
  });

  it('rejects settingsSchema that is not object or boolean', () => {
    const { valid, errors } = validateManifest(
      validManifest({ settingsSchema: 'not-a-schema' }),
    );
    expect(valid).toBe(false);
    // Should fail the oneOf constraint
    expect(errors).toContain('must match exactly one schema in oneOf');
  });

  // ---- dialog layer enum ----

  it('rejects a dialog contribution with an invalid layer', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          dialogs: [{ id: 'bad-layer', layer: 'popup' }],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });

  it('accepts a dialog contribution with a valid layer (modal)', () => {
    const { valid } = validateManifest(
      validManifest({
        contributions: {
          dialogs: [{ id: 'modal-dialog', layer: 'modal' }],
        },
      }),
    );
    expect(valid).toBe(true);
  });

  // ---- inspector section placement enum ----

  it('rejects an inspector section contribution with an invalid placement', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        contributions: {
          inspectorSections: [{ id: 'bad-placement', placement: 'inline' }],
        },
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });
});

// ---------------------------------------------------------------------------
// T4: Manifest/package validation tests (runtime validation functions)
// ---------------------------------------------------------------------------

/** No-op slot renderer for constructing test configs. */
function noopRenderer(_context: VideoEditorRenderContext): ReactNode {
  return null;
}

/** Build a test config with optional slot/dialog/panel/inspector registrations. */
function testConfig(overrides: Partial<VideoEditorExtensionConfig> = {}): VideoEditorExtensionConfig {
  return {
    slots: {},
    dialogHost: { dialogs: [] },
    registry: { panels: [], inspectorSections: [] },
    ...overrides,
  };
}

/** Build a valid manifest with overrides. */
function testManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'com.example.test-ext',
    name: 'Test Extension',
    version: '2.3.1',
    apiVersion: '1.0.0',
    ...overrides,
  };
}

/** Build a valid extension package. */
function testPackage(
  manifestOverrides: Partial<ExtensionManifest> = {},
  configOverrides: Partial<VideoEditorExtensionConfig> = {},
): ExtensionPackage {
  return {
    manifest: testManifest(manifestOverrides),
    config: testConfig(configOverrides),
  };
}

// ---- validateManifestSchema (runtime function) ----

describe('validateManifestSchema', () => {
  it('returns no diagnostics for a valid manifest', () => {
    const diags = validateManifestSchema(testManifest());
    expect(diags).toEqual([]);
  });

  it('returns diagnostics with code manifest_schema_invalid for a missing required field', () => {
    const { id: _, ...noId } = testManifest();
    const diags = validateManifestSchema(noId);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('manifest_schema_invalid');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].message).toContain('must have required property');
  });

  it('attaches extensionId when provided', () => {
    const { id: _, ...noId } = testManifest();
    const diags = validateManifestSchema(noId, 'com.example.other');
    expect(diags[0].extensionId).toBe('com.example.other');
  });

  it('includes detail with raw AJV errors', () => {
    const { id: _, ...noId } = testManifest();
    const diags = validateManifestSchema(noId);
    expect(diags[0].detail).toBeDefined();
    expect(Array.isArray(diags[0].detail)).toBe(true);
  });
});

// ---- validateApiVersionCompatibility ----

describe('validateApiVersionCompatibility', () => {
  it('accepts same-major API version (1.x.x)', () => {
    const manifest = testManifest({ apiVersion: '1.5.0' });
    expect(validateApiVersionCompatibility(manifest)).toEqual([]);
  });

  it('accepts exact runtime API version', () => {
    const manifest = testManifest({ apiVersion: '1.0.0' });
    expect(validateApiVersionCompatibility(manifest)).toEqual([]);
  });

  it('accepts pre-release same-major API version', () => {
    const manifest = testManifest({ apiVersion: '1.2.0-beta.3' });
    expect(validateApiVersionCompatibility(manifest)).toEqual([]);
  });

  it('rejects incompatible major version (2.x.x)', () => {
    const manifest = testManifest({ apiVersion: '2.0.0' });
    const diags = validateApiVersionCompatibility(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('api_version_incompatible');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].extensionId).toBe('com.example.test-ext');
    expect(diags[0].message).toContain('2');
    expect(diags[0].message).toContain('1');
  });

  it('rejects major version 0 when runtime is 1', () => {
    const manifest = testManifest({ apiVersion: '0.9.0' });
    const diags = validateApiVersionCompatibility(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('api_version_incompatible');
  });

  it('rejects malformed API version string', () => {
    const manifest = testManifest({ apiVersion: 'not-semver' });
    const diags = validateApiVersionCompatibility(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('api_version_incompatible');
    expect(diags[0].message).toContain('unknown');
  });

  it('rejects empty string API version', () => {
    const manifest = testManifest({ apiVersion: '' });
    const diags = validateApiVersionCompatibility(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('api_version_incompatible');
  });
});

// ---- validateManifestPermissions ----

describe('validateManifestPermissions', () => {
  it('returns no diagnostics for empty permissions', () => {
    const manifest = testManifest({ permissions: [] });
    expect(validateManifestPermissions(manifest)).toEqual([]);
  });

  it('returns no diagnostics for undefined permissions', () => {
    const manifest = testManifest({ permissions: undefined });
    expect(validateManifestPermissions(manifest)).toEqual([]);
  });

  it('returns no diagnostics for all allowed permissions', () => {
    const manifest = testManifest({
      permissions: ['timeline:read', 'assets:write'],
    });
    expect(validateManifestPermissions(manifest)).toEqual([]);
  });

  it('returns no diagnostics for single allowed permission', () => {
    const manifest = testManifest({ permissions: ['timeline:write'] });
    expect(validateManifestPermissions(manifest)).toEqual([]);
  });

  it('rejects a single unknown permission', () => {
    const manifest = testManifest({ permissions: ['network:access'] });
    const diags = validateManifestPermissions(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('permission_rejected');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].extensionId).toBe('com.example.test-ext');
    expect(diags[0].message).toContain('network:access');
  });

  it('rejects multiple unknown permissions', () => {
    const manifest = testManifest({
      permissions: ['network:access', 'file:write', 'db:read'],
    });
    const diags = validateManifestPermissions(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('permission_rejected');
    expect(diags[0].message).toContain('network:access');
    expect(diags[0].message).toContain('file:write');
    expect(diags[0].message).toContain('db:read');
  });

  it('rejects mixed allowed and unknown permissions', () => {
    const manifest = testManifest({
      permissions: ['timeline:read', 'evil:destroy'],
    });
    const diags = validateManifestPermissions(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('permission_rejected');
    expect(diags[0].message).toContain('evil:destroy');
    // The message lists rejected perms only, but the "Allowed:" suffix
    // is always appended, so timeline:read may appear there.
  });

  it('includes rejected permissions in detail', () => {
    const manifest = testManifest({ permissions: ['bad:perm'] });
    const diags = validateManifestPermissions(manifest);
    expect(diags[0].detail).toEqual({ rejected: ['bad:perm'] });
  });
});

// ---- validateDuplicateContributionIdsAcrossCollections ----

describe('validateDuplicateContributionIdsAcrossCollections', () => {
  it('returns no diagnostics when there are no contributions', () => {
    const manifest = testManifest();
    expect(validateDuplicateContributionIdsAcrossCollections(manifest)).toEqual([]);
  });

  it('returns no diagnostics when contributions is empty object', () => {
    const manifest = testManifest({ contributions: {} });
    expect(validateDuplicateContributionIdsAcrossCollections(manifest)).toEqual([]);
  });

  it('returns no diagnostics with unique IDs across collections', () => {
    const manifest = testManifest({
      contributions: {
        slots: [{ slot: 'toolbar', id: 'slot-1' }],
        dialogs: [{ id: 'dialog-1' }],
        panels: [{ id: 'panel-1' }],
      },
    });
    expect(validateDuplicateContributionIdsAcrossCollections(manifest)).toEqual([]);
  });

  it('detects same ID used in slots and dialogs', () => {
    const manifest = testManifest({
      contributions: {
        slots: [{ slot: 'toolbar', id: 'dupe' }],
        dialogs: [{ id: 'dupe' }],
      },
    });
    const diags = validateDuplicateContributionIdsAcrossCollections(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('duplicate_descriptor_id');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].message).toContain('dupe');
    expect(diags[0].message).toContain('slots');
    expect(diags[0].message).toContain('dialogs');
  });

  it('detects same ID used in panels and inspectorSections', () => {
    const manifest = testManifest({
      contributions: {
        panels: [{ id: 'shared-id' }],
        inspectorSections: [{ id: 'shared-id', placement: 'before-default' }],
      },
    });
    const diags = validateDuplicateContributionIdsAcrossCollections(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('duplicate_descriptor_id');
    expect(diags[0].message).toContain('shared-id');
  });

  it('detects same ID in three different collections', () => {
    const manifest = testManifest({
      contributions: {
        slots: [{ slot: 'header', id: 'triple' }],
        dialogs: [{ id: 'triple' }],
        panels: [{ id: 'triple' }],
      },
    });
    const diags = validateDuplicateContributionIdsAcrossCollections(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain('triple');
  });

  it('reports multiple distinct cross-collection duplicates in one diagnostic', () => {
    const manifest = testManifest({
      contributions: {
        slots: [{ slot: 'header', id: 'dup-a' }, { slot: 'toolbar', id: 'unique' }],
        dialogs: [{ id: 'dup-a' }],
        panels: [{ id: 'dup-b' }],
        inspectorSections: [{ id: 'dup-b', placement: 'after-default' }],
      },
    });
    const diags = validateDuplicateContributionIdsAcrossCollections(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].message).toContain('dup-a');
    expect(diags[0].message).toContain('dup-b');
  });

  it('includes extension ID in diagnostic', () => {
    const manifest = testManifest({
      id: 'com.example.cross-dupe',
      contributions: {
        slots: [{ slot: 'toolbar', id: 'x' }],
        dialogs: [{ id: 'x' }],
      },
    });
    const diags = validateDuplicateContributionIdsAcrossCollections(manifest);
    expect(diags[0].extensionId).toBe('com.example.cross-dupe');
  });
});

// ---- validateContributionDescriptorMatch ----

describe('validateContributionDescriptorMatch', () => {
  it('returns no diagnostics when manifest has no contributions', () => {
    const manifest = testManifest();
    const config = testConfig();
    expect(validateContributionDescriptorMatch(manifest, config)).toEqual([]);
  });

  // -- Slots --

  it('accepts matching slot contribution when renderer is registered', () => {
    const manifest = testManifest({
      contributions: { slots: [{ slot: 'toolbar', id: 'my-btn' }] },
    });
    const config = testConfig({ slots: { toolbar: noopRenderer } });
    expect(validateContributionDescriptorMatch(manifest, config)).toEqual([]);
  });

  it('rejects slot contribution with no renderer for that slot', () => {
    const manifest = testManifest({
      contributions: { slots: [{ slot: 'header', id: 'missing-header' }] },
    });
    const config = testConfig({ slots: { toolbar: noopRenderer } }); // no 'header' renderer
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].message).toContain('missing-header');
    expect(diags[0].message).toContain('header');
    expect(diags[0].detail).toEqual({ contributionId: 'missing-header', slot: 'header' });
  });

  it('rejects slot contribution when config has no slots at all', () => {
    const manifest = testManifest({
      contributions: { slots: [{ slot: 'statusBar', id: 'sb' }] },
    });
    const config: VideoEditorExtensionConfig = {};
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
  });

  // -- Dialogs --

  it('accepts matching dialog contribution when descriptor exists', () => {
    const manifest = testManifest({
      contributions: { dialogs: [{ id: 'my-dialog' }] },
    });
    const config = testConfig({
      dialogHost: { dialogs: [{ id: 'my-dialog', render: noopRenderer }] },
    });
    expect(validateContributionDescriptorMatch(manifest, config)).toEqual([]);
  });

  it('rejects dialog contribution with no matching descriptor', () => {
    const manifest = testManifest({
      contributions: { dialogs: [{ id: 'orphan-dialog' }] },
    });
    const config = testConfig({
      dialogHost: { dialogs: [{ id: 'other-dialog', render: noopRenderer }] },
    });
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
    expect(diags[0].message).toContain('orphan-dialog');
    expect(diags[0].detail).toEqual({ contributionId: 'orphan-dialog' });
  });

  it('rejects dialog contribution when config has no dialogHost', () => {
    const manifest = testManifest({
      contributions: { dialogs: [{ id: 'no-host' }] },
    });
    const config: VideoEditorExtensionConfig = {};
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
  });

  // -- Panels --

  it('accepts matching panel contribution when descriptor exists', () => {
    const manifest = testManifest({
      contributions: { panels: [{ id: 'my-panel' }] },
    });
    const config = testConfig({
      registry: { panels: [{ id: 'my-panel', placement: 'asset-panel', render: noopRenderer }] },
    });
    expect(validateContributionDescriptorMatch(manifest, config)).toEqual([]);
  });

  it('rejects panel contribution with no matching descriptor', () => {
    const manifest = testManifest({
      contributions: { panels: [{ id: 'orphan-panel' }] },
    });
    const config = testConfig({
      registry: { panels: [{ id: 'other-panel', placement: 'asset-panel', render: noopRenderer }] },
    });
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
    expect(diags[0].message).toContain('orphan-panel');
  });

  // -- Inspector Sections --

  it('accepts matching inspector section contribution when descriptor exists', () => {
    const manifest = testManifest({
      contributions: { inspectorSections: [{ id: 'my-section', placement: 'before-default' }] },
    });
    const config = testConfig({
      registry: {
        inspectorSections: [{ id: 'my-section', placement: 'before-default', render: noopRenderer }],
      },
    });
    expect(validateContributionDescriptorMatch(manifest, config)).toEqual([]);
  });

  it('rejects inspector section contribution with no matching descriptor', () => {
    const manifest = testManifest({
      contributions: { inspectorSections: [{ id: 'orphan-section', placement: 'after-default' }] },
    });
    const config = testConfig({
      registry: {
        inspectorSections: [{ id: 'other-section', placement: 'after-default', render: noopRenderer }],
      },
    });
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('contribution_id_mismatch');
    expect(diags[0].message).toContain('orphan-section');
  });

  // -- Multiple mismatches --

  it('accumulates multiple mismatches across contribution types', () => {
    const manifest = testManifest({
      contributions: {
        slots: [{ slot: 'header', id: 'bad-slot' }],
        dialogs: [{ id: 'bad-dialog' }],
        panels: [{ id: 'bad-panel' }],
      },
    });
    const config = testConfig({
      slots: { toolbar: noopRenderer },
      dialogHost: { dialogs: [{ id: 'good-dialog', render: noopRenderer }] },
      registry: { panels: [{ id: 'good-panel', placement: 'asset-panel', render: noopRenderer }] },
    });
    const diags = validateContributionDescriptorMatch(manifest, config);
    expect(diags.length).toBe(3);
    const codes = diags.map((d) => d.code);
    expect(codes.every((c) => c === 'contribution_id_mismatch')).toBe(true);
  });
});

// ---- validateExtensionPackage (full integration) ----

describe('validateExtensionPackage', () => {
  it('returns no diagnostics for a fully compatible package', () => {
    const pkg = testPackage(
      {
        permissions: ['timeline:read', 'assets:write'],
        contributions: {
          slots: [{ slot: 'toolbar', id: 'btn' }],
          dialogs: [{ id: 'dlg' }],
          panels: [{ id: 'pnl' }],
          inspectorSections: [{ id: 'sec', placement: 'before-default' }],
        },
      },
      {
        slots: { toolbar: noopRenderer },
        dialogHost: { dialogs: [{ id: 'dlg', render: noopRenderer }] },
        registry: {
          panels: [{ id: 'pnl', placement: 'asset-panel', render: noopRenderer }],
          inspectorSections: [{ id: 'sec', placement: 'before-default', render: noopRenderer }],
        },
      },
    );
    expect(validateExtensionPackage(pkg)).toEqual([]);
  });

  it('rejects a package with malformed manifest (missing id)', () => {
    const { id: _, ...badManifest } = testManifest();
    const pkg: ExtensionPackage = { manifest: badManifest as ExtensionManifest, config: testConfig() };
    const diags = validateExtensionPackage(pkg);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('manifest_schema_invalid');
  });

  it('rejects a package with incompatible API version (schema-valid but semver mismatch)', () => {
    const pkg = testPackage({ apiVersion: '3.0.0' });
    const diags = validateExtensionPackage(pkg);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('api_version_incompatible');
  });

  it('rejects a package with unknown permissions (caught at schema level)', () => {
    // Since the JSON Schema permission enum matches ALLOWED_PERMISSIONS,
    // unknown permissions fail schema validation before the runtime
    // belt-and-suspenders check fires.
    const pkg = testPackage({ permissions: ['timeline:read', 'bad:perm'] });
    const diags = validateExtensionPackage(pkg);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('manifest_schema_invalid');
  });

  it('rejects a package with cross-collection duplicate contribution IDs', () => {
    const pkg = testPackage({
      contributions: {
        slots: [{ slot: 'toolbar', id: 'shared' }],
        dialogs: [{ id: 'shared' }],
      },
    }, {
      slots: { toolbar: noopRenderer },
      dialogHost: { dialogs: [{ id: 'shared', render: noopRenderer }] },
    });
    const diags = validateExtensionPackage(pkg);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('duplicate_descriptor_id');
  });

  it('rejects a package with mismatched contribution descriptor IDs', () => {
    const pkg = testPackage({
      contributions: {
        dialogs: [{ id: 'missing-dialog' }],
      },
    }, {
      dialogHost: { dialogs: [{ id: 'other-dialog', render: noopRenderer }] },
    });
    const diags = validateExtensionPackage(pkg);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('contribution_id_mismatch');
  });

  it('accumulates multiple diagnostics for a broken package', () => {
    // Use schema-valid permissions so the runtime checks can fire.
    // Combine: incompatible API + cross-collection duplicate IDs +
    // mismatched contribution descriptor IDs.
    const pkg = testPackage(
      {
        apiVersion: '2.0.0', // incompatible API
        permissions: ['timeline:read'], // schema-valid allowed permission
        contributions: {
          slots: [{ slot: 'toolbar', id: 'dup' }],
          dialogs: [{ id: 'dup' }], // cross-collection duplicate
          panels: [{ id: 'orphan' }], // no matching panel descriptor
        },
      },
      {
        slots: { toolbar: noopRenderer },
        dialogHost: { dialogs: [{ id: 'dup', render: noopRenderer }] },
        registry: { panels: [], inspectorSections: [] }, // no 'orphan' panel
      },
    );
    const diags = validateExtensionPackage(pkg);
    // Should have: api_version_incompatible, duplicate_descriptor_id,
    // contribution_id_mismatch (for orphan panel)
    expect(diags.length).toBeGreaterThanOrEqual(3);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain('api_version_incompatible');
    expect(codes).toContain('duplicate_descriptor_id');
    expect(codes).toContain('contribution_id_mismatch');
  });

  it('early-exits after schema failure without running semantic checks', () => {
    const pkg = testPackage(
      {
        // Schema-invalid: missing apiVersion, plus would fail semantic checks
        apiVersion: undefined as unknown as string,
      },
    );
    const diags = validateExtensionPackage(pkg);
    // Should have exactly the schema diagnostic, not semantic ones
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('manifest_schema_invalid');
  });
});

// ---- isValidPackage ----

describe('isValidPackage', () => {
  it('returns true for a compatible package', () => {
    const pkg = testPackage();
    expect(isValidPackage(pkg)).toBe(true);
  });

  it('returns false for a package with schema violation', () => {
    const { id: _, ...badManifest } = testManifest();
    const pkg: ExtensionPackage = { manifest: badManifest as ExtensionManifest, config: testConfig() };
    expect(isValidPackage(pkg)).toBe(false);
  });

  it('returns false for a package with incompatible API version', () => {
    const pkg = testPackage({ apiVersion: '5.0.0' });
    expect(isValidPackage(pkg)).toBe(false);
  });

  it('returns false for a package with unknown permissions', () => {
    const pkg = testPackage({ permissions: ['bad:perm'] });
    expect(isValidPackage(pkg)).toBe(false);
  });
});

// ---- filterValidPackages ----

describe('filterValidPackages', () => {
  it('returns all packages when all are valid', () => {
    const pkgs = [testPackage(), testPackage({ id: 'com.example.other' })];
    expect(filterValidPackages(pkgs)).toHaveLength(2);
  });

  it('excludes invalid packages', () => {
    const valid = testPackage();
    const invalid = testPackage({ apiVersion: '3.0.0' });
    const result = filterValidPackages([valid, invalid]);
    expect(result).toHaveLength(1);
    expect(result[0].manifest.id).toBe('com.example.test-ext');
  });

  it('returns empty array when all packages are invalid', () => {
    const pkgs = [
      testPackage({ apiVersion: '3.0.0' }),
      testPackage({ permissions: ['bad:perm'] }),
    ];
    expect(filterValidPackages(pkgs)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterValidPackages([])).toEqual([]);
  });

  it('preserves order of valid packages', () => {
    const pkgs = [
      testPackage({ id: 'com.example.first' }),
      testPackage({ apiVersion: '3.0.0' }), // invalid
      testPackage({ id: 'com.example.second' }),
      testPackage({ permissions: ['bad:perm'] }), // invalid
      testPackage({ id: 'com.example.third' }),
    ];
    const result = filterValidPackages(pkgs);
    expect(result).toHaveLength(3);
    expect(result[0].manifest.id).toBe('com.example.first');
    expect(result[1].manifest.id).toBe('com.example.second');
    expect(result[2].manifest.id).toBe('com.example.third');
  });
});

// ---- Structured diagnostics assertions ----

describe('structured diagnostics for excluded packages', () => {
  it('all diagnostic codes are typed union members, not arbitrary strings', () => {
    const pkg = testPackage({ permissions: ['evil:destroy'] });
    const diags = validateExtensionPackage(pkg);
    for (const d of diags) {
      // Type-level: the code must be from the ExtensionDiagnosticCode union
      const code: string = d.code;
      expect([
        'manifest_schema_invalid',
        'api_version_incompatible',
        'permission_rejected',
        'duplicate_package_id',
        'contribution_unknown',
        'contribution_id_mismatch',
        'duplicate_descriptor_id',
        'settings_override_invalid',
        'state_corrupt',
      ]).toContain(code);
    }
  });

  it('every diagnostic has kind "error" (no warnings in current validation)', () => {
    const pkg = testPackage({ apiVersion: '2.0.0' });
    const diags = validateExtensionPackage(pkg);
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.kind).toBe('error');
    }
  });

  it('diagnostics carry extensionId from manifest', () => {
    const pkg = testPackage(
      { id: 'com.example.specific', apiVersion: '2.0.0' },
    );
    const diags = validateExtensionPackage(pkg);
    expect(diags[0].extensionId).toBe('com.example.specific');
  });

  it('diagnostics include detail with structured data when applicable', () => {
    // Schema-invalid manifest produces AJV error detail.
    const { id: _, ...noId } = testManifest();
    const pkg: ExtensionPackage = { manifest: noId as ExtensionManifest, config: testConfig() };
    const diags = validateExtensionPackage(pkg);
    expect(diags[0].detail).toBeDefined();
    expect(Array.isArray(diags[0].detail)).toBe(true);
    expect((diags[0].detail as unknown[]).length).toBeGreaterThan(0);
  });

  it('permission_rejected diagnostic lists rejected permissions in message (standalone runtime check)', () => {
    // Use the standalone runtime check since unknown permissions are
    // caught at the schema level in validateExtensionPackage.
    const manifest = testManifest({
      permissions: ['timeline:read', 'evil:destroy', 'bad:access'],
    });
    const diags = validateManifestPermissions(manifest);
    const permDiag = diags.find((d) => d.code === 'permission_rejected');
    expect(permDiag).toBeDefined();
    expect(permDiag!.message).toContain('evil:destroy');
    expect(permDiag!.message).toContain('bad:access');
    expect(permDiag!.message).toContain('Allowed:');
  });

  it('api_version_incompatible diagnostic explains expected vs actual major', () => {
    const pkg = testPackage({ apiVersion: '5.0.0' });
    const diags = validateExtensionPackage(pkg);
    const apiDiag = diags.find((d) => d.code === 'api_version_incompatible');
    expect(apiDiag).toBeDefined();
    expect(apiDiag!.message).toContain('5');
    expect(apiDiag!.message).toContain('1');
  });

  it('duplicate_descriptor_id diagnostic lists the duplicate IDs and collections', () => {
    const pkg = testPackage(
      {
        contributions: {
          slots: [{ slot: 'toolbar', id: 'dupe-x' }],
          dialogs: [{ id: 'dupe-x' }],
          panels: [{ id: 'dupe-y' }],
          inspectorSections: [{ id: 'dupe-y', placement: 'before-default' }],
        },
      },
      {
        slots: { toolbar: noopRenderer },
        dialogHost: { dialogs: [{ id: 'dupe-x', render: noopRenderer }] },
        registry: {
          panels: [{ id: 'dupe-y', placement: 'asset-panel', render: noopRenderer }],
          inspectorSections: [{ id: 'dupe-y', placement: 'before-default', render: noopRenderer }],
        },
      },
    );
    const diags = validateExtensionPackage(pkg);
    const dupDiag = diags.find((d) => d.code === 'duplicate_descriptor_id');
    expect(dupDiag).toBeDefined();
    expect(dupDiag!.message).toContain('dupe-x');
    expect(dupDiag!.message).toContain('dupe-y');
    expect(dupDiag!.detail).toHaveProperty('duplicates');
  });

  it('contribution_id_mismatch diagnostic identifies the specific contribution ID', () => {
    const pkg = testPackage(
      {
        contributions: {
          dialogs: [{ id: 'orphan-dialog' }, { id: 'orphan-panel' }],
        },
      },
      {
        dialogHost: { dialogs: [{ id: 'real-dialog', render: noopRenderer }] },
      },
    );
    const diags = validateExtensionPackage(pkg);
    const mismatches = diags.filter((d) => d.code === 'contribution_id_mismatch');
    expect(mismatches).toHaveLength(2);
    expect(mismatches[0].message).toContain('orphan-dialog');
    expect(mismatches[1].message).toContain('orphan-panel');
  });
});
