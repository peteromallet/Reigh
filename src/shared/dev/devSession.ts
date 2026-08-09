/**
 * The dev-only local-mode session, in one place.
 *
 * Local mode reads the timeline from the Astrid bridge and never talks to
 * Supabase — but `src/app/Layout.tsx` still gates every route on *a* session, so
 * both the e2e harness and `npm run dev:editor` need one to render the editor.
 * This module owns that fake session so the forging logic exists exactly once:
 * `tests/e2e/timeline/support.ts` seeds it into a Playwright context, and
 * `src/app/bootstrap.tsx` seeds it into the dev browser under `import.meta.env.DEV`.
 *
 * The token is unsigned (`sig` where the signature goes) and local-only: nothing
 * accepts it, and local mode issues no authenticated request that could carry it.
 * Keep this module free of `import.meta.env` and of React/DOM-typed imports — the
 * Playwright harness imports it from plain Node.
 */

/** localStorage flag that puts `VideoEditorPage` in Local mode. */
export const LOCAL_MODE_STORAGE_KEY = 'dev.videoEditor.localMode';

/** URL params that mean "open the local-mode editor" (see `VideoEditorPage`). */
export const LOCAL_MODE_URL_PARAMS = ['localProject', 'localTimeline'] as const;

/**
 * Placeholder Supabase URL the headless harnesses boot the dev server with when
 * no real one is configured. The env getters are lazy, so local mode only needs
 * the value to exist — but the *session storage key is derived from it*, so
 * `playwright.config.ts`, `scripts/dev-editor.mjs` and `seedFakeSession` must
 * all agree on this exact string or the seeded session lands under a key the
 * Supabase client never reads.
 */
export const PLACEHOLDER_SUPABASE_URL = 'https://example.supabase.co';

/**
 * Fallback when even `import.meta.env.VITE_SUPABASE_URL` is absent. Matches the
 * local-dev convention (`supabase start` on 54321).
 */
export const DEFAULT_DEV_SUPABASE_URL = 'http://127.0.0.1:54321';

/** Stable id for the fake session's user — never a real account. */
export const DEV_SESSION_USER_ID = '00000000-0000-4000-8000-000000000001';

const SESSION_TTL_SECONDS = 86_400;

/**
 * Supabase persists its session under `sb-<projectRef>-auth-token`, where the
 * ref is the first hostname label. Derive it rather than hardcoding, so a
 * different `VITE_SUPABASE_URL` still lands on the key the client will read.
 */
export function devSessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** Base64url of a JSON value. `btoa` is a global in both browsers and Node 18+. */
function b64url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export interface DevSession {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: Record<string, unknown>;
}

/** Build the Supabase-shaped session blob that satisfies the app's auth gate. */
export function buildDevSession(nowMs: number = Date.now()): DevSession {
  const issuedAt = Math.floor(nowMs / 1000);
  const accessToken = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({
      sub: 'u',
      role: 'authenticated',
      aud: 'authenticated',
      iat: issuedAt,
      exp: issuedAt + SESSION_TTL_SECONDS,
    }),
    'sig',
  ].join('.');

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: SESSION_TTL_SECONDS,
    expires_at: issuedAt + SESSION_TTL_SECONDS,
    refresh_token: 'r',
    user: {
      id: DEV_SESSION_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'dev@localhost',
      app_metadata: {},
      user_metadata: {},
      created_at: new Date(0).toISOString(),
    },
  };
}

/** True when the URL carries the local-mode params `VideoEditorPage` reads. */
export function hasLocalModeUrlParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return LOCAL_MODE_URL_PARAMS.some((name) => params.has(name));
}

/**
 * Write the fake session + local-mode flag into a storage object.
 *
 * Returns `false` and writes nothing when a session is already stored — a real
 * signed-in developer must never have their session replaced by this one.
 * Callers own the DEV gate; this function has no environment opinion.
 */
export function seedDevLocalModeSession(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  supabaseUrl: string,
): boolean {
  const key = devSessionStorageKey(supabaseUrl);
  if (storage.getItem(key)) {
    return false;
  }
  storage.setItem(key, JSON.stringify(buildDevSession()));
  storage.setItem(LOCAL_MODE_STORAGE_KEY, '1');
  return true;
}
