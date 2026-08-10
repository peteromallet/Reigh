import { describe, expect, it } from 'vitest';
import {
  buildDevSession,
  devSessionStorageKey,
  LOCAL_MODE_STORAGE_KEY,
  seedDevLocalModeSession,
} from './devSession.ts';

function makeMemoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(key) ?? null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(key); },
    setItem(key: string, value: string) { store.set(key, value); },
  };
}

const URL = 'https://example.supabase.co';

function storedExpiredSession(): string {
  return JSON.stringify({ ...buildDevSession(Date.now()), expires_at: Math.floor(Date.now() / 1000) - 1 });
}

function storedValidSession(): string {
  return JSON.stringify(buildDevSession());
}

describe('seedDevLocalModeSession', () => {
  it('seeds a session and the local-mode flag into empty storage', () => {
    const storage = makeMemoryStorage();
    expect(seedDevLocalModeSession(storage, URL)).toBe(true);
    expect(storage.getItem(devSessionStorageKey(URL))).toBeTruthy();
    expect(storage.getItem(LOCAL_MODE_STORAGE_KEY)).toBe('1');
  });

  it('does not overwrite a valid stored session (a real signed-in dev)', () => {
    const key = devSessionStorageKey(URL);
    const valid = storedValidSession();
    const storage = makeMemoryStorage({ [key]: valid });
    expect(seedDevLocalModeSession(storage, URL)).toBe(false);
    expect(storage.getItem(key)).toBe(valid);
    expect(storage.getItem(LOCAL_MODE_STORAGE_KEY)).toBeNull();
  });

  it('replaces an expired stored session so a day-old dev login cannot block auto-login', () => {
    const key = devSessionStorageKey(URL);
    const expired = storedExpiredSession();
    const storage = makeMemoryStorage({ [key]: expired });
    expect(seedDevLocalModeSession(storage, URL)).toBe(true);
    const replaced = JSON.parse(storage.getItem(key)!) as { expires_at: number };
    expect(replaced.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(storage.getItem(LOCAL_MODE_STORAGE_KEY)).toBe('1');
  });

  it('replaces an unparseable stored blob', () => {
    const key = devSessionStorageKey(URL);
    const storage = makeMemoryStorage({ [key]: 'not-json' });
    expect(seedDevLocalModeSession(storage, URL)).toBe(true);
    expect(JSON.parse(storage.getItem(key)!)).toHaveProperty('access_token');
  });
});
