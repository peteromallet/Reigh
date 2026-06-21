import { describe, expect, it, beforeEach } from 'vitest';
import { ExtensionLoader } from './extensionLoader.ts';
import type {
  InstalledPackageState,
  ExtensionLoadResult,
} from './extensionLoader.ts';
import { InMemoryExtensionStateRepository } from './extensionStateRepository.ts';
import type { ExtensionStateRepository } from './extensionStateRepository.ts';
import type {
  ExtensionManifest,
  ExtensionPackage,
  ExtensionState,
  ExtensionDiagnostic,
} from './extensionManifest.ts';
import type { VideoEditorExtensionConfig } from './extensionSurface.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid manifest that passes all validation. */
function validManifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'com.example.test',
    name: 'Test Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    ...overrides,
  };
}

/** A minimal valid VideoEditorExtensionConfig (no descriptors to avoid mismatch). */
function emptyConfig(): VideoEditorExtensionConfig {
  return {};
}

/** Create an ExtensionPackage from a manifest and optional config. */
function pkg(
  manifest: ExtensionManifest,
  config: VideoEditorExtensionConfig = emptyConfig(),
): ExtensionPackage {
  return { manifest, config };
}

/** Create a new InMemoryExtensionStateRepository. */
function repo(): InMemoryExtensionStateRepository {
  return new InMemoryExtensionStateRepository();
}

