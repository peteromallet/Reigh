/**
 * Tool Settings Service facade
 *
 * Public contract:
 * - auth cache lifecycle
 * - error classification/normalization
 * - scope fetch orchestration
 * - single-flight merged settings reads
 */
import { isKnownSettingsId } from '@/shared/lib/settingsIds';
import {
  operationSuccess,
  type OperationResult,
} from '@/shared/lib/operationResult';
import {
  clearCachedUserId,
  createDirectAuthCacheSyncSource,
  ensureToolSettingsAuthCacheInitialized,
  getToolSettingsRuntimeClient,
  initializeToolSettingsAuthCache,
  readCachedUserId,
  resolveAndCacheUserId,
  resetToolSettingsAuthCacheForTesting,
  setCachedUserId,
  setToolSettingsAuthCacheInvalidationHandler,
} from '@/shared/settings/runtime/toolSettingsAuth';
import {
  classifyToolSettingsError,
  normalizeToolSettingsOperationFailure,
  raceWithAbort,
  throwIfAborted,
  toToolSettingsErrorFromOperationFailure,
  ToolSettingsError,
} from '@/shared/settings/runtime/toolSettingsErrors';
import {
  fetchToolSettingsScopes,
  mergeToolSettingsScopes,
} from '@/shared/settings/runtime/toolSettingsScopes';
import type {
  AuthCacheSyncSource,
  SettingsFetchResult,
  ToolSettingsContext,
  ToolSettingsSupabaseClient,
} from '@/shared/settings/runtime/toolSettingsTypes';
import type { ToolDefaultsById, ToolDefaultsId } from '@/tooling/toolDefaultsRegistry';

export type {
  AuthCacheSyncSource,
  SettingsFetchResult,
  ToolSettingsContext,
  ToolSettingsSupabaseClient,
} from '@/shared/settings/runtime/toolSettingsTypes';

const inflightSettingsFetches = new Map<string, Promise<unknown>>();
setToolSettingsAuthCacheInvalidationHandler(() => {
  inflightSettingsFetches.clear();
});

const unknownSettingsIdsReported = new Set<string>();

function reportUnknownSettingsId(toolId: string): void {
  if (isKnownSettingsId(toolId) || unknownSettingsIdsReported.has(toolId)) {
    return;
  }
  if (import.meta.env.MODE === 'test') {
    return;
  }
  unknownSettingsIdsReported.add(toolId);
  if (import.meta.env.DEV) {
    console.warn(
      `[toolSettingsService] Unknown settings key "${toolId}". ` +
      'Add this key to SETTINGS_IDS if it should be persisted via useToolSettings.',
    );
  }
}

export async function fetchToolSettingsResult<T extends ToolDefaultsId>(
  toolId: T,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<OperationResult<SettingsFetchResult<ToolDefaultsById[T]>>>;
export async function fetchToolSettingsResult<T extends object>(
  toolId: string,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<OperationResult<SettingsFetchResult<T>>>;
export async function fetchToolSettingsResult<T extends object>(
  toolId: string,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<OperationResult<SettingsFetchResult<T>>> {
  try {
    reportUnknownSettingsId(toolId);
    if (signal?.aborted) {
      return normalizeToolSettingsOperationFailure(new ToolSettingsError('cancelled', 'Request was cancelled', {
        recoverable: true,
      }));
    }

    const runtimeClient = getToolSettingsRuntimeClient(supabaseClient);
    if (!runtimeClient) {
      return normalizeToolSettingsOperationFailure(new ToolSettingsError(
        'unknown',
        'Tool settings runtime is not initialized',
      ));
    }

    const { data: { user } } = await resolveAndCacheUserId(runtimeClient);
    if (!user) {
      return normalizeToolSettingsOperationFailure(new ToolSettingsError('auth_required', 'Authentication required'));
    }

    const userId = user.id;
    const singleFlightKey = JSON.stringify({
      toolId,
      projectId: ctx.projectId ?? null,
      shotId: ctx.shotId ?? null,
      userId,
    });

    const existingPromise = inflightSettingsFetches.get(singleFlightKey);
    if (existingPromise) {
      const value = await raceWithAbort(existingPromise as Promise<SettingsFetchResult<T>>, signal);
      return operationSuccess(value);
    }

    const promise = (async (): Promise<SettingsFetchResult<T>> => {
      throwIfAborted(signal);
      const [userResult, projectResult, shotResult] = await fetchToolSettingsScopes(
        runtimeClient,
        userId,
        ctx,
        signal,
      );
      throwIfAborted(signal);

      const { data: { user: latestUser } } = await resolveAndCacheUserId(runtimeClient);
      if (!latestUser || latestUser.id !== userId) {
        throw new ToolSettingsError('cancelled', 'Request was cancelled due to auth state change', {
          recoverable: true,
          metadata: { expectedUserId: userId, latestUserId: latestUser?.id ?? null },
        });
      }

      return mergeToolSettingsScopes<T>(userResult, projectResult, shotResult, toolId, ctx);
    })();

    inflightSettingsFetches.set(singleFlightKey, promise);
    promise.finally(() => {
      inflightSettingsFetches.delete(singleFlightKey);
    }).catch(() => {});

    const value = await raceWithAbort(promise, signal);
    return operationSuccess(value);
  } catch (error: unknown) {
    return normalizeToolSettingsOperationFailure(error);
  }
}

export async function fetchToolSettingsSupabase<T extends ToolDefaultsId>(
  toolId: T,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<SettingsFetchResult<ToolDefaultsById[T]>>;
export async function fetchToolSettingsSupabase<T extends object>(
  toolId: string,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<SettingsFetchResult<T>>;
export async function fetchToolSettingsSupabase<T extends object>(
  toolId: string,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
  supabaseClient?: ToolSettingsSupabaseClient,
): Promise<SettingsFetchResult<T>> {
  const result = await fetchToolSettingsResult<T>(toolId, ctx, signal, supabaseClient);
  if (!result.ok) {
    throw toToolSettingsErrorFromOperationFailure(result);
  }
  return result.value;
}

export function _resetCachedUserForTesting(): void {
  resetToolSettingsAuthCacheForTesting();
  inflightSettingsFetches.clear();
}

export {
  clearCachedUserId,
  classifyToolSettingsError,
  createDirectAuthCacheSyncSource,
  ensureToolSettingsAuthCacheInitialized,
  getToolSettingsRuntimeClient,
  initializeToolSettingsAuthCache,
  readCachedUserId,
  resolveAndCacheUserId,
  setCachedUserId,
  ToolSettingsError,
};
