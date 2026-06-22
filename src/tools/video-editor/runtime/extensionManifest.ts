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

export interface ExtensionCommandKeybinding {
  key: string;
  mac?: string;
}

export type ExtensionCommandMenuContext =
  | 'timeline-context'
  | 'clip-context'
  | 'track-context'
  | 'clip-selection-context'
  | 'canvas-context';

export interface ExtensionCommandMenu {
  context: ExtensionCommandMenuContext;
  group?: string;
  order?: number;
}

export interface ExtensionCommandContribution {
  /** Fully qualified contributing extension ID once adapted by the loader. */
  extensionId?: string;
  /** Local command identifier (e.g. 'myCommand'). The runtime namespaces this as `${manifest.id}.${localCommandId}`. */
  id: string;
  /** Human-readable command label shown in the command palette. */
  title: string;
  /** Optional prose description for the command palette. */
  description?: string;
  /** When true, executing this command opens the proposal review UI before committing timeline changes. */
  proposal?: boolean;
  /** Optional default keybinding. Users can override this in settings. */
  keybinding?: ExtensionCommandKeybinding;
  /** Optional context menu placement. */
  menu?: ExtensionCommandMenu;
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
    commands?: readonly ExtensionCommandContribution[];
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
  | 'duplicate_descriptor_id'
  | 'duplicate_command_id'
  | 'duplicate_keybinding'
  | 'duplicate_package_id'
  | 'settings_override_invalid'
  | 'state_corrupt'
  | 'unknown_manifest_field';

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
      items: {
        type: 'string',
        enum: [...ALLOWED_PERMISSIONS],
      },
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
        commands: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title'],
            properties: {
              id: {
                type: 'string',
                minLength: 1,
                pattern: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$',
              },
              title: { type: 'string', minLength: 1 },
              description: { type: 'string' },
              proposal: { type: 'boolean' },
              keybinding: {
                type: 'object',
                properties: {
                  key: { type: 'string', minLength: 1 },
                  mac: { type: 'string', minLength: 1 },
                },
              },
              menu: {
                type: 'object',
                properties: {
                  context: {
                    type: 'string',
                    enum: [
                      'timeline-context',
                      'clip-context',
                      'track-context',
                      'clip-selection-context',
                      'canvas-context',
                    ],
                  },
                  group: { type: 'string', minLength: 1 },
                  order: { type: 'number' },
                },
              },
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
export function validateManifestSchema(
  manifest: unknown,
  fallbackExtensionId?: string,
): ExtensionDiagnostic[] {
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
  const extensionId = typeof m.id === 'string' ? m.id : fallbackExtensionId;

  // Required fields
  for (const field of ['id', 'name', 'version', 'apiVersion']) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      diagnostics.push({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: `Manifest must have required property "${field}".`,
        extensionId,
        detail: [{
          instancePath: '',
          schemaPath: `#/required/${field}`,
          keyword: 'required',
          params: { missingProperty: field },
          message: `must have required property '${field}'`,
        }],
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

  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) {
      diagnostics.push({
        kind: 'error',
        code: 'manifest_schema_invalid',
        message: 'Manifest "permissions" must be an array of known permission strings.',
        extensionId: typeof m.id === 'string' ? m.id : undefined,
      });
    } else {
      const seenPermissions = new Set<string>();
      for (const permission of m.permissions) {
        if (typeof permission !== 'string') {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: 'Manifest "permissions" must contain only known permission strings.',
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { permission },
          });
          continue;
        }

        if (seenPermissions.has(permission)) {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `Manifest "permissions" contains duplicate permission "${permission}".`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { permission },
          });
        }
        seenPermissions.add(permission);

        if (!(ALLOWED_PERMISSIONS as readonly string[]).includes(permission)) {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `Manifest "permissions" contains unsupported permission "${permission}".`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { permission },
          });
        }
      }
    }
  }

  // Validate contributions if present
  if (typeof m.contributions === 'object' && m.contributions !== null) {
    const contribs = m.contributions as Record<string, unknown>;
    const validCollections = ['slots', 'dialogs', 'panels', 'inspectorSections', 'commands'];
    for (const key of Object.keys(contribs)) {
      if (!validCollections.includes(key)) {
        diagnostics.push({
          kind: 'error',
          code: 'manifest_schema_invalid',
          message: `Unknown contribution collection \"${key}\".`,
          extensionId: typeof m.id === 'string' ? m.id : undefined,
        });
      }
    }

    // Validate commands array if present
    const rawCommands = contribs.commands;
    if (Array.isArray(rawCommands)) {
      const commands = rawCommands as Record<string, unknown>[];
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const cmdPath = `contributions.commands[${i}]`;

        if (typeof cmd.id !== 'string' || cmd.id.length === 0) {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `${cmdPath}.id must be a non-empty string matching ^[a-z0-9]+(?:[.-][a-z0-9]+)*$.`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { path: cmdPath, field: 'id' },
          });
        } else if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(cmd.id)) {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `${cmdPath}.id \"${cmd.id}\" must match pattern ^[a-z0-9]+(?:[.-][a-z0-9]+)*$.`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { path: cmdPath, field: 'id', value: cmd.id },
          });
        }

        if (typeof cmd.title !== 'string' || cmd.title.length === 0) {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `${cmdPath}.title must be a non-empty string.`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { path: cmdPath, field: 'title' },
          });
        }

        // Validate proposal field is boolean if present
        if (cmd.proposal !== undefined && typeof cmd.proposal !== 'boolean') {
          diagnostics.push({
            kind: 'error',
            code: 'manifest_schema_invalid',
            message: `${cmdPath}.proposal must be a boolean.`,
            extensionId: typeof m.id === 'string' ? m.id : undefined,
            detail: { path: cmdPath, field: 'proposal' },
          });
        }

        // Validate keybinding object if present
        if (cmd.keybinding !== undefined) {
          if (typeof cmd.keybinding !== 'object' || cmd.keybinding === null) {
            diagnostics.push({
              kind: 'error',
              code: 'manifest_schema_invalid',
              message: `${cmdPath}.keybinding must be an object with 'key' (required) and optional 'mac'.`,
              extensionId: typeof m.id === 'string' ? m.id : undefined,
              detail: { path: cmdPath, field: 'keybinding' },
            });
          } else {
            const kb = cmd.keybinding as Record<string, unknown>;
            if (typeof kb.key !== 'string' || kb.key.length === 0) {
              diagnostics.push({
                kind: 'error',
                code: 'manifest_schema_invalid',
                message: `${cmdPath}.keybinding.key must be a non-empty string.`,
                extensionId: typeof m.id === 'string' ? m.id : undefined,
                detail: { path: cmdPath, field: 'keybinding.key' },
              });
            }
            if (kb.mac !== undefined && (typeof kb.mac !== 'string' || kb.mac.length === 0)) {
              diagnostics.push({
                kind: 'error',
                code: 'manifest_schema_invalid',
                message: `${cmdPath}.keybinding.mac must be a non-empty string when provided.`,
                extensionId: typeof m.id === 'string' ? m.id : undefined,
                detail: { path: cmdPath, field: 'keybinding.mac' },
              });
            }
          }
        }

        // Validate menu object if present
        if (cmd.menu !== undefined) {
          if (typeof cmd.menu !== 'object' || cmd.menu === null) {
            diagnostics.push({
              kind: 'error',
              code: 'manifest_schema_invalid',
              message: `${cmdPath}.menu must be an object with 'context' (required) and optional 'group'/'order'.`,
              extensionId: typeof m.id === 'string' ? m.id : undefined,
              detail: { path: cmdPath, field: 'menu' },
            });
          } else {
            const menu = cmd.menu as Record<string, unknown>;
            const validContexts = [
              'timeline-context',
              'clip-context',
              'track-context',
              'clip-selection-context',
              'canvas-context',
            ];
            if (typeof menu.context !== 'string' || !validContexts.includes(menu.context)) {
              diagnostics.push({
                kind: 'error',
                code: 'manifest_schema_invalid',
                message: `${cmdPath}.menu.context must be one of: ${validContexts.join(', ')}.`,
                extensionId: typeof m.id === 'string' ? m.id : undefined,
                detail: { path: cmdPath, field: 'menu.context', value: menu.context },
              });
            }
            if (menu.group !== undefined && (typeof menu.group !== 'string' || menu.group.length === 0)) {
              diagnostics.push({
                kind: 'error',
                code: 'manifest_schema_invalid',
                message: `${cmdPath}.menu.group must be a non-empty string when provided.`,
                extensionId: typeof m.id === 'string' ? m.id : undefined,
                detail: { path: cmdPath, field: 'menu.group' },
              });
            }
            if (menu.order !== undefined && typeof menu.order !== 'number') {
              diagnostics.push({
                kind: 'error',
                code: 'manifest_schema_invalid',
                message: `${cmdPath}.menu.order must be a number when provided.`,
                extensionId: typeof m.id === 'string' ? m.id : undefined,
                detail: { path: cmdPath, field: 'menu.order' },
              });
            }
          }
        }
      }
    }
  }

  // Check for unknown top-level fields (additionalProperties: false on root in schema)
  const knownRootFields = new Set([
    'id', 'name', 'version', 'apiVersion', 'description', 'author',
    'permissions', 'settingsSchema', 'contributions',
  ]);
  for (const key of Object.keys(m)) {
    if (!knownRootFields.has(key)) {
      diagnostics.push({
        kind: 'error',
        code: 'unknown_manifest_field',
        message: `Manifest contains unknown top-level field \"${key}\".`,
        extensionId: typeof m.id === 'string' ? m.id : undefined,
        detail: { field: key },
      });
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
    const manifestMajorLabel = manifestMajor === null ? 'unknown' : String(manifestMajor);
    const runtimeMajorLabel = runtimeMajor === null ? 'unknown' : String(runtimeMajor);
    return [{
      kind: 'error',
      code: 'api_version_incompatible',
      message: `Extension "${manifest.id}" requires API version ${manifest.apiVersion} (major ${manifestMajorLabel}), but runtime is ${RUNTIME_API_VERSION} (major ${runtimeMajorLabel}).`,
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
  if (!manifest.permissions) {
    return [];
  }

  const rejected = manifest.permissions.filter(
    (perm) => !(ALLOWED_PERMISSIONS as readonly string[]).includes(perm),
  );

  if (rejected.length === 0) {
    return [];
  }

  return [{
    kind: 'error',
    code: 'permission_rejected',
    message: `Extension "${manifest.id}" requests unsupported permissions: ${rejected.join(', ')}. Allowed: ${ALLOWED_PERMISSIONS.join(', ')}.`,
    extensionId: manifest.id,
    detail: { rejected },
  }];
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
  const duplicates = new Map<string, Set<string>>();

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
        const collections = duplicates.get(item.id) ?? new Set<string>([seen.get(item.id)!]);
        collections.add(collectionName);
        duplicates.set(item.id, collections);
      } else {
        seen.set(item.id, collectionName);
      }
    }
  }

  if (duplicates.size > 0) {
    diagnostics.push({
      kind: 'error',
      code: 'duplicate_descriptor_id',
      message: `Duplicate descriptor IDs found across manifest contribution collections: ${Array.from(duplicates.entries())
        .map(([id, collections]) => `"${id}" in ${Array.from(collections).join(', ')}`)
        .join('; ')}.`,
      extensionId: manifest.id,
      detail: {
        duplicates: Array.from(duplicates.entries()).map(([id, collections]) => ({
          id,
          collections: Array.from(collections),
        })),
      },
    });
  }

  return diagnostics;
}

