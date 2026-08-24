import type { DeferredSupabaseClient } from '@/integrations/supabase/deferredRuntime';
import { createSupabaseClient } from '@/integrations/supabase/bootstrap/createSupabaseClient';
import { initializeSupabaseRuntime } from '@/integrations/supabase/bootstrap/initializeSupabaseRuntime';

type SupabaseClientInstance = DeferredSupabaseClient;
const SUPABASE_RUNTIME_NOT_INITIALIZED_MESSAGE =
  'Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap.';

let runtimeClient: SupabaseClientInstance | null = null;
let runtimeError: Error | null = null;

export type SupabaseClientAccessResult =
  | { ok: true; client: SupabaseClientInstance }
  | { ok: false; error: Error };

export function normalizeSupabaseError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function initializeSupabaseClientRuntime(): SupabaseClientInstance {
  if (runtimeClient) {
    return runtimeClient;
  }

  try {
    const client = createSupabaseClient();
    initializeSupabaseRuntime(client);
    runtimeClient = client;
    runtimeError = null;
    return client;
  } catch (error) {
    const normalized = normalizeSupabaseError(error);
    runtimeClient = null;
    runtimeError = normalized;
    throw normalized;
  }
}

export function getSupabaseRuntimeClientResult(): SupabaseClientAccessResult {
  if (runtimeClient) {
    return { ok: true, client: runtimeClient };
  }

  if (runtimeError) {
    return { ok: false, error: runtimeError };
  }

  return {
    ok: false,
    error: new Error(SUPABASE_RUNTIME_NOT_INITIALIZED_MESSAGE),
  };
}

export function getOrInitializeSupabaseRuntimeClientResult(): SupabaseClientAccessResult {
  const existing = getSupabaseRuntimeClientResult();
  if (existing.ok) {
    return existing;
  }

  try {
    return {
      ok: true,
      client: initializeSupabaseClientRuntime(),
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error),
    };
  }
}
