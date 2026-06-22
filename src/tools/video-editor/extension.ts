/**
 * @publicContract
 * Public video editor extension API entrypoint.
 *
 * Import extension descriptor types, the `defineExtension` identity factory,
 * manifest/package/state/settings types, and constants from this module to
 * build video editor extensions.
 *
 * Do not import internal provider contexts or runtime hooks — they are not
 * part of the supported public surface.
 */
export { defineExtension } from './runtime/defineExtension.ts';
export {
  EXTENSION_CONTRIBUTION_FAMILIES,
  EXTENSION_CONTRIBUTION_FAMILY_BY_ID,
} from './runtime/contributionFamilies.ts';

export type {
  ExtensionContributionFamily,
  ExtensionContributionFamilyId,
  ExtensionContributionFamilyStatus,
} from './runtime/contributionFamilies.ts';

export type {
  VideoEditorDialogDescriptor,
  VideoEditorDialogHostConfig,
  VideoEditorExtensionConfig,
  VideoEditorExtensionInput,
  VideoEditorExtensionRuntimeConfig,
  VideoEditorInspectorSectionDescriptor,
  VideoEditorPanelDescriptor,
  VideoEditorPanelRegistryConfig,
  VideoEditorRenderContext,
  VideoEditorRuntimeSlices,
  VideoEditorSlotName,
  VideoEditorSlotRenderer,
  VideoEditorVisibilityPredicate,
} from './runtime/extensionSurface.ts';

// Public manifest/package/state/settings contract
export {
  RUNTIME_API_VERSION,
  ALLOWED_PERMISSIONS,
  validateManifestSchema,
  validateApiVersionCompatibility,
  validateManifestPermissions,
  validateDuplicateContributionIdsAcrossCollections,
  validateContributionDescriptorMatch,
  validateExtensionPackage,
  isValidPackage,
  filterValidPackages,
} from './runtime/extensionManifest.ts';

export type {
  ExtensionSlotContribution,
  ExtensionDialogContribution,
  ExtensionPanelContribution,
  ExtensionInspectorSectionContribution,
  ExtensionManifest,
  ExtensionPackage,
  ExtensionState,
  ExtensionSettings,
  ExtensionDiagnosticKind,
  ExtensionDiagnosticCode,
  ExtensionDiagnostic,
  AllowedPermission,
} from './runtime/extensionManifest.ts';

// Public state repository contract
export type { ExtensionStateRepository } from './runtime/extensionStateRepository.ts';
export {
  InMemoryExtensionStateRepository,
  LocalStorageExtensionStateRepository,
} from './runtime/extensionStateRepository.ts';

// Public settings resolution contract
export { resolveExtensionSettings } from './runtime/extensionSettings.ts';
export type { ResolvedExtensionSettings } from './runtime/extensionSettings.ts';

// Public loader contract
export { ExtensionLoader } from './runtime/extensionLoader.ts';
export type {
  InstalledPackageState,
  ExtensionLoadResult,
} from './runtime/extensionLoader.ts';
