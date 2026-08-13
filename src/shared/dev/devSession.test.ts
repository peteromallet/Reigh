import { describe, expect, it } from 'vitest';
import {
  devSessionStorageKey,
  hasLocalModeUrlParams,
} from './devSession.ts';

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
});
