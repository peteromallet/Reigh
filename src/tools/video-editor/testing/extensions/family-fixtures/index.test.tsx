import { describe, expect, it } from 'vitest';
import {
  ALLOWED_PERMISSIONS,
  ExtensionLoader,
  InMemoryExtensionStateRepository,
  filterValidPackages,
  validateExtensionPackage,
} from '@/tools/video-editor/extension';
import { resolveVideoEditorExtensionRuntimeWithDiagnostics } from '@/tools/video-editor/runtime/extensionSurface.ts';
import {
  FAMILY_FIXTURE_IDS,
  familyCommandsPackage,
  familyDuplicateCommandsPackage,
  familyLoaderDiagnosticPackages,
  familyPositivePackages,
  familyRuntimeDiagnosticConfigs,
  familySettingsInvalidOverrideState,
  familySettingsPackage,
  familySettingsValidState,
  familySurfaceMismatchPackage,
  familySurfacePackage,
} from './index';

describe('extension family fixtures', () => {
  it('keeps positive fixtures valid and canonically permissioned', () => {
    const allowed = new Set<string>(ALLOWED_PERMISSIONS);

    for (const fixture of familyPositivePackages) {
      expect(validateExtensionPackage(fixture)).toEqual([]);
      expect(fixture.manifest.permissions ?? []).not.toContain('timeline:read');
      expect((fixture.manifest.permissions ?? []).every((permission) => allowed.has(permission))).toBe(true);
    }

    expect(filterValidPackages(familyPositivePackages)).toHaveLength(familyPositivePackages.length);
  });

  it('uses stable contribution IDs for surface and command selectors', () => {
    expect(familySurfacePackage.manifest.contributions?.slots?.map((slot) => slot.id)).toEqual([
      'family.surface.toolbar',
      'family.surface.status',
    ]);
    expect(familySurfacePackage.manifest.contributions?.dialogs?.[0]?.id).toBe('family.surface.dialog');
    expect(familySurfacePackage.manifest.contributions?.panels?.[0]?.id).toBe('family.surface.asset-panel');
    expect(familySurfacePackage.manifest.contributions?.inspectorSections?.[0]?.id).toBe('family.surface.inspector');
    expect(familyCommandsPackage.manifest.contributions?.commands?.map((command) => command.id)).toEqual([
      'inspect-selection',
      'normalize-selection',
    ]);
  });

  it('renders surface fixture containers with stable family and extension selectors', () => {
    const toolbar = familySurfacePackage.config.slots?.toolbar?.({} as never);
    expect(toolbar).toMatchObject({
      props: expect.objectContaining({
        'data-contribution-family': 'surfaces',
        'data-contribution-id': 'family.surface.toolbar',
        'data-extension-id': FAMILY_FIXTURE_IDS.surface,
      }),
    });

    const panel = familySurfacePackage.config.registry?.panels?.[0]?.render({} as never);
    expect(panel).toMatchObject({
      props: expect.objectContaining({
        'data-contribution-family': 'surfaces',
        'data-contribution-id': 'family.surface.asset-panel',
        'data-extension-id': FAMILY_FIXTURE_IDS.surface,
      }),
    });
  });

  it('provides loader diagnostic fixtures without inverted permissions', () => {
    const allowed = new Set<string>(ALLOWED_PERMISSIONS);

    for (const fixture of familyLoaderDiagnosticPackages) {
      expect((fixture.manifest.permissions ?? []).every((permission) => allowed.has(permission))).toBe(true);
    }

    expect(validateExtensionPackage(familySurfaceMismatchPackage).map((diagnostic) => diagnostic.code)).toContain(
      'contribution_id_mismatch',
    );

    const loader = new ExtensionLoader(
      [familyDuplicateCommandsPackage],
      new InMemoryExtensionStateRepository(),
    );
    const result = loader.load();

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('duplicate_command_id');
    expect(result.commands.map((command) => command.id)).toEqual([
      `${FAMILY_FIXTURE_IDS.duplicateCommands}.duplicate-action`,
    ]);
  });

  it('provides runtime diagnostic fixtures that fail closed deterministically', () => {
    const result = resolveVideoEditorExtensionRuntimeWithDiagnostics(familyRuntimeDiagnosticConfigs);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'duplicate_descriptor_id',
      source: 'extension-runtime',
      severity: 'error',
      detail: {
        descriptorId: 'family.runtime.duplicate-panel',
        collection: 'panels',
      },
    });
    expect(result.runtime.registry.panels.map((panel) => panel.id)).toEqual([
      'family.runtime.duplicate-panel',
    ]);
  });

  it('provides settings states for valid overrides and invalid override diagnostics', () => {
    const validRepository = new InMemoryExtensionStateRepository();
    validRepository.setState(FAMILY_FIXTURE_IDS.settings, familySettingsValidState);
    const validResult = new ExtensionLoader([familySettingsPackage], validRepository).load();

    expect(validResult.configs[0]?.settings).toEqual({
      theme: 'light',
      showRulers: false,
    });

    const invalidRepository = new InMemoryExtensionStateRepository();
    invalidRepository.setState(FAMILY_FIXTURE_IDS.settings, familySettingsInvalidOverrideState);
    const invalidResult = new ExtensionLoader([familySettingsPackage], invalidRepository).load();

    expect(invalidResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain('settings_override_invalid');
    expect(invalidResult.configs[0]?.settings).toEqual({
      theme: 'dark',
      showRulers: true,
    });
  });
});
