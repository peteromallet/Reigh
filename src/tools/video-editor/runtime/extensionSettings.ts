/**
 * @publicContract
 * Extension settings resolution.
 *
 * `resolveExtensionSettings` collects JSON-only defaults from a manifest's
 * `settingsSchema`, deep-merges persisted overrides, validates the result
 * against the schema, and returns resolved settings with diagnostics.
 * Invalid overrides trigger diagnostics but the result always falls back
 * to manifest defaults so the extension can still load.
 */

import type {
  ExtensionManifest,
  ExtensionState,
  ExtensionSettings,
  ExtensionDiagnostic,
  ExtensionDiagnosticCode,
} from './extensionManifest.ts';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ResolvedExtensionSettings {
  /** Resolved settings (always a plain object). */
  settings: ExtensionSettings;
  /** Diagnostics from override validation (empty = no issues). */
  diagnostics: ExtensionDiagnostic[];
}

// ---------------------------------------------------------------------------
// Default collection
// ---------------------------------------------------------------------------

/**
 * Walk a JSON Schema properties tree and collect default values into a
 * plain object.  Only object-type schemas with `properties` are recursed;
 * scalars, arrays, and schemas without defaults are skipped.
 */
function collectSchemaDefaults(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};

  const defaults: Record<string, unknown> = {};

  if (schema.type === 'object' && typeof schema.properties === 'object' && schema.properties !== null) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (propSchema && typeof propSchema === 'object' && !Array.isArray(propSchema)) {
        if ('default' in propSchema) {
          defaults[key] = propSchema.default;
          // When the default is a plain object and the schema has nested
          // properties, recurse to overlay nested defaults on top of the
          // object-level default.
          if (
            isPlainObject(propSchema.default) &&
            propSchema.type === 'object' &&
            typeof propSchema.properties === 'object' &&
            propSchema.properties !== null
          ) {
            const nested = collectSchemaDefaults(propSchema);
            if (Object.keys(nested).length > 0) {
              defaults[key] = deepMerge(
                propSchema.default as Record<string, unknown>,
                nested,
              );
            }
          }
        } else if (propSchema.type === 'object') {
          // Recurse into nested objects even without an explicit default
          const nested = collectSchemaDefaults(propSchema);
          if (Object.keys(nested).length > 0) {
            defaults[key] = nested;
          }
        }
      }
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge `overrides` into `base`.
 * - Plain objects are merged recursively.
 * - Scalars, arrays, and null replace the base value wholesale.
 * - Keys present only in overrides are added.
 */
function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };

  for (const [key, overrideVal] of Object.entries(overrides)) {
    if (isPlainObject(overrideVal) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Ajv validation
// ---------------------------------------------------------------------------

import Ajv from 'ajv';

/** Single Ajv instance reused across validations. */
const _ajv = new Ajv({ allErrors: true, strict: true });

/**
 * Validate merged settings against the manifest's settingsSchema using Ajv.
 *
 * Returns a single diagnostic with Ajv error objects and the rejected
 * overrides on failure, or an empty array on success.  Schema compilation
 * errors are also surfaced as diagnostics.
 */
function validateSettings(
  settings: Record<string, unknown>,
  schema: Record<string, unknown>,
  extensionId: string,
  overrides: Record<string, unknown>,
): ExtensionDiagnostic[] {
  try {
    const validate = _ajv.compile(schema);
    const valid = validate(settings);

    if (!valid) {
      const ajvErrors = validate.errors ?? [];
      const errorSummary = ajvErrors
        .map((e) => e.message)
        .filter(Boolean)
        .join('; ');
      return [
        {
          kind: 'error',
          code: 'settings_override_invalid' as ExtensionDiagnosticCode,
          message: `Extension "${extensionId}": settings override validation failed${errorSummary ? `: ${errorSummary}` : ''}. Falling back to manifest defaults.`,
          extensionId,
          detail: {
            errors: ajvErrors.map((e) => ({
              keyword: e.keyword,
              message: e.message,
              params: e.params,
              instancePath: e.instancePath,
              schemaPath: e.schemaPath,
            })),
            overrides,
          },
        },
      ];
    }
  } catch (err: unknown) {
    // Schema compilation failure
    const message =
      err instanceof Error ? err.message : 'Unknown schema compilation error';
    return [
      {
        kind: 'error',
        code: 'settings_override_invalid' as ExtensionDiagnosticCode,
        message: `Extension "${extensionId}": settings schema is invalid and could not be used to validate overrides: ${message}. Falling back to manifest defaults.`,
        extensionId,
        detail: {
          errors: [
            {
              keyword: 'schema_compilation_error',
              message,
              params: {},
            },
          ],
          overrides,
        },
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve extension settings from manifest defaults and persisted overrides.
 *
 * 1. Collect JSON-only defaults from the manifest's `settingsSchema`.
 * 2. If the extension has persisted `settingsOverrides`, deep-merge them
 *    onto the defaults.
 * 3. Validate the merged result against the schema.
 * 4. On validation failure, emit diagnostics and fall back to defaults.
 * 5. Return the resolved settings and any diagnostics.
 */
export function resolveExtensionSettings(
  manifest: ExtensionManifest,
  state: ExtensionState,
): ResolvedExtensionSettings {
  const diagnostics: ExtensionDiagnostic[] = [];

  // 1. Collect defaults from the manifest's settingsSchema.
  const defaults = collectSchemaDefaults(
    manifest.settingsSchema as Record<string, unknown> | undefined,
  );

  // If there is no settingsSchema at all, there is nothing to validate
  // overrides against — discard them and return collected defaults (which
  // are empty for a missing schema).  Boolean schemas (true/false) are
  // intentional and allow all / forbid all without type-level validation.
  const schema = manifest.settingsSchema as Record<string, unknown> | boolean | undefined;
  if (schema === undefined || schema === null) {
    return { settings: defaults, diagnostics };
  }

  // 2. Merge overrides if present.
  let merged: Record<string, unknown>;
  if (state.settingsOverrides && Object.keys(state.settingsOverrides).length > 0) {
    merged = deepMerge(defaults, state.settingsOverrides);

    // 3. Validate merged result (only for object schemas; boolean schemas allow
    //    / forbid everything but cannot be validated against).
    const validationDiags =
      typeof schema === 'object'
        ? validateSettings(merged, schema, manifest.id, state.settingsOverrides ?? {})
        : [];

    if (validationDiags.length > 0) {
      diagnostics.push(...validationDiags);
      // 4. Fall back to defaults on validation failure.
      return { settings: defaults, diagnostics };
    }
  } else {
    merged = defaults;

    // Even without overrides, compile the schema to detect malformed schemas
    // that would prevent future validation.
    if (typeof schema === 'object') {
      try {
        _ajv.compile(schema);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unknown schema compilation error';
        diagnostics.push({
          kind: 'error',
          code: 'settings_override_invalid' as ExtensionDiagnosticCode,
          message: `Extension "${manifest.id}": settings schema is invalid and could not be used to validate overrides: ${message}. Falling back to manifest defaults.`,
          extensionId: manifest.id,
          detail: {
            errors: [
              {
                keyword: 'schema_compilation_error',
                message,
                params: {},
              },
            ],
            overrides: {},
          },
        });
      }
    }
  }

  // 5. Return resolved settings.
  return { settings: merged, diagnostics };
}
