import { describe, expect, it } from 'vitest';
import { resolveAppDataAuthority } from './dataAuthority.ts';

describe('resolveAppDataAuthority', () => {
  it('defaults to Astrid even when unrelated Supabase credentials exist', () => {
    expect(resolveAppDataAuthority('', {})).toBe('astrid');
  });

  it('requires the explicit deferred-cloud authority flag', () => {
    expect(resolveAppDataAuthority('', { VITE_DATA_AUTHORITY: 'supabase-deferred' }))
      .toBe('supabase-deferred');
  });

  it('never enables deferred cloud readers on a local editor URL', () => {
    expect(resolveAppDataAuthority('?localProject=demo&localTimeline=main', {
      VITE_DATA_AUTHORITY: 'supabase-deferred',
    })).toBe('astrid');
  });
});
