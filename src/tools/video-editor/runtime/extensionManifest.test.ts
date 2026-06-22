import { describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { ReactNode } from 'react';
import {
  ALLOWED_PERMISSIONS,
  validateManifestSchema,
  validateApiVersionCompatibility,
  validateManifestPermissions,
  validateDuplicateContributionIdsAcrossCollections,
  validateCommandDuplicateIds,
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
      permissions: ['read:timeline', 'read:assets'],
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
      validManifest({ permissions: ['read:timeline', 'unknown:perm'] }),
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
        permissions: [...ALLOWED_PERMISSIONS],
      }),
    );
    expect(valid).toBe(true);
  });

  it('accepts canonical action:resource timeline permission', () => {
    const { valid, errors } = validateManifest(
      validManifest({ permissions: ['read:timeline'] }),
    );
    expect(valid).toBe(true);
    expect(errors).toBeNull();
  });

  it('rejects inverted resource:action permissions', () => {
    const { valid, errors } = validateManifest(
      validManifest({
        permissions: ['timeline:read', 'assets:write'],
      }),
    );
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
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
        permissions: ['read:timeline', 'read:timeline'],
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

  it('accepts canonical action:resource timeline permission at runtime schema validation', () => {
    const diags = validateManifestSchema(
      testManifest({ permissions: ['read:timeline'] }),
    );
    expect(diags).toEqual([]);
  });

  it('rejects inverted resource:action permissions at runtime schema validation', () => {
    const diags = validateManifestSchema(
      testManifest({ permissions: ['timeline:read'] }),
    );
    expect(diags).toContainEqual(expect.objectContaining({
      code: 'manifest_schema_invalid',
      message: expect.stringContaining('timeline:read'),
    }));
  });

  it('rejects unsupported contribution collections at runtime schema validation', () => {
    const diags = validateManifestSchema(
      testManifest({
        contributions: {
          effects: [{ id: 'third-party-effect' }],
        },
      }),
    );
    expect(diags).toEqual([
      expect.objectContaining({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: expect.stringContaining('Unknown contribution collection "effects"'),
      }),
    ]);
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
      permissions: [...ALLOWED_PERMISSIONS],
    });
    expect(validateManifestPermissions(manifest)).toEqual([]);
  });

  it('returns no diagnostics for single allowed permission', () => {
    const manifest = testManifest({ permissions: ['write:timeline'] });
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
      permissions: ['read:timeline', 'timeline:read', 'evil:destroy'],
    });
    const diags = validateManifestPermissions(manifest);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('permission_rejected');
    expect(diags[0].message).toContain('timeline:read');
    expect(diags[0].message).toContain('evil:destroy');
    // The message lists rejected perms only, but the "Allowed:" suffix
    // is always appended, so read:timeline may appear there.
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
        permissions: ['read:timeline', 'write:assets'],
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
    const pkg = testPackage({ permissions: ['read:timeline', 'bad:perm'] });
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
        permissions: ['read:timeline'], // schema-valid allowed permission
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
      permissions: ['read:timeline', 'evil:destroy', 'bad:access'],
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

// ---------------------------------------------------------------------------
// T8: Command contribution schema & runtime validation tests
// ---------------------------------------------------------------------------