/**
 * Detect duplicate normalized command IDs across multiple manifests.
 *
 * Command IDs are namespaced as `${manifest.id}.${localCommandId}`.
 * Returns diagnostics for any collision found; only the first occurrence
 * from each manifest is retained in the runtime registry.
 */
export function validateCommandDuplicateIds(
  manifests: readonly ExtensionManifest[],
): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];
  const seen = new Map<string, { manifestId: string; localId: string }>();

  for (const manifest of manifests) {
    const commands = manifest.contributions?.commands;
    if (!commands) continue;

    for (const cmd of commands) {
      const fullId = `${manifest.id}.${cmd.id}`;
      const existing = seen.get(fullId);

      if (existing) {
        diagnostics.push({
          kind: 'error',
          code: 'duplicate_command_id',
          message: `Duplicate command ID \"${fullId}\" declared by both \"${existing.manifestId}\" and \"${manifest.id}\". Only the first declaration will be registered.`,
          extensionId: manifest.id,
          detail: {
            fullCommandId: fullId,
            localId: cmd.id,
            firstManifest: existing.manifestId,
            secondManifest: manifest.id,
          },
        });
      } else {
        seen.set(fullId, { manifestId: manifest.id, localId: cmd.id });
      }
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Keybinding normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a keybinding string for duplicate detection.
 *
 * Lowercases the key string, collapses whitespace, and strips leading/trailing
 * whitespace so that "Ctrl+S", "ctrl+s", and "  ctrl+s  " all compare equal.
 * macOS-specific bindings (the `mac` field) are compared separately and only
 * against other `mac` bindings.
 */
export function normalizeKeybinding(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Detect duplicate normalized keybindings across command contributions from
 * multiple manifests.
 *
 * Normalizes each keybinding's `key` and optional `mac` fields and emits a
 * warning diagnostic when two different fully-qualified command IDs map to
 * the same normalized shortcut. Only the first occurrence is kept as the
 * active binding; later duplicates produce diagnostics.
 */
export function validateCommandDuplicateKeybindings(
  manifests: readonly ExtensionManifest[],
): ExtensionDiagnostic[] {
  const diagnostics: ExtensionDiagnostic[] = [];

  // Track normalized key -> { fullCommandId, manifestId }
  const seenKey = new Map<string, { fullCommandId: string; manifestId: string }>();
  const seenMac = new Map<string, { fullCommandId: string; manifestId: string }>();

  for (const manifest of manifests) {
    const commands = manifest.contributions?.commands;
    if (!commands) continue;

    for (const cmd of commands) {
      const fullId = `${manifest.id}.${cmd.id}`;

      if (cmd.keybinding?.key) {
        const normalized = normalizeKeybinding(cmd.keybinding.key);
        const existing = seenKey.get(normalized);

        if (existing) {
          diagnostics.push({
            kind: 'warning',
            code: 'duplicate_keybinding',
            message: `Duplicate keybinding "${cmd.keybinding.key}" (normalized: "${normalized}") ` +
              `declared by both "${existing.manifestId}" (command "${existing.fullCommandId}") ` +
              `and "${manifest.id}" (command "${fullId}").`,
            extensionId: manifest.id,
            detail: {
              fullCommandId: fullId,
              localId: cmd.id,
              keybinding: cmd.keybinding.key,
              normalizedKeybinding: normalized,
              firstManifest: existing.manifestId,
              firstFullCommandId: existing.fullCommandId,
              secondManifest: manifest.id,
              secondFullCommandId: fullId,
            },
          });
        } else {
          seenKey.set(normalized, { fullCommandId: fullId, manifestId: manifest.id });
        }
      }

      if (cmd.keybinding?.mac) {
        const normalized = normalizeKeybinding(cmd.keybinding.mac);
        const existing = seenMac.get(normalized);

        if (existing) {
          diagnostics.push({
            kind: 'warning',
            code: 'duplicate_keybinding',
            message: `Duplicate Mac keybinding "${cmd.keybinding.mac}" (normalized: "${normalized}") ` +
              `declared by both "${existing.manifestId}" (command "${existing.fullCommandId}") ` +
              `and "${manifest.id}" (command "${fullId}").`,
            extensionId: manifest.id,
            detail: {
              fullCommandId: fullId,
              localId: cmd.id,
              keybindingMac: cmd.keybinding.mac,
              normalizedKeybinding: normalized,
              firstManifest: existing.manifestId,
              firstFullCommandId: existing.fullCommandId,
              secondManifest: manifest.id,
              secondFullCommandId: fullId,
            },
          });
        } else {
          seenMac.set(normalized, { fullCommandId: fullId, manifestId: manifest.id });
        }
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

  const slotDeclarations = manifest.contributions?.slots ?? [];
  const dialogDeclarations = manifest.contributions?.dialogs ?? [];
  const panelDeclarations = manifest.contributions?.panels ?? [];
  const inspectorDeclarations = manifest.contributions?.inspectorSections ?? [];

  const declaredDialogIds = new Set(dialogDeclarations.map((item) => item.id));
  const declaredPanelIds = new Set(panelDeclarations.map((item) => item.id));
  const declaredInspectorIds = new Set(inspectorDeclarations.map((item) => item.id));

  const configSlots = isRecord(config.slots) ? config.slots : undefined;
  const configDialogDescriptors = collectDescriptorArray(config.dialogHost, 'dialogs');
  const configPanelDescriptors = collectDescriptorArray(config.registry, 'panels');
  const configInspectorDescriptors = collectDescriptorArray(config.registry, 'inspectorSections');

  for (const declaration of slotDeclarations) {
    if (typeof configSlots?.[declaration.slot] !== 'function') {
      diagnostics.push(contributionMismatchDiagnostic(
        manifest.id,
        `Manifest slot contribution "${declaration.id}" declares slot "${declaration.slot}" but config.slots.${declaration.slot} is not registered.`,
        { contributionId: declaration.id, slot: declaration.slot },
        'error',
      ));
    }
  }

  validateDescriptorCollection(
    manifest.id,
    'dialogs',
    'dialogHost.dialogs',
    declaredDialogIds,
    configDialogDescriptors,
    diagnostics,
  );
  validateDescriptorCollection(
    manifest.id,
    'panels',
    'registry.panels',
    declaredPanelIds,
    configPanelDescriptors,
    diagnostics,
  );
  validateDescriptorCollection(
    manifest.id,
    'inspectorSections',
    'registry.inspectorSections',
    declaredInspectorIds,
    configInspectorDescriptors,
    diagnostics,
  );

  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectDescriptorArray(
  container: unknown,
  key: 'dialogs' | 'panels' | 'inspectorSections',
): readonly Record<string, unknown>[] {
  if (!isRecord(container) || !Array.isArray(container[key])) {
    return [];
  }

  return (container[key] as unknown[]).filter(isRecord);
}

function contributionMismatchDiagnostic(
  extensionId: string,
  message: string,
  detail: Record<string, unknown>,
  severity: 'warning' | 'error' = 'warning',
): ExtensionDiagnostic {
  return {
    kind: severity,
    code: 'contribution_id_mismatch',
    message,
    extensionId,
    detail,
  };
}

function validateDescriptorCollection(
  extensionId: string,
  collection: 'dialogs' | 'panels' | 'inspectorSections',
  configPath: string,
  declaredIds: ReadonlySet<string>,
  configDescriptors: readonly Record<string, unknown>[],
  diagnostics: ExtensionDiagnostic[],
): void {
  const registeredIds = new Set(
    configDescriptors
      .filter((descriptor) => typeof descriptor.render === 'function')
      .map((descriptor) => descriptor.id)
      .filter((id): id is string => typeof id === 'string'),
  );

  for (const declaredId of declaredIds) {
    if (!registeredIds.has(declaredId)) {
      diagnostics.push(contributionMismatchDiagnostic(
        extensionId,
        `Manifest ${collection} contribution "${declaredId}" has no matching config descriptor in ${configPath}.`,
        { contributionId: declaredId },
      ));
    }
  }
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
