/**
 * @publicContract
 * Extension manifest/package/state/settings public types and validation.
 *
 * Defines the shape of extension manifests (schema-validated JSON), extension
 * packages (manifest + config), per-extension persisted state, resolved
 * settings, and structured diagnostics.  Also provides validation helpers
 * used by the loader to reject invalid packages before they reach the runtime.
 */

// ---------------------------------------------------------------------------
// Semver helpers
// ---------------------------------------------------------------------------

function parseSemverMajor(version: string): number | null {
  const match = version.match(/^(\d+)\.\d+\.\d+/);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current runtime API version (semver). */
export const RUNTIME_API_VERSION = '1.0.0';

/** Allowed permission strings for declarative validation. */
export const ALLOWED_PERMISSIONS = [
  'read:timeline',
  'write:timeline',
  'read:assets',
  'write:assets',
  'read:effects',
  'write:effects',
  'read:sequences',
  'write:sequences',
  'network:fetch',
  'storage:local',
] as const;

export type AllowedPermission = (typeof ALLOWED_PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Contribution types
// ---------------------------------------------------------------------------

export type ExtensionSlotName =
  | 'header'
  | 'toolbar'
  | 'leftPanel'
  | 'rightPanel'
  | 'timelineFooter'
  | 'statusBar'
  | 'dialogs'
  | 'assetPanel'
  | 'inspectorPanel';

export interface ExtensionSlotContribution {
  slot: ExtensionSlotName;
  id: string;
  order?: number;
  placement?: string;
}

export interface ExtensionDialogContribution {
  id: string;
  order?: number;
  layer?: 'modal' | 'overlay';
}

export interface ExtensionPanelContribution {
  id: string;
  placement: 'asset-panel';
  order?: number;
}

export interface ExtensionInspectorSectionContribution {
  id: string;
  placement: 'before-default' | 'after-default';
  order?: number;
}

// ---------------------------------------------------------------------------
// Manifest and package types
// ---------------------------------------------------------------------------

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  permissions?: readonly string[];
  settingsSchema?: Record<string, unknown>;
  contributions?: {
    slots?: readonly ExtensionSlotContribution[];
    dialogs?: readonly ExtensionDialogContribution[];
    panels?: readonly ExtensionPanelContribution[];
    inspectorSections?: readonly ExtensionInspectorSectionContribution[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ExtensionSettings {
  [key: string]: unknown;
}

export interface ExtensionState {
  enabled: boolean;
  settingsOverrides?: Record<string, unknown>;
}

export type ExtensionDiagnosticKind = 'error' | 'warning';

export type ExtensionDiagnosticCode =
  | 'manifest_schema_invalid'
  | 'api_version_incompatible'
  | 'permission_rejected'
  | 'contribution_id_mismatch'
  | 'duplicate_contribution_id'
  | 'duplicate_package_id'
  | 'settings_validation_failed'
  | 'settings_override_invalid'
  | 'state_corrupt'
  | 'unsupported_record_version';

export interface ExtensionDiagnostic {
  kind: ExtensionDiagnosticKind;
  code: ExtensionDiagnosticCode;
  message: string;
  extensionId?: string;
  detail?: Record<string, unknown>;
}

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// JSON Schema (inlined for runtime validation)
// ---------------------------------------------------------------------------

const MANIFEST_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['id', 'name', 'version', 'apiVersion'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    version: {
      type: 'string',
      pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[a-zA-Z0-9.]+)?(\\+[a-zA-Z0-9.]+)?$',
    },
    apiVersion: {
      type: 'string',
      pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[a-zA-Z0-9.]+)?(\\+[a-zA-Z0-9.]+)?$',
    },
    description: { type: 'string' },
    permissions: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    settingsSchema: { type: 'object' },
    contributions: {
      type: 'object',
      properties: {
        slots: {
          type: 'array',
          items: {
            type: 'object',
            required: ['slot', 'id'],
            properties: {
              slot: {
                type: 'string',
                enum: [
                  'header', 'toolbar', 'leftPanel', 'rightPanel',
                  'timelineFooter', 'statusBar', 'dialogs',
                  'assetPanel', 'inspectorPanel',
                ],
              },
              id: { type: 'string', minLength: 1 },
              order: { type: 'number' },
              placement: { type: 'string' },
            },
          },
          uniqueItems: true,
        },
        dialogs: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', minLength: 1 },
              order: { type: 'number' },
              layer: { type: 'string', enum: ['modal', 'overlay'] },
            },
          },
          uniqueItems: true,
        },
        panels: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', minLength: 1 },
              placement: { type: 'string', enum: ['asset-panel'] },
              order: { type: 'number' },
            },
          },
          uniqueItems: true,
        },
        inspectorSections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', minLength: 1 },
              placement: { type: 'string', enum: ['before-default', 'after-default'] },
              order: { type: 'number' },
            },
          },
          uniqueItems: true,
        },
      },
    },
  },
  additionalProperties: true,
};

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validate a manifest object against the Reigh extension JSON Schema.
 * Uses a minimal in-tree validator to avoid heavy Ajv dependency at runtime.
 */
