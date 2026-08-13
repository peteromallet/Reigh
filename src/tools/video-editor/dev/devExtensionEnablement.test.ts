/**
 * devExtensionEnablement — unit tests for the stable external store:
 * stable snapshot identity, notification-free no-op writes, corrupt-storage
 * recovery, and browser storage-event synchronization.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DISABLED_KEY = 'reigh.dev-extensions.disabled';

// Each test gets a fresh module instance (cache + listeners) so snapshot
// identity and notification counts are fully isolated.
let store: typeof import('./devExtensionEnablement');

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  store = await import('./devExtensionEnablement');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function dispatchStorageEvent(init: StorageEventInit): void {
  window.dispatchEvent(new StorageEvent('storage', init));
}

describe('getSnapshot', () => {
  it('returns the same identity for repeated unchanged reads', () => {
    const first = store.getSnapshot();
    expect(first).toBe(store.getSnapshot());
    expect(first).toBe(store.getDisabledDevExtensionIds());
    expect(first).toBe(store.getSnapshot());
  });

  it('returns a new identity once the underlying storage changes', () => {
    const before = store.getSnapshot();
    store.setDevExtensionEnabled('ext-a', false);
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect([...after]).toEqual(['ext-a']);
  });

  it('stays identity-stable when an external write repeats the same value', () => {
    localStorage.setItem(DISABLED_KEY, '["ext-a"]');
    const first = store.getSnapshot();
    localStorage.setItem(DISABLED_KEY, '["ext-a"]');
    expect(store.getSnapshot()).toBe(first);
  });

  it('exposes the disabled set as readonly to callers', () => {
    localStorage.setItem(DISABLED_KEY, '["ext-a"]');
    const snapshot = store.getSnapshot();
    expect(snapshot.has('ext-a')).toBe(true);
    expect(snapshot.size).toBe(1);
  });
});

describe('no-op writes', () => {
  it('sends zero notifications and persists nothing when the state is unchanged', () => {
    localStorage.setItem(DISABLED_KEY, '["ext-a"]');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    // Disabling an already-disabled extension and enabling an
    // already-enabled extension are both no-ops.
    store.setDevExtensionEnabled('ext-a', false);
    store.setDevExtensionEnabled('ext-b', true);

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem(DISABLED_KEY)).toBe('["ext-a"]');
    unsubscribe();
  });

  it('notifies exactly once and persists for a real toggle', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setDevExtensionEnabled('ext-a', false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().has('ext-a')).toBe(true);
    expect(JSON.parse(localStorage.getItem(DISABLED_KEY)!)).toEqual(['ext-a']);
    unsubscribe();
  });
});

describe('corrupt storage', () => {
  it('recovers to a valid empty snapshot without throwing', () => {
    localStorage.setItem(DISABLED_KEY, '{not-json');
    const snapshot = store.getSnapshot();
    expect(snapshot).toBeInstanceOf(Set);
    expect(snapshot.size).toBe(0);
    expect(store.getDisabledDevExtensionIds().size).toBe(0);
  });

  it('treats non-array JSON as an empty snapshot', () => {
    localStorage.setItem(DISABLED_KEY, '{"a":1}');
    expect(store.getSnapshot().size).toBe(0);
  });

  it('filters non-string ids out of a valid array', () => {
    localStorage.setItem(DISABLED_KEY, '["a", 5, null, "b"]');
    expect([...store.getSnapshot()]).toEqual(['a', 'b']);
  });

  it('keeps the recovered empty snapshot identity stable', () => {
    localStorage.setItem(DISABLED_KEY, '{broken');
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    expect(store.getSnapshot()).toBe(first);
  });

  it('heals corrupt storage on the next real toggle', () => {
    localStorage.setItem(DISABLED_KEY, '{broken');
    expect(store.getSnapshot().size).toBe(0);

    store.setDevExtensionEnabled('ext-a', false);

    expect(JSON.parse(localStorage.getItem(DISABLED_KEY)!)).toEqual(['ext-a']);
    expect(store.getSnapshot().has('ext-a')).toBe(true);
  });
});

describe('storage event synchronization', () => {
  it('updates subscribers exactly once for a relevant key change', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    // A real cross-tab write is immediately visible in this tab's shared
    // storage area and is accompanied by exactly one storage event.
    localStorage.setItem(DISABLED_KEY, '["tab-ext"]');
    dispatchStorageEvent({ key: DISABLED_KEY, newValue: '["tab-ext"]' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().has('tab-ext')).toBe(true);
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    dispatchStorageEvent({ key: 'some.other.key', newValue: '["nope"]' });

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot().size).toBe(0);
    unsubscribe();
  });

  it('treats a full clear() as relevant and empties the snapshot', () => {
    localStorage.setItem(DISABLED_KEY, '["ext-a"]');
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    // Simulate another tab calling storage.clear(): the shared area is
    // emptied and one storage event (key === null) is delivered.
    localStorage.removeItem(DISABLED_KEY);
    dispatchStorageEvent({ key: null, newValue: null });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().size).toBe(0);
    unsubscribe();
  });

  it('does not double-notify for same-tab writes', () => {
    // The storage event fires only in *other* tabs; the writing tab is
    // notified exactly once by the write itself.
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setDevExtensionEnabled('ext-a', false);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('subscribe', () => {
  it('unsubscribes and stops receiving notifications', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.setDevExtensionEnabled('ext-a', false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('is idempotent', () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    unsubscribe();

    store.setDevExtensionEnabled('ext-a', false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every subscriber exactly once per change', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);

    store.setDevExtensionEnabled('ext-a', false);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('deduplicates the same listener', () => {
    const listener = vi.fn();
    const unsubscribeFirst = store.subscribe(listener);
    const unsubscribeSecond = store.subscribe(listener);

    store.setDevExtensionEnabled('ext-a', false);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });
});

describe('setDevExtensionEnabled', () => {
  it('persists a sorted JSON array of disabled ids', () => {
    store.setDevExtensionEnabled('z-ext', false);
    store.setDevExtensionEnabled('a-ext', false);
    expect(localStorage.getItem(DISABLED_KEY)).toBe('["a-ext","z-ext"]');
  });

  it('removes an id when re-enabled', () => {
    store.setDevExtensionEnabled('ext-a', false);
    store.setDevExtensionEnabled('ext-b', false);
    store.setDevExtensionEnabled('ext-a', true);

    expect(JSON.parse(localStorage.getItem(DISABLED_KEY)!)).toEqual(['ext-b']);
    expect(store.getSnapshot().has('ext-a')).toBe(false);
  });
});

describe('SSR safety', () => {
  it('returns an empty snapshot and no-ops writes without localStorage', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(store.getSnapshot().size).toBe(0);
    expect(() => store.setDevExtensionEnabled('ext-a', false)).not.toThrow();
    expect(store.getSnapshot().size).toBe(0);
    expect(store.getDisabledDevExtensionIds().size).toBe(0);
  });

  it('skips attaching a storage listener when the browser has no storage events', () => {
    // A window without addEventListener must not crash subscription.
    vi.stubGlobal('window', {} as Window & typeof globalThis);

    const unsubscribe = store.subscribe(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });
});