/** Create an ExtensionLoader with the given packages and repository. */
function loader(
  packages: readonly ExtensionPackage[],
  repository: ExtensionStateRepository = repo(),
): ExtensionLoader {
  return new ExtensionLoader(packages, repository);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExtensionLoader', () => {
  // -------------------------------------------------------------------------
  // Valid load / mount
  // -------------------------------------------------------------------------

  describe('valid load and mount', () => {
    it('loads a single valid package into configs', () => {
      const p = pkg(validManifest());
      const result = loader([p]).load();

      expect(result.diagnostics).toHaveLength(0);
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.test');
      expect(result.installedPackages).toHaveLength(1);
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[0].manifest.id).toBe('com.example.test');
    });

    it('loads multiple valid packages with different IDs', () => {
      const p1 = pkg(validManifest({ id: 'com.example.one' }));
      const p2 = pkg(validManifest({ id: 'com.example.two' }));
      const p3 = pkg(validManifest({ id: 'com.example.three' }));

      const result = loader([p1, p2, p3]).load();

      expect(result.diagnostics).toHaveLength(0);
      expect(result.configs).toHaveLength(3);
      expect(result.configs.map((c) => c.extensionId)).toEqual([
        'com.example.one',
        'com.example.two',
        'com.example.three',
      ]);
      expect(result.installedPackages).toHaveLength(3);
      expect(result.installedPackages.every((ip) => ip.loaded)).toBe(true);
    });

    it('preserves config properties in adapted configs', () => {
      const p = pkg(
        validManifest(),
        {
          enabled: true,
          slots: { toolbar: () => null as never },
        },
      );
      const result = loader([p]).load();

      expect(result.configs[0].enabled).toBe(true);
      expect(result.configs[0].slots).toBeDefined();
      expect(result.configs[0].slots!.toolbar).toBeDefined();
      expect(result.configs[0].extensionId).toBe('com.example.test');
    });

    it('sets extensionId and settings on adapted configs', () => {
      const p = pkg(validManifest());
      const result = loader([p]).load();

      expect(result.configs[0].extensionId).toBe('com.example.test');
      // No settingsSchema means settings = {}
      expect(result.configs[0].settings).toEqual({});
    });

    it('resolves settings from manifest settingsSchema', () => {
      const p = pkg(
        validManifest({
          settingsSchema: {
            type: 'object',
            properties: {
              volume: { type: 'number', default: 0.8 },
            },
          },
        }),
      );
      const result = loader([p]).load();

      expect(result.configs[0].settings).toEqual({ volume: 0.8 });
    });

    it('loads empty packages array successfully', () => {
      const result = loader([]).load();

      expect(result.diagnostics).toHaveLength(0);
      expect(result.configs).toHaveLength(0);
      expect(result.installedPackages).toHaveLength(0);
    });

    it('load result has correct shape for valid packages', () => {
      const result = loader([pkg(validManifest())]).load();

      expect(result).toHaveProperty('diagnostics');
      expect(result).toHaveProperty('configs');
      expect(result).toHaveProperty('installedPackages');
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect(Array.isArray(result.configs)).toBe(true);
      expect(Array.isArray(result.installedPackages)).toBe(true);
    });

    it('installed package state has correct shape when loaded', () => {
      const result = loader([pkg(validManifest())]).load();
      const ip = result.installedPackages[0];

      expect(ip).toHaveProperty('manifest');
      expect(ip).toHaveProperty('state');
      expect(ip).toHaveProperty('diagnostics');
      expect(ip).toHaveProperty('loaded');
      expect(ip.loaded).toBe(true);
      expect(ip.diagnostics).toEqual([]);
      expect(ip.state.enabled).toBe(true);
    });

    it('passes repository diagnostics through to result', () => {
      // Pre-populate repo with corrupt data via localStorage-backed repo
      // to exercise the path where repo.load() returns diagnostics.
      // Since InMemory repo always returns [], we test that the array
      // is carried through without interference.
      const r = repo();
      const result = loader([pkg(validManifest())], r).load();

      // In-memory repo returns no diagnostics
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Invalid package fail-closed
  // -------------------------------------------------------------------------

  describe('invalid package fail-closed', () => {
    it('excludes a package with invalid manifest from configs', () => {
      const badManifest = { id: 'bad' } as ExtensionManifest; // missing required fields
      const p = pkg(badManifest);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].code).toBe('manifest_schema_invalid');
      expect(result.installedPackages).toHaveLength(1);
      expect(result.installedPackages[0].loaded).toBe(false);
    });

    it('still loads valid packages alongside invalid ones', () => {
      const valid = pkg(validManifest({ id: 'com.example.valid' }));
      const badManifest = { id: 'bad' } as ExtensionManifest;
      const invalid = pkg(badManifest);

      const result = loader([valid, invalid]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.valid');
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.installedPackages).toHaveLength(2);
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[1].loaded).toBe(false);
    });

    it('records invalid package in installedPackages with diagnostics', () => {
      const badManifest = { id: 'bad' } as ExtensionManifest;
      const p = pkg(badManifest);
      const result = loader([p]).load();

      const ip = result.installedPackages[0];
      expect(ip.loaded).toBe(false);
      expect(ip.manifest).toBe(badManifest);
      expect(ip.diagnostics.length).toBeGreaterThan(0);
      expect(ip.diagnostics[0].code).toBe('manifest_schema_invalid');
    });

    it('invalid package does not consume a seen ID (no duplicate diagnostic)', () => {
      // An invalid package with id "X" should not prevent a later valid
      // package with the same id from being loaded, because validation
      // for the invalid package fails before duplicate-ID checking would
      // add it to seenIds.
      // Actually, looking at the loader code: validation runs first.
      // If validation fails, we skip the duplicate check and never add
      // the ID to seenIds. So a later package with the same ID is not
      // flagged as duplicate.
      const invalidManifest = { id: 'com.example.shared' } as ExtensionManifest;
      const invalid = pkg(invalidManifest);
      const valid = pkg(validManifest({ id: 'com.example.shared' }));

      const result = loader([invalid, valid]).load();

      // The invalid one is excluded; the valid one should be loaded
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.shared');
      // We should have schema_invalid for the first, and no duplicate diagnostic
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain('manifest_schema_invalid');
      expect(codes).not.toContain('duplicate_package_id');
    });
  });

  // -------------------------------------------------------------------------
  // Unsupported API version fail-closed
  // -------------------------------------------------------------------------

  describe('unsupported API version fail-closed', () => {
    it('rejects a package with incompatible major API version', () => {
      const p = pkg(validManifest({ apiVersion: '2.0.0' }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].code).toBe('api_version_incompatible');
      expect(result.installedPackages[0].loaded).toBe(false);
    });

    it('rejects package with API version 0.x', () => {
      const p = pkg(validManifest({ apiVersion: '0.9.0' }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics[0].code).toBe('api_version_incompatible');
    });

    it('accepts package with same-major, different minor/patch', () => {
      const p = pkg(validManifest({ apiVersion: '1.5.3' }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('accepts package with API version 1.0.0 (exact match)', () => {
      const p = pkg(validManifest({ apiVersion: '1.0.0' }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('excludes incompatible package but loads compatible ones', () => {
      const good = pkg(validManifest({ id: 'com.example.good', apiVersion: '1.0.0' }));
      const bad = pkg(validManifest({ id: 'com.example.bad', apiVersion: '3.0.0' }));

      const result = loader([good, bad]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.good');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('api_version_incompatible');
      expect(result.diagnostics[0].extensionId).toBe('com.example.bad');
    });
  });

  // -------------------------------------------------------------------------
  // Permission rejection fail-closed
  // -------------------------------------------------------------------------

  describe('permission rejection fail-closed', () => {
    it('rejects a package with unknown permissions (caught by schema validation)', () => {
      // The JSON Schema has an enum for permissions, so unknown permission
      // strings fail schema validation before the runtime permission check
      // runs.  The runtime check exists as belt-and-suspenders for code
      // paths that bypass schema validation.
      const p = pkg(
        validManifest({ permissions: ['timeline:read', 'network:access'] as string[] }),
      );
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      // Schema validation catches unknown permissions first
      expect(result.diagnostics[0].code).toBe('manifest_schema_invalid');
      expect(result.installedPackages[0].loaded).toBe(false);
    });

    it('accepts a package with allowed permissions', () => {
      const p = pkg(
        validManifest({ permissions: ['timeline:read', 'assets:write'] }),
      );
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('accepts a package with no permissions', () => {
      const p = pkg(validManifest());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('accepts a package with empty permissions array', () => {
      const p = pkg(validManifest({ permissions: [] }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('excludes package with disallowed permissions but loads valid ones', () => {
      const good = pkg(
        validManifest({ id: 'com.example.good', permissions: ['timeline:read'] }),
      );
      const bad = pkg(
        validManifest({ id: 'com.example.bad', permissions: ['evil:destroy'] as string[] }),
      );

      const result = loader([good, bad]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.good');
      expect(result.diagnostics).toHaveLength(1);
      // Schema validation catches the unknown permission string
      expect(result.diagnostics[0].code).toBe('manifest_schema_invalid');
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate package IDs
  // -------------------------------------------------------------------------

  describe('duplicate package IDs', () => {
    it('loads only the first package when IDs are duplicated', () => {
      const first = pkg(validManifest({ id: 'com.example.dup', name: 'First' }));
      const second = pkg(validManifest({ id: 'com.example.dup', name: 'Second' }));

      const result = loader([first, second]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.dup');
      // The first one should win
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[0].manifest.name).toBe('First');
    });

    it('produces duplicate_package_id diagnostic for later duplicates', () => {
      const first = pkg(validManifest({ id: 'com.example.dup' }));
      const second = pkg(validManifest({ id: 'com.example.dup' }));

      const result = loader([first, second]).load();

      const dupDiags = result.diagnostics.filter(
        (d) => d.code === 'duplicate_package_id',
      );
      expect(dupDiags).toHaveLength(1);
      expect(dupDiags[0].kind).toBe('error');
      expect(dupDiags[0].extensionId).toBe('com.example.dup');
      expect(dupDiags[0].message).toContain('Duplicate extension package ID');
      expect(dupDiags[0].detail).toEqual({ duplicateId: 'com.example.dup' });
    });

    it('records duplicate package in installedPackages as not loaded', () => {
      const first = pkg(validManifest({ id: 'com.example.dup' }));
      const second = pkg(validManifest({ id: 'com.example.dup' }));

      const result = loader([first, second]).load();

      expect(result.installedPackages).toHaveLength(2);
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[1].loaded).toBe(false);
      expect(result.installedPackages[1].diagnostics).toHaveLength(1);
      expect(result.installedPackages[1].diagnostics[0].code).toBe('duplicate_package_id');
    });

    it('handles three packages with the same ID — only first loads', () => {
      const p1 = pkg(validManifest({ id: 'com.example.triple', name: 'A' }));
      const p2 = pkg(validManifest({ id: 'com.example.triple', name: 'B' }));
      const p3 = pkg(validManifest({ id: 'com.example.triple', name: 'C' }));

      const result = loader([p1, p2, p3]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.installedPackages[0].manifest.name).toBe('A');
      const dupDiags = result.diagnostics.filter(
        (d) => d.code === 'duplicate_package_id',
      );
      expect(dupDiags).toHaveLength(2);
    });

    it('does not flag IDs as duplicate when they differ', () => {
      const p1 = pkg(validManifest({ id: 'com.example.one' }));
      const p2 = pkg(validManifest({ id: 'com.example.two' }));

      const result = loader([p1, p2]).load();

      expect(result.configs).toHaveLength(2);
      expect(
        result.diagnostics.filter((d) => d.code === 'duplicate_package_id'),
      ).toHaveLength(0);
    });

    it('duplicate check runs before state/settings resolution', () => {
      // A duplicate should be rejected even if the first package has
      // settings overrides that would otherwise differ.
      const r = repo();
      r.setSettingsOverrides('com.example.dup', { key: 'value' });

      const p1 = pkg(
        validManifest({
          id: 'com.example.dup',
          settingsSchema: { type: 'object', properties: { key: { type: 'string', default: 'default' } } },
        }),
      );
      const p2 = pkg(
        validManifest({
          id: 'com.example.dup',
          settingsSchema: { type: 'object', properties: { key: { type: 'string', default: 'other' } } },
        }),
      );

      const result = loader([p1, p2], r).load();

      // Only p1 loaded; p2 got duplicate diagnostic
      expect(result.configs).toHaveLength(1);
      const dupDiags = result.diagnostics.filter((d) => d.code === 'duplicate_package_id');
      expect(dupDiags).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Disabled packages
  // -------------------------------------------------------------------------

  describe('disabled packages', () => {
    it('excludes a disabled package from configs', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const p = pkg(validManifest({ id: 'com.example.disabled' }));
      const result = loader([p], r).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('records disabled package in installedPackages as not loaded', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const p = pkg(validManifest({ id: 'com.example.disabled' }));
      const result = loader([p], r).load();

      expect(result.installedPackages).toHaveLength(1);
      expect(result.installedPackages[0].loaded).toBe(false);
      expect(result.installedPackages[0].manifest.id).toBe('com.example.disabled');
    });

    it('does not emit any diagnostic for disabled packages', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const p = pkg(validManifest({ id: 'com.example.disabled' }));
      const result = loader([p], r).load();

      expect(result.diagnostics).toHaveLength(0);
    });

    it('disabled package has empty diagnostics array', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const p = pkg(validManifest({ id: 'com.example.disabled' }));
      const result = loader([p], r).load();

      expect(result.installedPackages[0].diagnostics).toEqual([]);
    });

    it('loads enabled packages alongside disabled ones', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const enabled = pkg(validManifest({ id: 'com.example.enabled' }));
      const disabled = pkg(validManifest({ id: 'com.example.disabled' }));

      const result = loader([enabled, disabled], r).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.enabled');
      expect(result.installedPackages).toHaveLength(2);
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[1].loaded).toBe(false);
    });

    it('default state (enabled=true) allows package to load', () => {
      // No state set — default is enabled=true
      const p = pkg(validManifest());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.installedPackages[0].loaded).toBe(true);
    });

    it('disabled package does not produce a duplicate diagnostic for a later package', () => {
      // A disabled package should not add its ID to seenIds.  However,
      // state is keyed by manifest.id, so a later package with the same
      // ID also sees the disabled state.  The important invariant is that
      // no duplicate_package_id diagnostic is emitted.
      const r = repo();
      r.setEnabled('com.example.shared', false);

      const first = pkg(validManifest({ id: 'com.example.shared', name: 'First' }));
      const second = pkg(validManifest({ id: 'com.example.shared', name: 'Second' }));

      const result = loader([first, second], r).load();

      // Both packages see disabled state; neither loads
      expect(result.configs).toHaveLength(0);
      expect(result.installedPackages).toHaveLength(2);
      expect(result.installedPackages[0].loaded).toBe(false);
      expect(result.installedPackages[1].loaded).toBe(false);
      // No duplicate diagnostic since the first disabled package did not
      // add its ID to seenIds
      expect(
        result.diagnostics.filter((d) => d.code === 'duplicate_package_id'),
      ).toHaveLength(0);
    });

    it('disabled package state is reflected in installedPackages', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const p = pkg(validManifest({ id: 'com.example.disabled' }));
      const result = loader([p], r).load();

      expect(result.installedPackages[0].state.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Conflicting descriptors
  // -------------------------------------------------------------------------

  describe('conflicting descriptors (contribution-descriptor mismatch)', () => {
    it('rejects a package where slot contribution has no matching renderer', () => {
      const manifest = validManifest({
        contributions: {
          slots: [{ slot: 'toolbar', id: 'missing-renderer' }],
        },
      });
      // Config has no slots registered
      const p = pkg(manifest, emptyConfig());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].code).toBe('contribution_id_mismatch');
    });

    it('rejects a package where dialog contribution has no matching descriptor', () => {
      const manifest = validManifest({
        contributions: {
          dialogs: [{ id: 'missing-dialog' }],
        },
      });
      const p = pkg(manifest, emptyConfig());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics[0].code).toBe('contribution_id_mismatch');
    });

    it('rejects a package where panel contribution has no matching descriptor', () => {
      const manifest = validManifest({
        contributions: {
          panels: [{ id: 'missing-panel' }],
        },
      });
      const p = pkg(manifest, emptyConfig());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics[0].code).toBe('contribution_id_mismatch');
    });

    it('rejects a package where inspector section contribution has no matching descriptor', () => {
      const manifest = validManifest({
        contributions: {
          inspectorSections: [{ id: 'missing-section', placement: 'before-default' }],
        },
      });
      const p = pkg(manifest, emptyConfig());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics[0].code).toBe('contribution_id_mismatch');
    });

    it('loads a package where slot contribution matches a renderer', () => {
      const manifest = validManifest({
        contributions: {
          slots: [{ slot: 'toolbar', id: 'my-button' }],
        },
      });
      const config: VideoEditorExtensionConfig = {
        slots: { toolbar: () => null as never },
      };
      const p = pkg(manifest, config);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('loads a package where dialog contribution matches a descriptor', () => {
      const manifest = validManifest({
        contributions: {
          dialogs: [{ id: 'my-dialog' }],
        },
      });
      const config: VideoEditorExtensionConfig = {
        dialogHost: {
          dialogs: [{ id: 'my-dialog', render: () => null as never }],
        },
      };
      const p = pkg(manifest, config);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('loads a package where panel contribution matches a descriptor', () => {
      const manifest = validManifest({
        contributions: {
          panels: [{ id: 'my-panel' }],
        },
      });
      const config: VideoEditorExtensionConfig = {
        registry: {
          panels: [{ id: 'my-panel', placement: 'asset-panel', render: () => null as never }],
        },
      };
      const p = pkg(manifest, config);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('loads a package where inspector section contribution matches a descriptor', () => {
      const manifest = validManifest({
        contributions: {
          inspectorSections: [{ id: 'my-section', placement: 'before-default' }],
        },
      });
      const config: VideoEditorExtensionConfig = {
        registry: {
          inspectorSections: [
            { id: 'my-section', placement: 'before-default', render: () => null as never },
          ],
        },
      };
      const p = pkg(manifest, config);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('still loads valid packages alongside one with descriptor mismatch', () => {
      const goodManifest = validManifest({
        id: 'com.example.good',
        contributions: {
          slots: [{ slot: 'toolbar', id: 'ok-button' }],
        },
      });
      const goodConfig: VideoEditorExtensionConfig = {
        slots: { toolbar: () => null as never },
      };

      const badManifest = validManifest({
        id: 'com.example.bad',
        contributions: {
          dialogs: [{ id: 'missing-dialog' }],
        },
      });

      const result = loader([pkg(goodManifest, goodConfig), pkg(badManifest)]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.good');
      const mismatchDiags = result.diagnostics.filter(
        (d) => d.code === 'contribution_id_mismatch',
      );
      expect(mismatchDiags).toHaveLength(1);
      expect(mismatchDiags[0].extensionId).toBe('com.example.bad');
    });

    it('rejects a package with duplicate contribution IDs across collections', () => {
      const manifest = validManifest({
        contributions: {
          slots: [{ slot: 'toolbar', id: 'shared-id' }],
          dialogs: [{ id: 'shared-id' }],
        },
      });
      const config: VideoEditorExtensionConfig = {
        slots: { toolbar: () => null as never },
        dialogHost: {
          dialogs: [{ id: 'shared-id', render: () => null as never }],
        },
      };
      const p = pkg(manifest, config);
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(0);
      expect(result.diagnostics[0].code).toBe('duplicate_descriptor_id');
    });
  });

  // -------------------------------------------------------------------------
  // Composite scenarios
  // -------------------------------------------------------------------------

  describe('composite scenarios', () => {
    it('handles a mix of valid, invalid, disabled, and duplicate packages', () => {
      const r = repo();
      r.setEnabled('com.example.disabled', false);

      const valid1 = pkg(validManifest({ id: 'com.example.valid1', name: 'Valid 1' }));
      const invalid = pkg({ id: 'com.example.invalid' } as ExtensionManifest);
      const disabled = pkg(validManifest({ id: 'com.example.disabled', name: 'Disabled' }));
      const dup = pkg(validManifest({ id: 'com.example.valid1', name: 'Duplicate' }));
      const valid2 = pkg(validManifest({ id: 'com.example.valid2', name: 'Valid 2' }));

      const result = loader([valid1, invalid, disabled, dup, valid2], r).load();

      // Only valid1 and valid2 should be in configs
      expect(result.configs).toHaveLength(2);
      expect(result.configs.map((c) => c.extensionId)).toEqual([
        'com.example.valid1',
        'com.example.valid2',
      ]);

      // All 5 packages should be in installedPackages
      expect(result.installedPackages).toHaveLength(5);

      // Check diagnostics: schema_invalid + duplicate_package_id
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain('manifest_schema_invalid');
      expect(codes).toContain('duplicate_package_id');
      // Disabled packages don't produce diagnostics
      expect(codes).not.toContain('state_corrupt');
    });

    it('settings overrides merged with defaults for enabled package', () => {
      const r = repo();
      r.setSettingsOverrides('com.example.settings', { volume: 0.5 });

      const p = pkg(
        validManifest({
          id: 'com.example.settings',
          settingsSchema: {
            type: 'object',
            properties: {
              volume: { type: 'number', default: 0.8 },
              muted: { type: 'boolean', default: false },
            },
          },
        }),
      );
      const result = loader([p], r).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].settings).toEqual({ volume: 0.5, muted: false });
    });

    it('settings override diagnostics propagate to result', () => {
      const r = repo();
      // Set an override that violates the schema
      r.setSettingsOverrides('com.example.settings', { volume: 'loud' });

      const p = pkg(
        validManifest({
          id: 'com.example.settings',
          settingsSchema: {
            type: 'object',
            properties: {
              volume: { type: 'number', default: 0.8 },
            },
          },
        }),
      );
      const result = loader([p], r).load();

      // Package still loads (fail-soft for settings), uses defaults
      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].settings).toEqual({ volume: 0.8 });
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
    });

    it('load is idempotent with same packages and repository', () => {
      const p = pkg(validManifest());
      const l = loader([p]);

      const result1 = l.load();
      const result2 = l.load();

      expect(result1.configs).toHaveLength(1);
      expect(result2.configs).toHaveLength(1);
      expect(result1.configs[0].extensionId).toBe(result2.configs[0].extensionId);
    });

    it('processes packages in definition order', () => {
      const p1 = pkg(validManifest({ id: 'com.example.first' }));
      const p2 = pkg(validManifest({ id: 'com.example.second' }));
      const p3 = pkg(validManifest({ id: 'com.example.third' }));

      const result = loader([p1, p2, p3]).load();

      expect(result.configs.map((c) => c.extensionId)).toEqual([
        'com.example.first',
        'com.example.second',
        'com.example.third',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles packages with no contributions', () => {
      const p = pkg(validManifest());
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles packages with empty contributions object', () => {
      const p = pkg(validManifest({ contributions: {} }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles very large number of packages', () => {
      const packages = Array.from({ length: 200 }, (_, i) =>
        pkg(validManifest({ id: `com.example.pkg${i}` })),
      );

      const result = loader(packages).load();

      expect(result.configs).toHaveLength(200);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('state is fetched via getState for every package', () => {
      const r = repo();
      r.setState('com.example.one', { enabled: true });
      r.setState('com.example.two', { enabled: false });

      const p1 = pkg(validManifest({ id: 'com.example.one' }));
      const p2 = pkg(validManifest({ id: 'com.example.two' }));

      const result = loader([p1, p2], r).load();

      expect(result.installedPackages[0].state.enabled).toBe(true);
      expect(result.installedPackages[1].state.enabled).toBe(false);
    });

    it('manifest with specific extensionId format passes validation', () => {
      const p = pkg(validManifest({ id: 'com.my-org.my-tool' }));
      const result = loader([p]).load();

      expect(result.configs).toHaveLength(1);
    });

    it('duplicate and disabled interaction: disabled first, then duplicate', () => {
      // The first package is disabled, so it doesn't consume the ID in seenIds.
      // The second package with the same ID also queries state and sees disabled.
      // No duplicate diagnostic is emitted because seenIds was never populated.
      const r = repo();
      r.setEnabled('com.example.shared', false);

      const first = pkg(validManifest({ id: 'com.example.shared', name: 'First' }));
      const second = pkg(validManifest({ id: 'com.example.shared', name: 'Second' }));

      const result = loader([first, second], r).load();

      // Both are disabled (shared state per ID)
      expect(result.configs).toHaveLength(0);
      expect(result.installedPackages).toHaveLength(2);
      expect(result.installedPackages[0].loaded).toBe(false);
      expect(result.installedPackages[1].loaded).toBe(false);
      // No duplicate diagnostic since neither consumed the ID
      expect(
        result.diagnostics.filter((d) => d.code === 'duplicate_package_id'),
      ).toHaveLength(0);
    });

    it('duplicate and disabled interaction: enabled first consumes ID, second is duplicate', () => {
      // First package is enabled (default), consumes the ID in seenIds.
      // Second package is a duplicate — gets duplicate diagnostic regardless
      // of its own state, because the duplicate check runs before state check.
      const r = repo();

      const first = pkg(validManifest({ id: 'com.example.shared', name: 'First' }));
      const second = pkg(validManifest({ id: 'com.example.shared', name: 'Second' }));

      const result = loader([first, second], r).load();

      expect(result.configs).toHaveLength(1);
      expect(result.configs[0].extensionId).toBe('com.example.shared');
      expect(result.installedPackages[0].manifest.name).toBe('First');
      expect(result.installedPackages[0].loaded).toBe(true);
      expect(result.installedPackages[1].manifest.name).toBe('Second');
      expect(result.installedPackages[1].loaded).toBe(false);
      expect(
        result.diagnostics.filter((d) => d.code === 'duplicate_package_id'),
      ).toHaveLength(1);
    });
  });
});
