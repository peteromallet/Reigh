import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryExtensionStateRepository,
  LocalStorageExtensionStateRepository,
} from './extensionStateRepository.ts';
import type { ExtensionStateRepository } from './extensionStateRepository.ts';
import type { ExtensionState } from './extensionManifest.ts';

// ---------------------------------------------------------------------------
// Fake Storage backed by a plain object (deterministic, no happy-dom needed)
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

  // Test helper — not part of the Storage interface.
  _rawGet(key: string): string | null {
    return this._data.get(key) ?? null;
  }

  // Test helper — directly inject raw bytes.
  _rawSet(key: string, value: string): void {
    this._data.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Shared test suites
// ---------------------------------------------------------------------------

/** Default state returned by all implementations for unknown extensions. */
function defaultState(): ExtensionState {
  return { enabled: true };
}

/**
 * Run the shared contract tests against a factory that produces a fresh
 * repository for each test.  The factory receives a name hint so it can
 * decide which implementation to build.
 */
function runRepositoryContractTests(opts: {
  factory: (hint: string) => ExtensionStateRepository;
}) {
  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------

  describe('defaults', () => {
    it('returns enabled=true for an unknown extension id', () => {
      const repo = opts.factory('defaults-unknown');
      expect(repo.getState('never.seen')).toEqual(defaultState());
    });

    it('returns a fresh object each call (shallow copy safety)', () => {
      const repo = opts.factory('defaults-fresh');
      const a = repo.getState('unknown');
      const b = repo.getState('unknown');
      expect(a).not.toBe(b);
      expect(a).toEqual(defaultState());
      expect(b).toEqual(defaultState());
    });

    it('getAllStates is empty before any state is set', () => {
      const repo = opts.factory('defaults-empty-all');
      expect(repo.getAllStates()).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // setState / getState round-trip
  // -----------------------------------------------------------------------

  describe('setState / getState round-trip', () => {
    it('round-trips enabled state', () => {
      const repo = opts.factory('roundtrip-enabled');
      repo.setState('a', { enabled: false });
      expect(repo.getState('a')).toEqual({ enabled: false });
    });

    it('round-trips settings overrides', () => {
      const repo = opts.factory('roundtrip-overrides');
      repo.setState('a', { enabled: true, settingsOverrides: { key: 42 } });
      expect(repo.getState('a')).toEqual({
        enabled: true,
        settingsOverrides: { key: 42 },
      });
    });

    it('setState shallow-copies top-level primitives but shares nested objects', () => {
      const repo = opts.factory('roundtrip-copy');
      const mutable: ExtensionState = {
        enabled: true,
        settingsOverrides: { x: 1 },
      };
      repo.setState('a', mutable);
      // Mutating the top-level primitive does NOT affect stored state
      // (because setState does a shallow copy).
      mutable.enabled = false;
      expect(repo.getState('a').enabled).toBe(true);
      // However, mutating the nested settingsOverrides object DOES affect
      // stored state because the shallow copy shares the reference.
      mutable.settingsOverrides!.x = 99;
      expect(repo.getState('a').settingsOverrides).toEqual({ x: 99 });
    });

    it('getState returns the stored reference (caller mutations leak into store)', () => {
      const repo = opts.factory('roundtrip-reader-copy');
      repo.setState('a', { enabled: true, settingsOverrides: { y: 'hello' } });
      const read = repo.getState('a');
      // Mutating the returned reference DOES affect the stored state.
      read.enabled = false;
      (read.settingsOverrides as Record<string, unknown>).y = 'mutated';
      expect(repo.getState('a')).toEqual({
        enabled: false,
        settingsOverrides: { y: 'mutated' },
      });
    });

    it('stores multiple extensions independently', () => {
      const repo = opts.factory('roundtrip-multi');
      repo.setState('ext-a', { enabled: true, settingsOverrides: { a: 1 } });
      repo.setState('ext-b', { enabled: false });
      repo.setState('ext-c', {
        enabled: true,
        settingsOverrides: { c: 'val' },
      });

      expect(repo.getState('ext-a')).toEqual({
        enabled: true,
        settingsOverrides: { a: 1 },
      });
      expect(repo.getState('ext-b')).toEqual({ enabled: false });
      expect(repo.getState('ext-c')).toEqual({
        enabled: true,
        settingsOverrides: { c: 'val' },
      });
      // Unknown still defaults.
      expect(repo.getState('unknown')).toEqual(defaultState());
    });
  });

  // -----------------------------------------------------------------------
  // getAllStates
  // -----------------------------------------------------------------------

  describe('getAllStates', () => {
    it('returns all persisted states', () => {
      const repo = opts.factory('all-states');
      repo.setState('a', { enabled: true });
      repo.setState('b', { enabled: false, settingsOverrides: { n: 1 } });
      const all = repo.getAllStates();
      expect(all).toEqual({
        a: { enabled: true },
        b: { enabled: false, settingsOverrides: { n: 1 } },
      });
    });

    it('returns a shallow copy so mutations do not affect the store', () => {
      const repo = opts.factory('all-states-copy');
      repo.setState('a', { enabled: true });
      const all = repo.getAllStates();
      all['a'].enabled = false;
      (all as Record<string, unknown>)['new'] = { enabled: true };
      delete all['a'];

      // Original store must be unchanged.
      expect(repo.getState('a')).toEqual({ enabled: true });
      expect(repo.getAllStates()).toEqual({ a: { enabled: true } });
    });
  });

  // -----------------------------------------------------------------------
  // setEnabled convenience
  // -----------------------------------------------------------------------

  describe('setEnabled', () => {
    it('sets enabled to false for a fresh extension', () => {
      const repo = opts.factory('setEnabled-false');
      repo.setEnabled('ext', false);
      expect(repo.getState('ext')).toEqual({ enabled: false });
    });

    it('sets enabled to true for a fresh extension (no-op default)', () => {
      const repo = opts.factory('setEnabled-true');
      repo.setEnabled('ext', true);
      expect(repo.getState('ext')).toEqual({ enabled: true });
    });

    it('preserves existing settings overrides when changing enabled', () => {
      const repo = opts.factory('setEnabled-preserve');
      repo.setState('ext', {
        enabled: true,
        settingsOverrides: { volume: 0.5 },
      });
      repo.setEnabled('ext', false);
      expect(repo.getState('ext')).toEqual({
        enabled: false,
        settingsOverrides: { volume: 0.5 },
      });
    });

    it('disable then re-enable', () => {
      const repo = opts.factory('setEnabled-disable-reenable');
      repo.setEnabled('ext', false);
      expect(repo.getState('ext').enabled).toBe(false);
      repo.setEnabled('ext', true);
      expect(repo.getState('ext').enabled).toBe(true);
      expect(repo.getState('ext')).toEqual({ enabled: true });
    });

    it('disable, set override, re-enable preserves override', () => {
      const repo = opts.factory('setEnabled-cycle-with-override');
      repo.setEnabled('ext', false);
      repo.setSettingsOverrides('ext', { debug: true });
      expect(repo.getState('ext')).toEqual({
        enabled: false,
        settingsOverrides: { debug: true },
      });
      repo.setEnabled('ext', true);
      expect(repo.getState('ext')).toEqual({
        enabled: true,
        settingsOverrides: { debug: true },
      });
    });
  });

  // -----------------------------------------------------------------------
  // setSettingsOverrides convenience
  // -----------------------------------------------------------------------

  describe('setSettingsOverrides', () => {
    it('stores overrides for a fresh extension (default enabled=true)', () => {
      const repo = opts.factory('overrides-fresh');
      repo.setSettingsOverrides('ext', { key: 'val' });
      expect(repo.getState('ext')).toEqual({
        enabled: true,
        settingsOverrides: { key: 'val' },
      });
    });

    it('clears overrides when undefined is passed', () => {
      const repo = opts.factory('overrides-clear');
      repo.setState('ext', {
        enabled: false,
        settingsOverrides: { old: 'data' },
      });
      repo.setSettingsOverrides('ext', undefined);
      expect(repo.getState('ext')).toEqual({ enabled: false });
    });

    it('preserves enabled flag when setting overrides', () => {
      const repo = opts.factory('overrides-preserve-enabled');
      repo.setEnabled('ext', false);
      repo.setSettingsOverrides('ext', { zoom: 2 });
      expect(repo.getState('ext')).toEqual({
        enabled: false,
        settingsOverrides: { zoom: 2 },
      });
    });

    it('replaces existing overrides (not merge)', () => {
      const repo = opts.factory('overrides-replace');
      repo.setSettingsOverrides('ext', { a: 1, b: 2 });
      repo.setSettingsOverrides('ext', { c: 3 });
      expect(repo.getState('ext')).toEqual({
        enabled: true,
        settingsOverrides: { c: 3 },
      });
    });
  });

  // -----------------------------------------------------------------------
  // Per-extension isolation
  // -----------------------------------------------------------------------

  describe('per-extension isolation', () => {
    it('overrides on one extension do not affect another', () => {
      const repo = opts.factory('isolation-overrides');
      repo.setSettingsOverrides('ext-a', { a: 1 });
      repo.setSettingsOverrides('ext-b', { b: 2 });
      expect(repo.getState('ext-a')).toEqual({
        enabled: true,
        settingsOverrides: { a: 1 },
      });
      expect(repo.getState('ext-b')).toEqual({
        enabled: true,
        settingsOverrides: { b: 2 },
      });
    });

    it('disabling one extension does not affect another', () => {
      const repo = opts.factory('isolation-enabled');
      repo.setEnabled('ext-a', false);
      repo.setEnabled('ext-b', true);
      expect(repo.getState('ext-a').enabled).toBe(false);
      expect(repo.getState('ext-b').enabled).toBe(true);
    });

    it('clearing overrides on one extension does not affect another', () => {
      const repo = opts.factory('isolation-clear');
      repo.setSettingsOverrides('ext-a', { x: 1 });
      repo.setSettingsOverrides('ext-b', { y: 2 });
      repo.setSettingsOverrides('ext-a', undefined);
      expect(repo.getState('ext-a')).toEqual({ enabled: true });
      expect(repo.getState('ext-b')).toEqual({
        enabled: true,
        settingsOverrides: { y: 2 },
      });
    });
  });
}

// ===========================================================================
// InMemoryExtensionStateRepository tests
// ===========================================================================

describe('InMemoryExtensionStateRepository', () => {
  runRepositoryContractTests({
    factory: (_hint) => new InMemoryExtensionStateRepository(),
  });

  // InMemory-specific behaviors
  describe('in-memory specifics', () => {
    it('load() always returns empty diagnostics', () => {
      const repo = new InMemoryExtensionStateRepository();
      expect(repo.load()).toEqual([]);
    });

    it('save() is a no-op (state remains)', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setState('ext', { enabled: false });
      repo.save();
      // Save is a no-op, state is just in memory — still there.
      expect(repo.getState('ext')).toEqual({ enabled: false });
    });

    it('load() does not clear existing state', () => {
      const repo = new InMemoryExtensionStateRepository();
      repo.setState('ext', { enabled: false, settingsOverrides: { k: 'v' } });
      repo.load();
      // load() is a no-op; state must be preserved.
      expect(repo.getState('ext')).toEqual({
        enabled: false,
        settingsOverrides: { k: 'v' },
      });
    });
  });
});

// ===========================================================================
// LocalStorageExtensionStateRepository tests
// ===========================================================================

describe('LocalStorageExtensionStateRepository', () => {
  // Shared contract tests with a factory that creates fresh storage + repo
  runRepositoryContractTests({
    factory: (_hint) => {
      const storage = new FakeStorage();
      return new LocalStorageExtensionStateRepository(storage);
    },
  });

  // -----------------------------------------------------------------------
  // Persistence across repository instances
  // -----------------------------------------------------------------------

  describe('persistence across repository instances', () => {
    it('survives save + new instance load', () => {
      const storage = new FakeStorage();

      // First instance: write state.
      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setState('ext-a', { enabled: false, settingsOverrides: { vol: 0.3 } });
      repo1.setState('ext-b', { enabled: true, settingsOverrides: { pan: -0.5 } });
      repo1.save();

      // Second instance: read state back.
      const repo2 = new LocalStorageExtensionStateRepository(storage);
      const diags = repo2.load();
      expect(diags).toEqual([]);

      expect(repo2.getState('ext-a')).toEqual({
        enabled: false,
        settingsOverrides: { vol: 0.3 },
      });
      expect(repo2.getState('ext-b')).toEqual({
        enabled: true,
        settingsOverrides: { pan: -0.5 },
      });
      // Unknown still defaults.
      expect(repo2.getState('unknown')).toEqual(defaultState());
    });

    it('multiple save/load cycles preserve latest state', () => {
      const storage = new FakeStorage();

      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setState('ext', { enabled: true, settingsOverrides: { v: 1 } });
      repo1.save();

      const repo2 = new LocalStorageExtensionStateRepository(storage);
      repo2.load();
      repo2.setState('ext', { enabled: false, settingsOverrides: { v: 2 } });
      repo2.save();

      const repo3 = new LocalStorageExtensionStateRepository(storage);
      repo3.load();
      expect(repo3.getState('ext')).toEqual({
        enabled: false,
        settingsOverrides: { v: 2 },
      });
    });

    it('empty storage on first load produces no diagnostics', () => {
      const storage = new FakeStorage();
      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();
      expect(diags).toEqual([]);
      expect(repo.getAllStates()).toEqual({});
    });

    it('save with empty state writes a valid record', () => {
      const storage = new FakeStorage();
      const repo = new LocalStorageExtensionStateRepository(storage);
      repo.save();

      // Verify the stored JSON is parseable and correct.
      const raw = storage._rawGet('reigh:extension-state:v1');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.version).toBe(1);
      expect(parsed.states).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // Scoped storage keys
  // -----------------------------------------------------------------------

  describe('scoped storage keys', () => {
    it('different keys create independent state spaces', () => {
      const storage = new FakeStorage();

      const repoA = new LocalStorageExtensionStateRepository(storage, 'scope:A');
      const repoB = new LocalStorageExtensionStateRepository(storage, 'scope:B');

      repoA.setState('ext', { enabled: false });
      repoA.save();

      repoB.setState('ext', { enabled: true, settingsOverrides: { x: 1 } });
      repoB.save();

      // Reload into new instances with matching keys.
      const reloadA = new LocalStorageExtensionStateRepository(storage, 'scope:A');
      reloadA.load();
      expect(reloadA.getState('ext')).toEqual({ enabled: false });

      const reloadB = new LocalStorageExtensionStateRepository(storage, 'scope:B');
      reloadB.load();
      expect(reloadB.getState('ext')).toEqual({
        enabled: true,
        settingsOverrides: { x: 1 },
      });
    });

    it('uses default key when none is supplied', () => {
      const storage = new FakeStorage();
      const repo = new LocalStorageExtensionStateRepository(storage);
      repo.setState('ext', { enabled: false });
      repo.save();

      const raw = storage._rawGet('reigh:extension-state:v1');
      expect(raw).not.toBeNull();
    });

    it('custom key does not collide with default key', () => {
      const storage = new FakeStorage();

      const defaultRepo = new LocalStorageExtensionStateRepository(storage);
      defaultRepo.setState('ext', { enabled: false });
      defaultRepo.save();

      const customRepo = new LocalStorageExtensionStateRepository(storage, 'my-custom-key');
      customRepo.load(); // Should see nothing.
      expect(customRepo.getState('ext')).toEqual(defaultState());

      // Default repo still has its state.
      const reloadDefault = new LocalStorageExtensionStateRepository(storage);
      reloadDefault.load();
      expect(reloadDefault.getState('ext')).toEqual({ enabled: false });
    });
  });

  // -----------------------------------------------------------------------
  // Corrupt storage recovery diagnostics
  // -----------------------------------------------------------------------

  describe('corrupt storage recovery', () => {
    it('detects unparseable JSON and returns state_corrupt diagnostic', () => {
      const storage = new FakeStorage();
      storage._rawSet('reigh:extension-state:v1', 'not-json {{{');

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].kind).toBe('error');
      expect(diags[0].code).toBe('state_corrupt');
      expect(diags[0].message).toContain('corrupt');
      expect(diags[0].message).toContain('parse');
    });

    it('detects non-object JSON and returns state_corrupt diagnostic', () => {
      const storage = new FakeStorage();
      storage._rawSet('reigh:extension-state:v1', '42');

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects missing version field', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ states: { a: { enabled: true } } }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects non-integer version', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 1.5, states: {} }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects negative version', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: -1, states: {} }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects missing states object', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 1 }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects states is array instead of object', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 1, states: [1, 2, 3] }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects a state entry with non-object value', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 1, states: { a: 'not-an-object' } }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects a state entry missing enabled boolean', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 1, states: { a: { settingsOverrides: {} } } }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects settingsOverrides that is not an object', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({
          version: 1,
          states: { a: { enabled: true, settingsOverrides: 'bad' } },
        }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('detects settingsOverrides that is an array', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({
          version: 1,
          states: { a: { enabled: true, settingsOverrides: [1, 2] } },
        }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
    });

    it('resets state to empty after corrupt load', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({
          version: 1,
          states: { a: { enabled: true }, b: { enabled: false } },
        }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      // First load should succeed.
      let diags = repo.load();
      expect(diags).toEqual([]);
      expect(repo.getState('a')).toEqual({ enabled: true });
      expect(repo.getState('b')).toEqual({ enabled: false });

      // Corrupt the storage.
      storage._rawSet('reigh:extension-state:v1', 'corrupt-garbage');

      // Load again — should detect corruption and reset.
      diags = repo.load();
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
      // State should be empty now.
      expect(repo.getAllStates()).toEqual({});
      expect(repo.getState('a')).toEqual(defaultState());
      expect(repo.getState('b')).toEqual(defaultState());
    });

    it('removes the corrupt key from storage after recovery', () => {
      const storage = new FakeStorage();
      storage._rawSet('reigh:extension-state:v1', 'corrupt');

      const repo = new LocalStorageExtensionStateRepository(storage);
      repo.load();

      // The corrupt key should have been removed.
      expect(storage.getItem('reigh:extension-state:v1')).toBeNull();
    });

    it('handles future (unsupported) record version', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({ version: 99, states: { a: { enabled: true } } }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
      expect(diags[0].message).toContain('99');
      expect(diags[0].message).toContain('unsupported record version');

      // State must be reset.
      expect(repo.getAllStates()).toEqual({});
    });

    it('corrupt diagnostic has structured detail with reason', () => {
      const storage = new FakeStorage();
      storage._rawSet('reigh:extension-state:v1', 'bad-json!!!');

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].detail).toBeDefined();
      expect((diags[0].detail as Record<string, unknown>).reason).toBeDefined();
      expect(typeof (diags[0].detail as Record<string, unknown>).reason).toBe('string');
    });

    it('accepts version 1 (current version) as valid', () => {
      const storage = new FakeStorage();
      storage._rawSet(
        'reigh:extension-state:v1',
        JSON.stringify({
          version: 1,
          states: {
            a: { enabled: true },
            b: { enabled: false, settingsOverrides: { k: 'v' } },
          },
        }),
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toEqual([]);
      expect(repo.getState('a')).toEqual({ enabled: true });
      expect(repo.getState('b')).toEqual({
        enabled: false,
        settingsOverrides: { k: 'v' },
      });
    });

    it('non-string stored value (should not happen, but guarded)', () => {
      const storage = new FakeStorage();
      // Simulate a non-string value via direct map injection.
      (storage as unknown as { _data: Map<string, unknown> })._data.set(
        'reigh:extension-state:v1',
        12345 as unknown as string,
      );

      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();

      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('state_corrupt');
      expect(diags[0].message).toContain('not a string');
    });
  });

  // -----------------------------------------------------------------------
  // load-after-mutation correctness
  // -----------------------------------------------------------------------

  describe('load after mutation', () => {
    it('load() overwrites in-memory mutations not yet saved', () => {
      const storage = new FakeStorage();

      // Persist initial state.
      const repo1 = new LocalStorageExtensionStateRepository(storage);
      repo1.setState('ext', { enabled: true, settingsOverrides: { ver: 1 } });
      repo1.save();

      // Load into repo2 and mutate without saving.
      const repo2 = new LocalStorageExtensionStateRepository(storage);
      repo2.load();
      repo2.setState('ext', { enabled: false, settingsOverrides: { ver: 999 } });
      // Don't save — now load again to revert to persisted state.
      repo2.load();

      expect(repo2.getState('ext')).toEqual({
        enabled: true,
        settingsOverrides: { ver: 1 },
      });
    });

    it('save then load on same instance preserves state', () => {
      const storage = new FakeStorage();
      const repo = new LocalStorageExtensionStateRepository(storage);
      repo.setState('ext', { enabled: false });
      repo.save();
      repo.load(); // Should reload what we just saved.
      expect(repo.getState('ext')).toEqual({ enabled: false });
    });
  });

  // -----------------------------------------------------------------------
  // Null / undefined storage.getItem return
  // -----------------------------------------------------------------------

  describe('null storage handling', () => {
    it('null from storage.getItem means empty state (no diagnostic)', () => {
      const storage = new FakeStorage();
      // Don't set anything.
      const repo = new LocalStorageExtensionStateRepository(storage);
      const diags = repo.load();
      expect(diags).toEqual([]);
      expect(repo.getAllStates()).toEqual({});
    });
  });
});
