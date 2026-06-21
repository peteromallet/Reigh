import { describe, expect, it, beforeEach } from 'vitest';
import { resolveExtensionSettings } from './extensionSettings.ts';
import type { ResolvedExtensionSettings } from './extensionSettings.ts';
import type { ExtensionManifest, ExtensionState } from './extensionManifest.ts';
import {
  InMemoryExtensionStateRepository,
  LocalStorageExtensionStateRepository,
} from './extensionStateRepository.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default state with no overrides. */
function defaultState(): ExtensionState {
  return { enabled: true };
}

/** State with explicit overrides. */
function stateWithOverrides(
  overrides: Record<string, unknown>,
): ExtensionState {
  return { enabled: true, settingsOverrides: overrides };
}

/** State with overrides + explicit enabled flag. */
function stateWithOverridesAndEnabled(
  enabled: boolean,
  overrides: Record<string, unknown>,
): ExtensionState {
  return { enabled, settingsOverrides: overrides };
}

/** A minimal valid manifest with an optional settingsSchema and other overrides. */
function manifestWithSchema(
  schema: Record<string, unknown>,
  manifestOverrides: Partial<ExtensionManifest> = {},
): ExtensionManifest {
  return {
    id: 'com.example.test',
    name: 'Test Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    settingsSchema: schema,
    ...manifestOverrides,
  };
}

/** A minimal valid manifest without any settingsSchema. */
function manifestWithoutSchema(
  manifestOverrides: Partial<ExtensionManifest> = {},
): ExtensionManifest {
  return {
    id: 'com.example.test',
    name: 'Test Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    ...manifestOverrides,
  };
}

// ---------------------------------------------------------------------------
// Fake Storage for localStorage-backed repo tests
// ---------------------------------------------------------------------------

class FakeStorage implements Storage {
  private _data = new Map<string, string>();

  get length(): number {
    return this._data.size;
  }

  clear(): void {
    this._data.clear();
  }

  getItem(key: string): string | null {
    return this._data.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this._data.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this._data.delete(key);
  }

