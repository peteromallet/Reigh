/**
 * Tests for the injectable extension settings service factory (T8).
 *
 * Validates:
 *  - Factory produces a synchronous settings service with get/set/delete/keys
 *  - Manifest defaults serve as fallback values
 *  - Settings are scoped per extension (different prefixes)
 *  - Dispose cleans up localStorage keys
 *  - Existing createExtensionContext behavior is preserved
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createExtensionSettingsService,
  getSettingsPrefix,
} from './extensionSettingsService';
import { defineExtension, createExtensionContext, CONTEXT_DISPOSE_SYMBOL } from './index';
import type { ExtensionManifest, ExtensionSettingsService } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(extensionId: string, defaults?: Record<string, unknown>): ExtensionManifest {
  return {
    id: extensionId as any,
    version: '1.0.0',
    label: 'Test Extension',
    contributions: [],
    ...(defaults ? { settingsDefaults: defaults } : {}),
  } as ExtensionManifest;
}

function cleanupLocalStorage(extensionId: string): void {
  const prefix = getSettingsPrefix(extensionId);
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

// ---------------------------------------------------------------------------
// getSettingsPrefix
// ---------------------------------------------------------------------------

describe('getSettingsPrefix', () => {
  it('returns the correct prefix for an extension ID', () => {
    expect(getSettingsPrefix('com.example.test')).toBe('reigh.ext.com.example.test.');
  });

  it('prefixes are unique per extension', () => {
    const p1 = getSettingsPrefix('ext.a');
    const p2 = getSettingsPrefix('ext.b');
    expect(p1).not.toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// createExtensionSettingsService
// ---------------------------------------------------------------------------

describe('createExtensionSettingsService', () => {
  const EXT_ID = 'com.example.settings-test';
  let service: ExtensionSettingsService;
  let dispose: () => void;

  beforeEach(() => {
    cleanupLocalStorage(EXT_ID);
    const result = createExtensionSettingsService(EXT_ID, makeManifest(EXT_ID));
    service = result.service;
    dispose = result.dispose;
  });

  afterEach(() => {
    dispose();
    cleanupLocalStorage(EXT_ID);
  });

  // ---- get / set / delete / keys ------------------------------------------

  it('get returns undefined for missing keys', () => {
    expect(service.get('nonexistent')).toBeUndefined();
  });

  it('set and get round-trip string values', () => {
    service.set('theme', 'dark');
    expect(service.get('theme')).toBe('dark');
  });

  it('set and get round-trip number values', () => {
    service.set('count', 42);
    expect(service.get('count')).toBe(42);
  });

  it('set and get round-trip object values', () => {
    const obj = { nested: { value: true } };
    service.set('config', obj);
    expect(service.get('config')).toEqual(obj);
  });

  it('set and get round-trip array values', () => {
    const arr = [1, 2, 3];
    service.set('items', arr);
    expect(service.get('items')).toEqual(arr);
  });

  it('set and get round-trip boolean values', () => {
    service.set('enabled', true);
    expect(service.get('enabled')).toBe(true);
    service.set('enabled', false);
    expect(service.get('enabled')).toBe(false);
  });

  it('set and get round-trip null', () => {
    service.set('nullable', null);
    expect(service.get('nullable')).toBeNull();
  });

  it('delete removes a key', () => {
    service.set('temp', 'data');
    expect(service.get('temp')).toBe('data');
    service.delete('temp');
    expect(service.get('temp')).toBeUndefined();
  });

  it('delete on missing key is a no-op', () => {
    expect(() => service.delete('nonexistent')).not.toThrow();
  });

  it('keys lists all stored keys', () => {
    service.set('a', 1);
    service.set('b', 2);
    service.set('c', 3);
    const keys = service.keys();
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
    expect(keys).toHaveLength(3);
  });

  it('keys updates after delete', () => {
    service.set('a', 1);
    service.set('b', 2);
    service.delete('a');
    const keys = service.keys();
    expect(keys).toContain('b');
    expect(keys).not.toContain('a');
  });

  // ---- manifest defaults --------------------------------------------------

  it('returns manifest default for unset keys', () => {
    cleanupLocalStorage('defaults.ext');
    const { service: s, dispose: d } = createExtensionSettingsService(
      'defaults.ext',
      makeManifest('defaults.ext', { theme: 'light', maxItems: 100 }),
    );
    expect(s.get('theme')).toBe('light');
    expect(s.get('maxItems')).toBe(100);
    expect(s.get('nonexistent')).toBeUndefined();
    d();
    cleanupLocalStorage('defaults.ext');
  });

  it('set overrides manifest default', () => {
    cleanupLocalStorage('override.ext');
    const { service: s, dispose: d } = createExtensionSettingsService(
      'override.ext',
      makeManifest('override.ext', { theme: 'light' }),
    );
    expect(s.get('theme')).toBe('light');
    s.set('theme', 'dark');
    expect(s.get('theme')).toBe('dark');
    d();
    cleanupLocalStorage('override.ext');
  });

  it('delete restores manifest default', () => {
    cleanupLocalStorage('restore.ext');
    const { service: s, dispose: d } = createExtensionSettingsService(
      'restore.ext',
      makeManifest('restore.ext', { theme: 'light' }),
    );
    s.set('theme', 'dark');
    s.delete('theme');
    expect(s.get('theme')).toBe('light');
    d();
    cleanupLocalStorage('restore.ext');
  });

  it('keys includes manifest default keys not yet written', () => {
    cleanupLocalStorage('keys-defaults.ext');
    const { service: s, dispose: d } = createExtensionSettingsService(
      'keys-defaults.ext',
      makeManifest('keys-defaults.ext', { a: 1, b: 2, c: 3 }),
    );
    const keys = s.keys();
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    expect(keys).toContain('c');
    d();
    cleanupLocalStorage('keys-defaults.ext');
  });

  // ---- extension scoping --------------------------------------------------

  it('settings are scoped per extension', () => {
    cleanupLocalStorage('ext.one');
    cleanupLocalStorage('ext.two');
    const { service: s1, dispose: d1 } = createExtensionSettingsService('ext.one', makeManifest('ext.one'));
    const { service: s2, dispose: d2 } = createExtensionSettingsService('ext.two', makeManifest('ext.two'));

    s1.set('shared-key', 'value-one');
    s2.set('shared-key', 'value-two');

    expect(s1.get('shared-key')).toBe('value-one');
    expect(s2.get('shared-key')).toBe('value-two');

    d1();
    d2();
    cleanupLocalStorage('ext.one');
    cleanupLocalStorage('ext.two');
  });

  // ---- dispose ------------------------------------------------------------

  it('dispose cleans up written keys', () => {
    cleanupLocalStorage('dispose-test.ext');
    const { service: s, dispose: d } = createExtensionSettingsService('dispose-test.ext', makeManifest('dispose-test.ext'));

    s.set('key1', 'val1');
    s.set('key2', 'val2');

    // Before dispose, keys exist in localStorage
    const prefix = getSettingsPrefix('dispose-test.ext');
    expect(localStorage.getItem(prefix + 'key1')).not.toBeNull();

    d();

    // After dispose, keys are cleaned up
    expect(localStorage.getItem(prefix + 'key1')).toBeNull();
    expect(localStorage.getItem(prefix + 'key2')).toBeNull();
    cleanupLocalStorage('dispose-test.ext');
  });

  it('dispose is idempotent', () => {
    cleanupLocalStorage('idempotent.ext');
    const { service: s, dispose: d } = createExtensionSettingsService('idempotent.ext', makeManifest('idempotent.ext'));
    s.set('key', 'val');
    d();
    expect(() => d()).not.toThrow();
    cleanupLocalStorage('idempotent.ext');
  });
});

// ---------------------------------------------------------------------------
// Integration: createExtensionContext uses the extracted factory
// ---------------------------------------------------------------------------

describe('createExtensionContext preserves settings behavior after extraction', () => {
  const EXT_ID = 'com.example.ctx-settings';

  beforeEach(() => {
    cleanupLocalStorage(EXT_ID);
  });

  afterEach(() => {
    cleanupLocalStorage(EXT_ID);
  });

  it('settings.get returns undefined for missing keys', () => {
    const ext = defineExtension({ manifest: makeManifest(EXT_ID) });
    const ctx = createExtensionContext(ext);
    expect(ctx.services.settings.get('nonexistent')).toBeUndefined();
    disposeContext(ctx);
  });

  it('settings.set and get round-trip', () => {
    const ext = defineExtension({ manifest: makeManifest(EXT_ID) });
    const ctx = createExtensionContext(ext);
    ctx.services.settings.set('theme', 'dark');
    expect(ctx.services.settings.get('theme')).toBe('dark');
    disposeContext(ctx);
  });

  it('settings.delete removes keys', () => {
    const ext = defineExtension({ manifest: makeManifest(EXT_ID) });
    const ctx = createExtensionContext(ext);
    ctx.services.settings.set('temp', 'data');
    expect(ctx.services.settings.get('temp')).toBe('data');
    ctx.services.settings.delete('temp');
    expect(ctx.services.settings.get('temp')).toBeUndefined();
    disposeContext(ctx);
  });

  it('settings.keys lists all stored keys', () => {
    const ext = defineExtension({ manifest: makeManifest(EXT_ID) });
    const ctx = createExtensionContext(ext);
    ctx.services.settings.set('a', 1);
    ctx.services.settings.set('b', 2);
    const keys = ctx.services.settings.keys();
    expect(keys).toContain('a');
    expect(keys).toContain('b');
    disposeContext(ctx);
  });

  it('manifest defaults work through createExtensionContext', () => {
    const ext = defineExtension({
      manifest: {
        ...makeManifest(EXT_ID),
        settingsDefaults: { theme: 'system', fontSize: 14 },
      } as ExtensionManifest,
    });
    const ctx = createExtensionContext(ext);
    expect(ctx.services.settings.get('theme')).toBe('system');
    expect(ctx.services.settings.get('fontSize')).toBe(14);
    disposeContext(ctx);
  });

  it('settings are scoped per extension through createExtensionContext', () => {
    const ext1 = defineExtension({ manifest: makeManifest('ext.alpha') });
    const ext2 = defineExtension({ manifest: makeManifest('ext.beta') });
    const ctx1 = createExtensionContext(ext1);
    const ctx2 = createExtensionContext(ext2);

    ctx1.services.settings.set('shared-key', 'alpha-value');
    ctx2.services.settings.set('shared-key', 'beta-value');

    expect(ctx1.services.settings.get('shared-key')).toBe('alpha-value');
    expect(ctx2.services.settings.get('shared-key')).toBe('beta-value');

    disposeContext(ctx1);
    disposeContext(ctx2);
    cleanupLocalStorage('ext.alpha');
    cleanupLocalStorage('ext.beta');
  });
});

// ---------------------------------------------------------------------------
// Helper to dispose context
// ---------------------------------------------------------------------------

function disposeContext(ctx: ReturnType<typeof createExtensionContext>): void {
  // Access the dispose symbol and call it
  const dispose = (ctx as unknown as Record<string | symbol, unknown>)[CONTEXT_DISPOSE_SYMBOL];
  if (typeof dispose === 'function') {
    try { dispose(); } catch { /* ok */ }
  }
}