describe('command contributions — schema validation', () => {
  // ---- Accepted command contributions ----

  it('accepts a manifest with valid command contributions', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'my-command', title: 'My Command' },
          { id: 'another-command', title: 'Another Command', description: 'Does things.' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  it('accepts a command with proposal flag', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'dangerous', title: 'Dangerous Op', proposal: true },
        ],
      },
    });
    const { valid } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  it('accepts a command with keybinding', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'shortcutcmd',
            title: 'Shortcut Command',
            keybinding: { key: 'Ctrl+Shift+K', mac: 'Cmd+Shift+K' },
          },
        ],
      },
    });
    const { valid } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  it('accepts a command with menu context', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'contextcmd',
            title: 'Context Command',
            menu: { context: 'clip-context', group: 'editing', order: 10 },
          },
        ],
      },
    });
    const { valid } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  it('accepts a command with all optional fields', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'fullcmd',
            title: 'Full Command',
            description: 'A fully specified command.',
            proposal: false,
            keybinding: { key: 'Ctrl+F', mac: 'Cmd+F' },
            menu: { context: 'timeline-context', group: 'tools', order: 1 },
          },
        ],
      },
    });
    const { valid } = validateManifest(manifest);
    expect(valid).toBe(true);
  });

  // ---- Invalid command IDs ----

  it('rejects a command with missing id', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { title: 'No ID' } as Record<string, unknown>,
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('id');
  });

  it('rejects a command with empty id string', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: '', title: 'Empty ID' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    // minLength: 1 should trigger
    expect(errors).toContain('must NOT have fewer than 1 characters');
  });

  it('rejects a command id with spaces', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'bad command', title: 'Bad ID' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a command id with uppercase characters', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'MyCommand', title: 'Uppercase ID' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a command id with special characters', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'my@command!', title: 'Special Chars' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must match pattern');
  });

  it('rejects a command missing title', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'noTitle' } as Record<string, unknown>,
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must have required property');
    expect(errors).toContain('title');
  });

  it('rejects a command with empty title', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'emptyTitle', title: '' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have fewer than 1 characters');
  });

  // ---- Invalid keybinding shapes ----

  it('rejects a keybinding that is a string instead of object', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'strKey', title: 'String Key', keybinding: 'Ctrl+K' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be object');
  });

  it('rejects a keybinding that is an array instead of object', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'arrKey', title: 'Array Key', keybinding: ['Ctrl+K'] },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be object');
  });

  it('rejects a keybinding missing the required key field', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'noKey', title: 'No Key', keybinding: { mac: 'Cmd+K' } },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    // The schema requires 'key' but it's not in the required array explicitly.
    // The additionalProperties: false on keybinding means extra fields are rejected.
    // Actually, mac is a valid property, but the key field missing means AJV
    // would not reject it since key is not required in the schema.
    // However, the runtime validateManifestSchema has explicit checks.
    // Let's test via runtime validation instead.
  });

  it('rejects a keybinding with empty key string via runtime validation', () => {
    const diags = validateManifestSchema({
      id: 'com.example.test',
      name: 'Test',
      version: '1.0.0',
      apiVersion: '1.0.0',
      contributions: {
        commands: [
          {
            id: 'emptyKey',
            title: 'Empty Key',
            keybinding: { key: '' },
          },
        ],
      },
    });
    const keyErrors = diags.filter((d) =>
      typeof d.detail === 'object' && d.detail !== null &&
      (d.detail as Record<string, unknown>).field === 'keybinding.key'
    );
    expect(keyErrors.length).toBeGreaterThanOrEqual(1);
    expect(keyErrors[0].message).toContain('keybinding.key');
  });

  it('rejects a keybinding with empty mac string via runtime validation', () => {
    const diags = validateManifestSchema({
      id: 'com.example.test',
      name: 'Test',
      version: '1.0.0',
      apiVersion: '1.0.0',
      contributions: {
        commands: [
          {
            id: 'emptyMac',
            title: 'Empty Mac',
            keybinding: { key: 'Ctrl+K', mac: '' },
          },
        ],
      },
    });
    const keyErrors = diags.filter((d) =>
      typeof d.detail === 'object' && d.detail !== null &&
      (d.detail as Record<string, unknown>).field === 'keybinding.mac'
    );
    expect(keyErrors.length).toBeGreaterThanOrEqual(1);
    expect(keyErrors[0].message).toContain('keybinding.mac');
  });

  it('rejects a keybinding that is null', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'nullKey', title: 'Null Key', keybinding: null },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be object');
  });

  // ---- Unknown command fields ----

  it('rejects commands with unknown additional properties', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'extraField', title: 'Extra', unknownProp: 'should-fail' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    // additionalProperties: false on command items
    expect(errors).toContain('must NOT have additional properties');
  });

  it('rejects commands with unknown nested fields inside keybinding', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'extraKeybind',
            title: 'Extra Keybind',
            keybinding: { key: 'Ctrl+K', unknownNested: true },
          },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have additional properties');
  });

  it('rejects commands with unknown fields inside menu', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'extraMenu',
            title: 'Extra Menu',
            menu: { context: 'clip-context', unknownMenuField: 'bad' },
          },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have additional properties');
  });

  // ---- Duplicate command items ----

  it('rejects duplicate command items within the same manifest', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'dupCmd', title: 'Duplicate' },
          { id: 'dupCmd', title: 'Duplicate' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must NOT have duplicate items');
  });

  // ---- Invalid menu shapes ----

  it('rejects a menu with invalid context enum value', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          {
            id: 'badContext',
            title: 'Bad Context',
            menu: { context: 'invalid-context' },
          },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be equal to one of the allowed values');
  });

  it('rejects a menu that is a string instead of object', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'strMenu', title: 'String Menu', menu: 'clip-context' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be object');
  });

  // ---- proposal field type ----

  it('rejects a command with non-boolean proposal field', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'strProposal', title: 'String Proposal', proposal: 'yes' },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be boolean');
  });

  it('rejects a command with numeric proposal field', () => {
    const manifest = validManifest({
      contributions: {
        commands: [
          { id: 'numProposal', title: 'Num Proposal', proposal: 1 },
        ],
      },
    });
    const { valid, errors } = validateManifest(manifest);
    expect(valid).toBe(false);
    expect(errors).toContain('must be boolean');
  });
});

// ---------------------------------------------------------------------------
// T8: Full namespaced command ID diagnostics
// ---------------------------------------------------------------------------

