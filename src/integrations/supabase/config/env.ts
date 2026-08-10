// Supabase config is intentionally lazy: importing this module should not throw.
// Env validation happens only when callers access URL/key getters.
//
// Migration contract for legacy constant removal:
// - Owner: platform-foundations
// - Remove-by: 2026-05-31
// - Gate: no remaining imports of old SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY symbols

function requireEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    throw new Error(`Missing required Supabase environment variable: ${name}`);
  }
  return value;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const value = import.meta.env[name] as string | undefined;
  if (value === undefined) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

let _supabaseUrl: string | undefined;
/** Supabase project URL — throws on first access if VITE_SUPABASE_URL is missing. */
export function getSupabaseUrl(): string {
  return (_supabaseUrl ??= requireEnv('VITE_SUPABASE_URL'));
}

/** True when a Supabase URL is configured. Non-throwing — used to decide whether
 *  the no-Supabase dev fallbacks (local-mode editor) may apply at all. */
export function hasSupabaseConfig(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL);
}

let _supabaseKey: string | undefined;
/** Supabase anon/publishable key — throws on first access if VITE_SUPABASE_ANON_KEY is missing. */
export function getSupabasePublishableKey(): string {
  return (_supabaseKey ??= requireEnv('VITE_SUPABASE_ANON_KEY'));
}

export function isDevEnv(): boolean {
  return (
    import.meta.env.VITE_APP_ENV === 'dev' ||
    (typeof window !== 'undefined' && window.location?.hostname === 'localhost')
  );
}

// Heavy instrumentation should default off outside debug/dev flows.
export function isWsInstrumentationEnabled(): boolean {
  return getBooleanEnv('VITE_DEBUG_WS_INSTRUMENTATION', isDevEnv());
}

export function isRealtimeDownFixEnabled(): boolean {
  return getBooleanEnv('VITE_DEBUG_REALTIME_DOWN_FIX', isDevEnv());
}

export function isCorruptionTraceEnabled(): boolean {
  return getBooleanEnv('VITE_DEBUG_CORRUPTION_TRACE', isDevEnv());
}