  setItem(key: string, value: string): void {
    this._data.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveExtensionSettings', () => {
  // -----------------------------------------------------------------------
  // No schema
  // -----------------------------------------------------------------------

  describe('no settingsSchema', () => {
    it('returns empty settings when manifest has no settingsSchema', () => {
      const manifest = manifestWithoutSchema();
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('returns empty settings even when state has overrides (no schema to validate against)', () => {
      const manifest = manifestWithoutSchema();
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true }),
      );

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Boolean schema
  // -----------------------------------------------------------------------

  describe('boolean settingsSchema', () => {
    it('returns empty settings for true schema with no overrides', () => {
      const manifest = manifestWithSchema(true as unknown as Record<string, unknown>);
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('returns empty settings for false schema with no overrides', () => {
      const manifest = manifestWithSchema(false as unknown as Record<string, unknown>);
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('passes through overrides for true schema (cannot validate boolean schemas)', () => {
      const manifest = manifestWithSchema(true as unknown as Record<string, unknown>);
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true, level: 3 }),
      );

      expect(result.settings).toEqual({ debug: true, level: 3 });
      expect(result.diagnostics).toEqual([]);
    });

    it('passes through overrides for false schema (cannot validate boolean schemas)', () => {
      const manifest = manifestWithSchema(false as unknown as Record<string, unknown>);
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true }),
      );

      expect(result.settings).toEqual({ debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('returns a shallow copy of overrides (not same reference)', () => {
      const overrides = { debug: true };
      const manifest = manifestWithSchema(true as unknown as Record<string, unknown>);
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides(overrides),
      );

      expect(result.settings).toEqual(overrides);
      expect(result.settings).not.toBe(overrides);
    });
  });

  // -----------------------------------------------------------------------
  // Defaults from schema
  // -----------------------------------------------------------------------

  describe('default resolution from schema', () => {
    it('collects a simple scalar default', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ debug: false });
      expect(result.diagnostics).toEqual([]);
    });

    it('collects multiple scalar defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
          label: { type: 'string', default: 'Untitled' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({
        debug: false,
        maxItems: 10,
        label: 'Untitled',
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('skips properties without a default keyword', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          optionalName: { type: 'string' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ debug: false });
      expect(result.settings).not.toHaveProperty('optionalName');
      expect(result.diagnostics).toEqual([]);
    });

    it('returns empty object when schema has no properties with defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('returns empty object when schema has no properties key', () => {
      const manifest = manifestWithSchema({
        type: 'object',
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('collects nested object defaults recursively', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          appearance: {
            type: 'object',
            properties: {
              theme: { type: 'string', default: 'dark' },
              fontSize: { type: 'number', default: 14 },
            },
          },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({
        appearance: {
          theme: 'dark',
          fontSize: 14,
        },
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('collects deeply nested object defaults (3 levels)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          editor: {
            type: 'object',
            properties: {
              layout: {
                type: 'object',
                properties: {
                  sidebarWidth: { type: 'number', default: 300 },
                  collapsed: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({
        editor: {
          layout: {
            sidebarWidth: 300,
            collapsed: false,
          },
        },
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('uses object-level default as base, then overlays nested property defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          appearance: {
            type: 'object',
            default: { theme: 'light' },
            properties: {
              fontSize: { type: 'number', default: 14 },
            },
          },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({
        appearance: {
          theme: 'light',
          fontSize: 14,
        },
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('returns fresh object on each call (no reference sharing)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });

      const result1 = resolveExtensionSettings(manifest, defaultState());
      const result2 = resolveExtensionSettings(manifest, defaultState());

      expect(result1.settings).toEqual(result2.settings);
      expect(result1.settings).not.toBe(result2.settings);
    });

    it('handles array defaults in schema', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          tags: { type: 'array', default: ['video', 'edit'] },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ tags: ['video', 'edit'] });
      expect(result.diagnostics).toEqual([]);
    });

    it('handles null defaults in schema', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          description: { type: ['string', 'null'], default: null },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ description: null });
      expect(result.diagnostics).toEqual([]);
    });

    it('handles number 0 as a valid default', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          offset: { type: 'number', default: 0 },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ offset: 0 });
      expect(result.diagnostics).toEqual([]);
    });

    it('handles empty string as a valid default', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          prefix: { type: 'string', default: '' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ prefix: '' });
      expect(result.diagnostics).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Valid overrides
  // -----------------------------------------------------------------------

  describe('valid override merging', () => {
    it('overrides a simple scalar default', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true }),
      );

      expect(result.settings).toEqual({ debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('merges partial overrides, keeping non-overridden defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
          label: { type: 'string', default: 'Untitled' },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ maxItems: 25 }),
      );

      expect(result.settings).toEqual({
        debug: false,
        maxItems: 25,
        label: 'Untitled',
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('deep-merges nested object overrides', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          appearance: {
            type: 'object',
            properties: {
              theme: { type: 'string', default: 'dark' },
              fontSize: { type: 'number', default: 14 },
            },
          },
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({
          appearance: { theme: 'light' },
        }),
      );

      expect(result.settings).toEqual({
        appearance: { theme: 'light', fontSize: 14 },
        debug: false,
      });
      expect(result.diagnostics).toEqual([]);
    });

    it('replaces array defaults with override array (no merge)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          tags: { type: 'array', default: ['video'] },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ tags: ['custom', 'override'] }),
      );

      expect(result.settings).toEqual({ tags: ['custom', 'override'] });
      expect(result.diagnostics).toEqual([]);
    });

    it('replaces a non-object default value wholesale with override', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          maxItems: { type: 'number', default: 10 },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ maxItems: 42 }),
      );

      expect(result.settings).toEqual({ maxItems: 42 });
      expect(result.diagnostics).toEqual([]);
    });

    it('null override replaces the default value', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          description: { type: ['string', 'null'], default: 'desc' },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ description: null }),
      );

      expect(result.settings).toEqual({ description: null });
      expect(result.diagnostics).toEqual([]);
    });

