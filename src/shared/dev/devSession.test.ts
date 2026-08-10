import { describe, expect, it } from 'vitest';
import {
  devSessionStorageKey,
  hasLocalModeUrlParams,
  LOCAL_MODE_STORAGE_KEY,
  writeStoredLocalModeFlag,
} from './devSession.ts';

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(key) ?? null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, value); },
  };
}

const URL = 'http://127.0.0.1:54321';

describe('devSession', () => {
  it('derives the storage key from the Supabase URL hostname', () => {
    expect(devSessionStorageKey(URL)).toBe('sb-127-auth-token');
    expect(devSessionStorageKey('https://abcdef.supabase.co')).toBe('sb-abcdef-auth-token');
  });

  it('recognises local-mode URL params', () => {
    expect(hasLocalModeUrlParams('?localProject=demo&localTimeline=demo-timeline')).toBe(true);
    expect(hasLocalModeUrlParams('?localProject=demo')).toBe(true);
    expect(hasLocalModeUrlParams('?timeline=real-timeline')).toBe(false);
    expect(hasLocalModeUrlParams('')).toBe(false);
  });

  it('persists only the local-mode flag — never a session', () => {
    const storage = makeMemoryStorage();
    writeStoredLocalModeFlag(storage);
    expect(storage.getItem(LOCAL_MODE_STORAGE_KEY)).toBe('1');
    // The dev path must not fabricate a Supabase session: a fake login would
    // make the app-wide providers fetch against a non-existent backend.
    expect(Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter((k) => k.includes('auth-token'))).toEqual([]);
  });
});
