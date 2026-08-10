/**
 * Dev-only local-mode editor constants, in one place.
 *
 * Local mode reads the timeline from the Astrid bridge and needs no login. The
 * auth gate exempts the local-mode editor route in DEV (`Layout.tsx`), so no
 * fake Supabase session is ever created: a fake login would make the app-wide
 * providers (user settings, projects, credits) fetch real data against a
 * non-existent backend and fail. This module only carries the constants those
 * DEV paths share.
 *
 * Keep this module free of `import.meta.env` and of React/DOM-typed imports.
 */

/** localStorage flag that puts `VideoEditorPage` in Local mode. */
export const LOCAL_MODE_STORAGE_KEY = 'dev.videoEditor.localMode';

/** URL params that mean "open the local-mode editor" (see `VideoEditorPage`). */
export const LOCAL_MODE_URL_PARAMS = ['localProject', 'localTimeline'] as const;

/**
 * The Supabase URL dev boot paths use when no real one is configured.
 *
 * This is the local `supabase start` convention (`http://127.0.0.1:54321`) —
 * not a fake external domain. The app's env getters are lazy and require the
 * value to exist, so `playwright.config.ts` and `scripts/dev-editor.mjs` supply
 * this one. If a developer is running local Supabase, the app shell's data
 * fetches resolve instead of erroring.
 */
export const DEFAULT_DEV_SUPABASE_URL = 'http://127.0.0.1:54321';

/**
 * Supabase persists its session under `sb-<projectRef>-auth-token`, where the
 * ref is the first hostname label. Derive it rather than hardcoding, so a
 * different `VITE_SUPABASE_URL` still lands on the key the client will read.
 */
export function devSessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** True when the URL carries the local-mode params `VideoEditorPage` reads. */
export function hasLocalModeUrlParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return LOCAL_MODE_URL_PARAMS.some((name) => params.has(name));
}

/**
 * Persist the local-mode flag so a later visit to the editor (without the URL
 * params) still opens in local mode. Writes only the flag — never a session:
 * local mode needs no login, and a fake session would make the app-wide
 * providers fetch against a non-existent backend. See the auth gate's DEV
 * exemption in `Layout.tsx`.
 */
export function writeStoredLocalModeFlag(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(LOCAL_MODE_STORAGE_KEY, '1');
}
