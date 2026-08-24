import type { Session } from '@supabase/supabase-js';
import type { DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';

export type ToolSettingsErrorCode =
  | 'auth_required'
  | 'cancelled'
  | 'network'
  | 'scope_fetch_failed'
  | 'invalid_scope_identifier'
  | 'unknown';

export interface ToolSettingsErrorOptions {
  recoverable?: boolean;
  cause?: unknown;
  metadata?: Record<string, unknown>;
}

/** The settings boundary runs against the app's deferred Supabase client. */
export type ToolSettingsSupabaseClient = DeferredSupabaseClient;

export interface ToolSettingsContext {
  projectId?: string;
  shotId?: string;
}

export interface SettingsFetchResult<T = Record<string, unknown>> {
  settings: T;
  hasShotSettings: boolean;
}

export type UserLookupResult = Promise<{ data: { user: { id: string } | null }; error: null }>;
export type AuthStateCallback = (event: string, session: Session | null) => void;
export type SettingsRow = { data: { settings: unknown } | null; error: unknown };
export type AbortableQuery<T> = {
  abortSignal?: (signal: AbortSignal) => T;
};

export interface AuthCacheSyncSource {
  subscribe: (id: string, callback: AuthStateCallback) => () => void;
}
