/**
 * Runtime data authority selection.
 *
 * Phase C is Astrid-first. Merely having Supabase credentials in the build is
 * not permission to mount cloud readers: local development and Playwright both
 * carry placeholder credentials. The deferred cloud shell is therefore an
 * explicit opt-in, and a local-editor URL always wins.
 */

import { hasLocalModeUrlParams } from '@/shared/dev/devSession.ts';

export type AppDataAuthority = 'astrid' | 'supabase-deferred';

export interface DataAuthorityEnvironment {
  VITE_DATA_AUTHORITY?: string;
}

export function resolveAppDataAuthority(
  search: string,
  env: DataAuthorityEnvironment = import.meta.env,
): AppDataAuthority {
  if (hasLocalModeUrlParams(search)) return 'astrid';
  return env.VITE_DATA_AUTHORITY === 'supabase-deferred'
    ? 'supabase-deferred'
    : 'astrid';
}

export function isDeferredCloudDataAuthority(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  env: DataAuthorityEnvironment = import.meta.env,
): boolean {
  return resolveAppDataAuthority(search, env) === 'supabase-deferred';
}
