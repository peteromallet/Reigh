/**
 * Shared Supabase session helpers for reading auth data from localStorage.
 *
 * Supabase stores the session JSON under `sb-${projectRef}-auth-token`.
 * Reading localStorage is synchronous and never contends with the
 * navigator.locks used by GoTrueClient's getSession()/getUser().
 * During token refresh Supabase holds an EXCLUSIVE lock, so all shared-lock
 * requests queue behind it (600ms-16s). These helpers avoid that entirely.
 *
 * Used by: taskCreation.ts, invokeSupabaseEdgeFunction.ts, toolSettingsService.ts,
 *          createSupabaseClient.ts.
 */

import { getSupabaseUrl } from '@/integrations/supabase/config/env';
import {
  operationFailure,
  operationSuccess,
  type OperationResult,
} from '@/shared/lib/operationResult';

/**
 * Parse the Supabase project ref from the configured URL.
 * The ref is the first segment of the hostname (e.g. "abcdef" from "abcdef.supabase.co").
 */
function getProjectRef(): string {
  return new URL(getSupabaseUrl()).hostname.split('.')[0];
}
/**
 * Read the raw Supabase session JSON from localStorage.
 * Returns null if no session exists or if running in a non-browser environment.
 */
function readRawSession(): Record<string, unknown> | null {
  const probe = probeRawSession();
  return probe.ok ? probe.value : null;
}

function probeRawSession(): OperationResult<Record<string, unknown> | null> {
  if (typeof window === 'undefined') {
    return operationSuccess(null, { policy: 'best_effort' });
  }
  try {
    const raw = localStorage.getItem(`sb-${getProjectRef()}-auth-token`);
    if (!raw) {
      return operationSuccess(null, { policy: 'best_effort' });
    }

    try {
      return operationSuccess(JSON.parse(raw) as Record<string, unknown>, {
        policy: 'best_effort',
      });
    } catch (parseError) {
      return operationFailure(parseError, {
        policy: 'degrade',
        recoverable: true,
        errorCode: 'session_storage_parse_failed',
        message: 'Failed to parse cached Supabase session.',
        cause: parseError,
      });
    }
  } catch (storageError) {
    return operationFailure(storageError, {
      policy: 'degrade',
      recoverable: true,
      errorCode: 'session_storage_unavailable',
      message: 'Unable to access localStorage for cached Supabase session.',
      cause: storageError,
    });
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Read the access token directly from localStorage -- synchronous, no navigator.locks.
 * Returns null if no session exists in storage (user is signed out).
 */
export function readAccessTokenFromStorage(): string | null {
  const parsed = readRawSession();
  if (!parsed) return null;
  return readString(parsed.access_token);
}

/**
 * Read the user ID directly from localStorage -- synchronous, no navigator.locks.
 * Returns null if no session exists in storage (user is signed out).
 */
export function readUserIdFromStorage(): string | null {
  const parsed = readRawSession();
  if (!parsed) return null;
  const user = parsed.user;
  if (!user || typeof user !== 'object') return null;
  return readString((user as Record<string, unknown>).id);
}

export function hasStoredSessionToken(): boolean {
  return readAccessTokenFromStorage() !== null;
}