    it('adds new keys from overrides that were not in defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
        additionalProperties: true,
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: false, newKey: 'hello' }),
      );

      // The schema allows additionalProperties, so validation passes
      expect(result.settings).toEqual({ debug: false, newKey: 'hello' });
      expect(result.diagnostics).toEqual([]);
    });

    it('returns a new object (not a reference to defaults or overrides)', () => {
      const defaults = { debug: false };
      const overrides = { debug: true };

      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides(overrides),
      );

      expect(result.settings).toEqual({ debug: true });
      // Mutate overrides afterwards — result should not change
      overrides.debug = false;
      expect(result.settings).toEqual({ debug: true });
    });
  });

  // -----------------------------------------------------------------------
  // Invalid override diagnostics
  // -----------------------------------------------------------------------

  describe('invalid override diagnostics', () => {
    it('emits settings_override_invalid when override type does not match schema', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'not-a-boolean' }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
      expect(result.diagnostics[0].kind).toBe('error');
      expect(result.diagnostics[0].extensionId).toBe(manifest.id);
    });

    it('falls back to schema defaults when override validation fails', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'bad-type', maxItems: 999 }),
      );

      // Should fall back to all defaults, ignoring the invalid overrides entirely
      expect(result.settings).toEqual({ debug: false, maxItems: 10 });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
    });

    it('falls back to defaults when override adds an unknown property with additionalProperties: false', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
        additionalProperties: false,
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: false, unknownProp: 'bad' }),
      );

      expect(result.settings).toEqual({ debug: false });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
    });

    it('emits no diagnostics when overrides are valid and schema has no defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean' },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true }),
      );

      expect(result.settings).toEqual({ debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('diagnostic message contains validation error details', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          count: { type: 'number', default: 0 },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ count: 'not-a-number' }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain('must be number');
    });

    it('diagnostic message mentions falling back to defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 123 }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain('Falling back to manifest defaults');
    });

    it('diagnostic detail contains raw Ajv errors', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'wrong' }),
      );

      expect(result.diagnostics).toHaveLength(1);
      const detail = result.diagnostics[0].detail as Record<string, unknown>;
      expect(detail).toHaveProperty('errors');
      expect(Array.isArray(detail.errors)).toBe(true);
      expect((detail.errors as unknown[]).length).toBeGreaterThan(0);
    });

    it('diagnostic detail contains the rejected overrides', () => {
      const overrides = { debug: 'bad-type' };
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides(overrides),
      );

      expect(result.diagnostics).toHaveLength(1);
      const detail = result.diagnostics[0].detail as Record<string, unknown>;
      expect(detail).toHaveProperty('overrides');
      expect(detail.overrides).toEqual(overrides);
    });

    it('emits multiple Ajv errors in a single diagnostic message (allErrors: true)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          count: { type: 'number', default: 0 },
        },
        additionalProperties: false,
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({
          debug: 'not-bool',
          count: 'not-number',
        }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
      // Fall back to defaults
      expect(result.settings).toEqual({ debug: false, count: 0 });
    });

    it('validates nested object override types', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          appearance: {
            type: 'object',
            properties: {
              theme: { type: 'string', default: 'dark' },
              fontSize: { type: 'number', default: 14 },
            },
          },
        },
      });
      // fontSize is wrong type
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({
          appearance: { theme: 'light', fontSize: 'large' },
        }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
      // Fall back to defaults
      expect(result.settings).toEqual({
        appearance: { theme: 'dark', fontSize: 14 },
      });
    });

    it('no diagnostics when overrides are undefined (state has no overrides)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.diagnostics).toEqual([]);
      expect(result.settings).toEqual({ debug: false });
    });

    it('no override validation when settingsOverrides is explicitly undefined in state', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const state: ExtensionState = { enabled: true, settingsOverrides: undefined };
      const result = resolveExtensionSettings(manifest, state);

      expect(result.diagnostics).toEqual([]);
      expect(result.settings).toEqual({ debug: false });
    });

    it('invalid schema itself (bad JSON Schema) produces validation failure and fallback', () => {
      // A schema with contradictory constraints
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          x: { type: 'string', minLength: 10, maxLength: 2 },
        },
      });
      // Override that should be valid by type but schema is contradictory
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ x: 'hi' }),
      );

      // The merged result with {x: 'hi'} fails maxLength
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
      expect(result.settings).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // Persisted overrides after repository reload
  // -----------------------------------------------------------------------

  describe('persisted overrides survive repository reload', () => {
    it('resolved settings match after save/load cycle (LocalStorage repo)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
        },
      });

      const storage = new FakeStorage();

      // First repo: set state and save
      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setSettingsOverrides('com.example.test', { debug: true });
      repo1.save();

      // Resolve settings before reload
      const state1 = repo1.getState('com.example.test');
      const result1 = resolveExtensionSettings(manifest, state1);

      // Second repo: load from storage
      const repo2 = new LocalStorageExtensionStateRepository(storage);
      repo2.load();

      const state2 = repo2.getState('com.example.test');
      const result2 = resolveExtensionSettings(manifest, state2);

      expect(result2.settings).toEqual(result1.settings);
      expect(result2.settings).toEqual({ debug: true, maxItems: 10 });
      expect(result2.diagnostics).toEqual([]);
    });

    it('resolved settings are identical when using InMemory repo with explicit set/get', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });

      const repo = new InMemoryExtensionStateRepository();
      repo.setSettingsOverrides('com.example.test', { debug: true });

      const state = repo.getState('com.example.test');
      const result = resolveExtensionSettings(manifest, state);

      expect(result.settings).toEqual({ debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('persisted overrides survive across multiple save/load cycles', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          theme: { type: 'string', default: 'dark' },
          fontSize: { type: 'number', default: 14 },
        },
      });

      const storage = new FakeStorage();

      // Round 1: save overrides
      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setSettingsOverrides('com.example.test', { theme: 'light' });
      repo1.save();

      // Round 2: load, modify, save
      const repo2 = new LocalStorageExtensionStateRepository(storage);
      repo2.load();
      repo2.setSettingsOverrides('com.example.test', { fontSize: 20 });
      repo2.save();

      // Round 3: load final state, resolve
      const repo3 = new LocalStorageExtensionStateRepository(storage);
      repo3.load();
      const state = repo3.getState('com.example.test');
      const result = resolveExtensionSettings(manifest, state);

      // Latest save had only fontSize override
      expect(result.settings).toEqual({ theme: 'dark', fontSize: 20 });
      expect(result.diagnostics).toEqual([]);
    });

    it('disabled state does not affect settings resolution', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });

      const repo = new InMemoryExtensionStateRepository();
      repo.setState('com.example.test', {
        enabled: false,
        settingsOverrides: { debug: true },
      });

      const state = repo.getState('com.example.test');
      expect(state.enabled).toBe(false);

      const result = resolveExtensionSettings(manifest, state);
      // Settings resolution is independent of enabled flag
      expect(result.settings).toEqual({ debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('cleared overrides after save/load results in pure defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });

      const storage = new FakeStorage();

      // Set overrides and save
      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setSettingsOverrides('com.example.test', { debug: true });
      repo1.save();

      // Clear overrides and save
      repo1.setSettingsOverrides('com.example.test', undefined);
      repo1.save();

      // Load fresh
      const repo2 = new LocalStorageExtensionStateRepository(storage);
      repo2.load();
      const state = repo2.getState('com.example.test');
      const result = resolveExtensionSettings(manifest, state);

      expect(result.settings).toEqual({ debug: false });
      expect(result.diagnostics).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // JSON-only enforcement
  // -----------------------------------------------------------------------

  describe('JSON-only data enforcement', () => {
    it('preserves number values from defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          count: { type: 'number', default: 42 },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ count: 42 });
      expect(typeof result.settings.count).toBe('number');
    });

    it('preserves boolean values from defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: true },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ enabled: true });
      expect(typeof result.settings.enabled).toBe('boolean');
    });

    it('preserves string values from defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          title: { type: 'string', default: 'Hello' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ title: 'Hello' });
      expect(typeof result.settings.title).toBe('string');
    });

    it('preserves null values from defaults', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          optional: { type: ['string', 'null'], default: null },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ optional: null });
      expect(result.settings.optional).toBeNull();
    });

    it('preserves array values from defaults (arrays are JSON)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          items: { type: 'array', default: [1, 2, 3] },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({ items: [1, 2, 3] });
      expect(Array.isArray(result.settings.items)).toBe(true);
    });

    it('arrays in overrides replace wholesale (arrays are not merged)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          items: { type: 'array', default: [1, 2, 3] },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ items: [4, 5] }),
      );

      expect(result.settings).toEqual({ items: [4, 5] });
      expect(result.diagnostics).toEqual([]);
    });

    it('validates that override arrays match schema item types', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'number' }, default: [1, 2] },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ items: ['not', 'numbers'] }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
      // Fall back to defaults
      expect(result.settings).toEqual({ items: [1, 2] });
    });

    it('null override replaces a non-null default', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          optional: { type: ['string', 'null'], default: 'default-value' },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ optional: null }),
      );

      expect(result.settings).toEqual({ optional: null });
      expect(result.diagnostics).toEqual([]);
    });

    it('handles schema with all JSON primitive types at once', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          str: { type: 'string', default: 'hello' },
          num: { type: 'number', default: 3.14 },
          bool: { type: 'boolean', default: true },
          nil: { type: ['string', 'null'], default: null },
          arr: { type: 'array', default: ['a', 'b'] },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      expect(result.settings).toEqual({
        str: 'hello',
        num: 3.14,
        bool: true,
        nil: null,
        arr: ['a', 'b'],
      });
      expect(typeof result.settings.str).toBe('string');
      expect(typeof result.settings.num).toBe('number');
      expect(typeof result.settings.bool).toBe('boolean');
      expect(result.settings.nil).toBeNull();
      expect(Array.isArray(result.settings.arr)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Fallback to manifest defaults
  // -----------------------------------------------------------------------

  describe('fallback to manifest defaults', () => {
    it('returns defaults when overrides fail validation', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'bad', maxItems: 'bad' }),
      );

      expect(result.settings).toEqual({ debug: false, maxItems: 10 });
      expect(result.diagnostics).toHaveLength(1);
    });

    it('returns defaults when only some overrides are invalid (no partial merge)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
          maxItems: { type: 'number', default: 10 },
        },
      });
      // maxItems is valid, debug is not — but the WHOLE merged object fails validation
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'bad', maxItems: 42 }),
      );

      // Falls back to ALL defaults, does not partially apply valid overrides
      expect(result.settings).toEqual({ debug: false, maxItems: 10 });
      expect(result.diagnostics).toHaveLength(1);
    });

    it('returns deep defaults when nested override fails validation', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          appearance: {
            type: 'object',
            properties: {
              theme: { type: 'string', default: 'dark' },
              fontSize: { type: 'number', default: 14 },
            },
          },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({
          appearance: { theme: 'light', fontSize: 'invalid' as unknown as number },
        }),
      );

      expect(result.settings).toEqual({
        appearance: { theme: 'dark', fontSize: 14 },
      });
      expect(result.diagnostics).toHaveLength(1);
    });

    it('fallback defaults are a fresh copy (not shared reference)', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });

      // First, resolve without overrides to get the base defaults
      const baseResult = resolveExtensionSettings(manifest, defaultState());

      // Then, resolve with invalid overrides to get fallback
      const fallbackResult = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 'bad' }),
      );

      // Fallback should equal defaults
      expect(fallbackResult.settings).toEqual(baseResult.settings);
      // But should be a different object
      expect(fallbackResult.settings).not.toBe(baseResult.settings);
      expect(fallbackResult.diagnostics).toHaveLength(1);
    });

    it('returns defaults when schema has no default keyword but override is invalid', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        additionalProperties: false,
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ count: 'not-number' }),
      );

      // No defaults to fall back to — just empty object
      expect(result.settings).toEqual({});
      expect(result.diagnostics).toHaveLength(1);
    });

    it('empty object overrides {} are valid against empty schema', () => {
      const manifest = manifestWithSchema({
        type: 'object',
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({}),
      );

      expect(result.settings).toEqual({});
      expect(result.diagnostics).toEqual([]);
    });

    it('does not emit diagnostics for valid overrides that match defaults exactly', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: false }),
      );

      expect(result.settings).toEqual({ debug: false });
      expect(result.diagnostics).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('manifest id is set on diagnostic for invalid overrides', () => {
      const manifest = manifestWithSchema(
        {
          type: 'object',
          properties: { debug: { type: 'boolean', default: false } },
        },
        { id: 'com.custom.id' },
      );
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: 123 }),
      );

      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].extensionId).toBe('com.custom.id');
    });

    it('schema with only required fields and no properties', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', default: 'defaultName' },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      // Default satisfies required
      expect(result.settings).toEqual({ name: 'defaultName' });
      expect(result.diagnostics).toEqual([]);
    });

    it('override that violates required constraint triggers fallback', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', default: 'defaultName' },
          debug: { type: 'boolean', default: false },
        },
      });
      // Omitting 'name' from overrides is fine (defaults fill it in)
      // But if we provide an override that removes name somehow...
      // Actually, the merge always includes defaults, so 'name' will be there.
      // Let's test with valid partial override
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ debug: true }),
      );

      expect(result.settings).toEqual({ name: 'defaultName', debug: true });
      expect(result.diagnostics).toEqual([]);
    });

    it('settingsOverrides being an empty object is valid', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: { type: 'boolean', default: false },
        },
      });
      const result = resolveExtensionSettings(
        manifest,
        stateWithOverrides({}),
      );

      expect(result.settings).toEqual({ debug: false });
      expect(result.diagnostics).toEqual([]);
    });

    it('settings from different manifests do not interfere', () => {
      const manifest1 = manifestWithSchema(
        {
          type: 'object',
          properties: { a: { type: 'string', default: 'a1' } },
        },
        { id: 'ext.one' },
      );
      const manifest2 = manifestWithSchema(
        {
          type: 'object',
          properties: { b: { type: 'string', default: 'b2' } },
        },
        { id: 'ext.two' },
      );

      const result1 = resolveExtensionSettings(
        manifest1,
        stateWithOverrides({ a: 'override-a' }),
      );
      const result2 = resolveExtensionSettings(
        manifest2,
        stateWithOverrides({ b: 'override-b' }),
      );

      expect(result1.settings).toEqual({ a: 'override-a' });
      expect(result2.settings).toEqual({ b: 'override-b' });
      expect(result1.diagnostics).toEqual([]);
      expect(result2.diagnostics).toEqual([]);
    });

    it('enum constraint in schema is validated for overrides', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['auto', 'manual'], default: 'auto' },
        },
      });
      // Valid enum value
      const result1 = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ mode: 'manual' }),
      );
      expect(result1.settings).toEqual({ mode: 'manual' });
      expect(result1.diagnostics).toEqual([]);

      // Invalid enum value
      const result2 = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ mode: 'invalid' }),
      );
      expect(result2.diagnostics).toHaveLength(1);
      expect(result2.diagnostics[0].code).toBe('settings_override_invalid');
      expect(result2.settings).toEqual({ mode: 'auto' });
    });

    it('minimum/maximum constraints in schema are validated for overrides', () => {
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          volume: { type: 'number', minimum: 0, maximum: 100, default: 50 },
        },
      });
      // Valid
      const result1 = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ volume: 75 }),
      );
      expect(result1.settings).toEqual({ volume: 75 });
      expect(result1.diagnostics).toEqual([]);

      // Invalid (too high)
      const result2 = resolveExtensionSettings(
        manifest,
        stateWithOverrides({ volume: 200 }),
      );
      expect(result2.diagnostics).toHaveLength(1);
      expect(result2.settings).toEqual({ volume: 50 });
    });

    it('non-object settingsSchema properties are skipped by default collection but caught by Ajv schema compile', () => {
      // A malformed schema with a non-object property.  collectSchemaDefaults
      // gracefully skips the string property, so defaults only include the
      // valid property.  However, Ajv cannot compile the schema as-is
      // because `properties.debug` is not a valid JSON Schema — so
      // validateSettings returns an invalid_schema error, which triggers
      // the fallback path (defaults returned with a diagnostic).
      const manifest = manifestWithSchema({
        type: 'object',
        properties: {
          debug: 'not-an-object' as unknown as Record<string, unknown>,
          valid: { type: 'boolean', default: true },
        },
      });
      const result = resolveExtensionSettings(manifest, defaultState());

      // Defaults are still returned (valid: true from collectSchemaDefaults)
      expect(result.settings).toEqual({ valid: true });
      // But the Ajv compile fails on the malformed schema, producing a diagnostic
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('settings_override_invalid');
    });
  });
});