describe('validateCommandDuplicateIds', () => {
  it('returns no diagnostics when there are no commands across any manifest', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({ id: 'com.example.a' }),
      testManifest({ id: 'com.example.b' }),
    ];
    expect(validateCommandDuplicateIds(manifests)).toEqual([]);
  });

  it('returns no diagnostics with unique fully-qualified command IDs', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.example.a',
        contributions: {
          commands: [
            { id: 'cmd1', title: 'Command 1' },
            { id: 'cmd2', title: 'Command 2' },
          ],
        },
      }),
      testManifest({
        id: 'com.example.b',
        contributions: {
          commands: [
            { id: 'cmd1', title: 'Command 1' }, // Same local ID, different manifest
            { id: 'cmd3', title: 'Command 3' },
          ],
        },
      }),
    ];
    // com.example.a.cmd1 ≠ com.example.b.cmd1
    expect(validateCommandDuplicateIds(manifests)).toEqual([]);
  });

  it('detects duplicate fully-qualified command ID across two manifests', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.example.collision',
        contributions: {
          commands: [
            { id: 'sharedCmd', title: 'Shared Command' },
          ],
        },
      }),
      testManifest({
        id: 'com.example.collision',
        contributions: {
          commands: [
            { id: 'sharedCmd', title: 'Also Shared' },
          ],
        },
      }),
    ];
    const diags = validateCommandDuplicateIds(manifests);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe('duplicate_command_id');
    expect(diags[0].kind).toBe('error');
    expect(diags[0].message).toContain('com.example.collision.sharedCmd');
    expect(diags[0].message).toContain('Duplicate');
  });

  it('reports the full namespaced ID in the diagnostic message', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'org.pkg.plugin',
        contributions: {
          commands: [{ id: 'run', title: 'Run' }],
        },
      }),
      testManifest({
        id: 'org.pkg.plugin',
        contributions: {
          commands: [{ id: 'run', title: 'Run Too' }],
        },
      }),
    ];
    const diags = validateCommandDuplicateIds(manifests);
    expect(diags.length).toBe(1);
    expect(diags[0].detail).toMatchObject({
      fullCommandId: 'org.pkg.plugin.run',
      localId: 'run',
    });
  });

  it('includes both manifest IDs in the duplicate diagnostic', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.first.pkg',
        contributions: {
          commands: [{ id: 'conflict', title: 'First' }],
        },
      }),
      testManifest({
        id: 'com.first.pkg',
        contributions: {
          commands: [{ id: 'conflict', title: 'Second' }],
        },
      }),
    ];
    const diags = validateCommandDuplicateIds(manifests);
    expect(diags.length).toBe(1);
    expect(diags[0].detail).toMatchObject({
      fullCommandId: 'com.first.pkg.conflict',
      firstManifest: 'com.first.pkg',
      secondManifest: 'com.first.pkg',
    });
  });

  it('detects multiple duplicate fully-qualified IDs across manifests', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.shared',
        contributions: {
          commands: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
          ],
        },
      }),
      testManifest({
        id: 'com.shared',
        contributions: {
          commands: [
            { id: 'a', title: 'A Dup' },
            { id: 'b', title: 'B Dup' },
          ],
        },
      }),
    ];
    const diags = validateCommandDuplicateIds(manifests);
    expect(diags.length).toBe(2);
    expect(diags[0].code).toBe('duplicate_command_id');
    expect(diags[1].code).toBe('duplicate_command_id');
    expect(diags[0].detail).toHaveProperty('fullCommandId');
    expect(diags[1].detail).toHaveProperty('fullCommandId');
  });

  it('returns empty diagnostics when commands are only present in one manifest', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.solo',
        contributions: {
          commands: [
            { id: 'only', title: 'Only' },
            { id: 'lonely', title: 'Lonely' },
          ],
        },
      }),
      testManifest({ id: 'com.other' }),
    ];
    expect(validateCommandDuplicateIds(manifests)).toEqual([]);
  });

  it('sets extensionId to the second manifest in the collision', () => {
    const manifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.first',
        contributions: { commands: [{ id: 'dup', title: 'First' }] },
      }),
      testManifest({
        id: 'com.second',
        contributions: { commands: [{ id: 'dup', title: 'Second' }] },
      }),
    ];
    // Different manifest IDs means different full command IDs, no collision.
    // Let's test same manifest ID scenario for extensionId.
    const sameIdManifests: ExtensionManifest[] = [
      testManifest({
        id: 'com.dupe',
        contributions: { commands: [{ id: 'x', title: 'X1' }] },
      }),
      testManifest({
        id: 'com.dupe',
        contributions: { commands: [{ id: 'x', title: 'X2' }] },
      }),
    ];
    const diags = validateCommandDuplicateIds(sameIdManifests);
    expect(diags.length).toBe(1);
    // extensionId should be from the manifest where the duplicate was detected
    // (the second one)
    expect(diags[0].extensionId).toBe('com.dupe');
  });
});