export function validateManifestSchema(manifest: unknown): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    diagnostics.push({
      kind: 'error',
      code: 'manifest_schema_invalid',
      message: 'Manifest must be a non-null object.',
    });
    return diagnostics;
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  for (const field of ['id', 'name', 'version', 'apiVersion']) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      diagnostics.push({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: `Manifest is missing required field "${field}" or it is not a non-empty string.`,
        extensionId: typeof m.id === 'string' ? m.id : undefined,
      });
    }
  }

  // Semver validation for version and apiVersion
  if (typeof m.version === 'string') {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(m.version)) {
      diagnostics.push({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: `Manifest "version" "${m.version}" is not valid semver.`,
        extensionId: typeof m.id === 'string' ? m.id : undefined,
      });
    }
  }

  if (typeof m.apiVersion === 'string') {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/.test(m.apiVersion)) {
      diagnostics.push({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: `Manifest "apiVersion" "${m.apiVersion}" is not valid semver.`,
        extensionId: typeof m.id === 'string' ? m.id : undefined,
      });
    }
  }

  // Validate contributions if present
  if (typeof m.contributions === 'object' && m.contributions !== null) {
    const contribs = m.contributions as Record<string, unknown>;
    const validCollections = ['slots', 'dialogs', 'panels', 'inspectorSections'];
    for (const key of Object.keys(contribs)) {
      if (!validCollections.includes(key)) {
        diagnostics.push({
          kind: 'warning',
          code: 'manifest_schema_invalid',
          message: `Unknown contribution collection "${key}".`,
          extensionId: typeof m.id === 'string' ? m.id : undefined,
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// API version compatibility
// ---------------------------------------------------------------------------

/**
 * Check that the manifest's apiVersion is same-major compatible with the runtime.
 */
export function validateApiVersionCompatibility(manifest: ExtensionManifest): ExtensionDiagnostic[] {
  const runtimeMajor = parseSemverMajor(RUNTIME_API_VERSION);
  const manifestMajor = parseSemverMajor(manifest.apiVersion);

  if (runtimeMajor === null || manifestMajor === null || runtimeMajor !== manifestMajor) {
    return [{
      kind: 'error',
      code: 'api_version_mismatch',
      message: `Extension "${manifest.id}" requires API version ${manifest.apiVersion}, but runtime is ${RUNTIME_API_VERSION}.`,
      extensionId: manifest.id,
      detail: { manifestApiVersion: manifest.apiVersion, runtimeApiVersion: RUNTIME_API_VERSION },
    }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Permission validation
// ---------------------------------------------------------------------------

/**
 * Validate that all declared permissions are in the allowed set.
 */
export function validateManifestPermissions(manifest: ExtensionManifest): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];

  if (manifest.permissions) {
    for (const perm of manifest.permissions) {
      if (!(ALLOWED_PERMISSIONS as readonly string[]).includes(perm)) {
        diagnostics.push({
          kind: 'error',
          code: 'permission_rejected',
          message: `Extension "${manifest.id}" requests unknown permission "${perm}".`,
          extensionId: manifest.id,
          detail: { permission: perm },
        });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Contribution validation
// ---------------------------------------------------------------------------

/**
 * Check for duplicate contribution IDs across collections within a single manifest.
 * Ajv handles per-array uniqueness; this catches cross-collection duplicates.
 */
export function validateDuplicateContributionIdsAcrossCollections(
  manifest: ExtensionManifest,
): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];
  const seen = new Map<string, string>(); // id -> collection name

  const collections: [string, readonly { id: string }[] | undefined][] = [
    ['slots', manifest.contributions?.slots],
    ['dialogs', manifest.contributions?.dialogs],
    ['panels', manifest.contributions?.panels],
    ['inspectorSections', manifest.contributions?.inspectorSections],
  ];

  for (const [collectionName, items] of collections) {
    if (!items) continue;
    for (const item of items) {
      if (seen.has(item.id)) {
        diagnostics.push({
          kind: 'error',
          code: 'duplicate_contribution_id',
          message: `Duplicate contribution ID "${item.id}" found in collections "${seen.get(item.id)}" and "${collectionName}".`,
          extensionId: manifest.id,
          detail: { duplicateId: item.id, collections: [seen.get(item.id), collectionName] },
        });
      } else {
        seen.set(item.id, collectionName);
      }
    }
  }

  return diagnostics;
}

/**
 * Match manifest contribution IDs to config descriptors for slots/dialogs/panels/inspectorSections.
 */
export function validateContributionDescriptorMatch(
  manifest: ExtensionManifest,
  config: Record<string, unknown>,
): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];

  // Collect all manifest contribution IDs
  const manifestIds = new Set<string>();
  const collections: [string, readonly { id: string }[] | undefined][] = [
    ['slots', manifest.contributions?.slots],
    ['dialogs', manifest.contributions?.dialogs],
    ['panels', manifest.contributions?.panels],
    ['inspectorSections', manifest.contributions?.inspectorSections],
  ];

  for (const [, items] of collections) {
    if (!items) continue;
    for (const item of items) {
      manifestIds.add(item.id);
    }
  }

  // Collect config descriptor IDs
  const configKeys = ['slots', 'dialogHost', 'registry'] as const;
  for (const key of configKeys) {
    const value = config[key];
    if (!value || typeof value !== 'object') continue;

    if (key === 'dialogHost') {
      const dh = value as { dialogs?: { id: string }[] };
      if (dh.dialogs) {
        for (const d of dh.dialogs) {
          if (!manifestIds.has(d.id)) {
            diagnostics.push({
              kind: 'warning',
              code: 'contribution_id_mismatch',
              message: `Config descriptor "${d.id}" in dialogHost has no matching contribution in manifest.`,
              extensionId: manifest.id,
              detail: { descriptorId: d.id, collection: 'dialogs' },
            });
          }
        }
      }
    }

    if (key === 'registry') {
      const reg = value as { panels?: { id: string }[]; inspectorSections?: { id: string }[] };
      if (reg.panels) {
        for (const p of reg.panels) {
          if (!manifestIds.has(p.id)) {
            diagnostics.push({
              kind: 'warning',
              code: 'contribution_id_mismatch',
              message: `Config descriptor "${p.id}" in registry.panels has no matching contribution in manifest.`,
              extensionId: manifest.id,
              detail: { descriptorId: p.id, collection: 'panels' },
            });
          }
        }
      }
      if (reg.inspectorSections) {
        for (const is of reg.inspectorSections) {
          if (!manifestIds.has(is.id)) {
            diagnostics.push({
              kind: 'warning',
              code: 'contribution_id_mismatch',
              message: `Config descriptor "${is.id}" in registry.inspectorSections has no matching contribution in manifest.`,
              extensionId: manifest.id,
              detail: { descriptorId: is.id, collection: 'inspectorSections' },
            });
          }
        }
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Package-level validation
// ---------------------------------------------------------------------------

/**
 * Run all validation checks on an extension package.
 * Returns diagnostics; an empty array means the package is valid.
 */
export function validateExtensionPackage(pkg: ExtensionPackage): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];

  // Schema validation
  diagnostics.push(...validateManifestSchema(pkg.manifest));

  // If schema already failed, stop early
  if (diagnostics.length > 0) return diagnostics;

  // API version compatibility
  diagnostics.push(...validateApiVersionCompatibility(pkg.manifest));

  // Permission validation
  diagnostics.push(...validateManifestPermissions(pkg.manifest));

  // Cross-collection duplicate IDs
  diagnostics.push(...validateDuplicateContributionIdsAcrossCollections(pkg.manifest));

  // Contribution/descriptor matching
  diagnostics.push(...validateContributionDescriptorMatch(pkg.manifest, pkg.config));

  return diagnostics;
}

/**
 * Returns true if the package passes all validation checks.
 */
export function isValidPackage(pkg: ExtensionPackage): boolean {
  return validateExtensionPackage(pkg).length === 0;
}

/**
 * Filter an array of packages, returning only valid ones.
 */
export function filterValidPackages(pkgs: readonly ExtensionPackage[]): ExtensionPackage[] {
  return pkgs.filter(isValidPackage);
}
