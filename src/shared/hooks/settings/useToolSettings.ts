import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useCallback, useMemo } from 'react';
import { useAuthSafe } from '@/shared/contexts/AuthContext';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { queryKeys } from '@/shared/lib/queryKeys';
import { QUERY_PRESETS, STANDARD_RETRY_DELAY } from '@/shared/lib/query/queryDefaults';
import { deepMerge } from '@/shared/lib/utils/deepEqual';
import {
  classifyToolSettingsError,
  ensureToolSettingsAuthCacheInitialized,
  fetchToolSettingsSupabase,
  resolveAndCacheUserId,
  ToolSettingsError,
  type SettingsFetchResult,
} from '@/shared/settings';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import {
  updateToolSettingsSupabase,
  type SettingsScope,
} from '@/shared/settings';
import type { ToolDefaultsById, ToolDefaultsId } from '@/tooling/toolDefaultsRegistry';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';

export { updateToolSettingsSupabase } from '@/shared/settings';
export type { SettingsScope } from '@/shared/settings';

// ============================================================================
// Cache format helpers
// ============================================================================

/**
 * Helper to check if a cache value has the wrapper format.
 * fetchToolSettingsSupabase always returns { settings, hasShotSettings },
 * but legacy or manually-set cache entries may use flat format.
 */
function isSettingsWrapper(data: unknown): data is SettingsFetchResult {
  if (!data || typeof data !== 'object') return false;
  return 'settings' in data && 'hasShotSettings' in data;
}

/**
 * Helper to extract settings from cache data (handles wrapper format)
 * Cache stores data as { settings: T, hasShotSettings: boolean }
 */
export function extractSettingsFromCache<T>(cacheData: unknown): T | undefined {
  if (!cacheData) return undefined;
  return isSettingsWrapper(cacheData) ? (cacheData.settings as T) : (cacheData as T);
}

/**
 * Helper to update settings cache with proper wrapper format
 * Use this in setQueryData callbacks for optimistic updates
 *
 * @param prev - The previous cache value (may be wrapper or flat format)
 * @param updater - Either an object of updates, or a function that receives prevSettings and returns updates
 */
export function updateSettingsCache<T extends object>(
  prev: unknown,
  updater: Partial<T> | ((prevSettings: T) => Partial<T>)
): SettingsFetchResult<T> {
  const wrapper = isSettingsWrapper(prev);
  const prevSettings = (wrapper ? ((prev as SettingsFetchResult).settings ?? {}) : (prev ?? {})) as T;
  const updates = typeof updater === 'function' ? updater(prevSettings) : updater;
  return {
    settings: { ...prevSettings, ...updates } as T,
    hasShotSettings: wrapper ? ((prev as SettingsFetchResult).hasShotSettings ?? false) : false
  };
}

// ============================================================================
// Query retry helper
// ============================================================================

/** Determines whether a failed settings query should be retried. */
function shouldRetrySettingsQuery(failureCount: number, error: Error): boolean {
  const classified = classifyToolSettingsError(error);
  if (
    classified.code === 'auth_required'
    || classified.code === 'cancelled'
    || classified.code === 'network'
  ) {
    return false;
  }
  return failureCount < 3;
}

// ============================================================================
// Mutation success/error helpers
// ============================================================================

/** Merge mutation result into query cache and refetch related caches. */
function handleMutationSuccess(
  fullMergedSettings: Record<string, unknown> | null,
  toolId: string,
  projectId: string | undefined,
  shotId: string | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  if (fullMergedSettings === null) return;

  queryClient.setQueryData(
    queryKeys.settings.tool(toolId, projectId, shotId),
    (oldData: unknown) => {
      const oldWrapper = isSettingsWrapper(oldData);
      const oldSettings = oldWrapper
        ? (((oldData as SettingsFetchResult).settings ?? {}) as Record<string, unknown>)
        : ((oldData ?? {}) as Record<string, unknown>);
      const mergedSettings = deepMerge({}, oldSettings, fullMergedSettings);

      return {
        settings: mergedSettings,
        hasShotSettings: oldWrapper ? ((oldData as SettingsFetchResult).hasShotSettings ?? false) : false
      };
    }
  );

  if (shotId) {
    queryClient.refetchQueries({ queryKey: queryKeys.shots.batchSettings(shotId) });
  }
}

/** Log/toast mutation errors and invalidate cache for non-network failures. */
function handleMutationError(
  error: Error,
  toolId: string,
  projectId: string | undefined,
  shotId: string | undefined,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const classified = classifyToolSettingsError(error);

  if (classified.code === 'cancelled') {
    return;
  }

  if (classified.code === 'network') return;

  normalizeAndPresentError(classified, { context: 'useToolSettings.update', toastTitle: `Failed to save ${toolId} settings` });

  queryClient.invalidateQueries({
    queryKey: queryKeys.settings.tool(toolId, projectId, shotId)
  });
}

// Type overloads
export function useToolSettings<TToolId extends ToolDefaultsId>(toolId: TToolId, context?: { projectId?: string; shotId?: string; enabled?: boolean }): {
  settings: ToolDefaultsById[TToolId] | undefined;
  isLoading: boolean;
  error: Error | null;
  update: (scope: SettingsScope, settings: Partial<ToolDefaultsById[TToolId]>) => Promise<void>;
  isUpdating: boolean;
  hasShotSettings: boolean;
};
export function useToolSettings<T extends object>(toolId: string, context?: { projectId?: string; shotId?: string; enabled?: boolean }): {
  settings: T | undefined;
  isLoading: boolean;
  error: Error | null;
  update: (scope: SettingsScope, settings: Partial<T>) => Promise<void>;
  isUpdating: boolean;
  /** Whether the shot had settings stored in DB (vs just defaults/project settings) */
  hasShotSettings: boolean;
};

/**
 * Low-level hook for reading and writing tool settings across all scopes.
 *
 * This is the boundary layer under the settings hook family:
 * - `useAutoSaveSettings` is the default choice for feature code.
 * - `usePersistentToolState` adapts existing local `useState` to that model.
 * - `useToolSettings` stays for manual scope control and shared infrastructure.
 *
 * Performs cascade resolution (defaults -> user -> project -> shot) and returns
 * a merged settings object. Writes go through the global settings write queue.
 *
 * Most features should use `useAutoSaveSettings` instead, which adds auto-save,
 * dirty tracking, and entity-change handling on top of this hook.
 *
 * Use this directly only when you need manual save control or complex write patterns.
 *
 * @see docs/structure_detail/settings_system.md for the full settings hook decision tree
 */
export function useToolSettings<T extends object>(
  toolId: string,
  context?: { projectId?: string; shotId?: string; enabled?: boolean }
) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthSafe();
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const isDeferredCloudMode = isDeferredCloudDataAuthority();

  // Determine parameter shapes
  const projectIdFromRuntime = getProjectSelectionFallbackId() ?? undefined;
  const projectId: string | undefined = context?.projectId ?? projectIdFromRuntime ?? undefined;
  const shotId: string | undefined = context?.shotId;
  // Tool settings are user-scoped Supabase rows. Without a session (dev
  // local-mode editor, or any logged-out page) they cannot resolve and the
  // callers that omit `enabled` (AgentChatContext, ToolsPane, …) must not
  // fire a backend request. This is the single choke point.
  const fetchEnabled: boolean =
    (context?.enabled ?? true) && isAuthenticated && !isLocalMode && isDeferredCloudMode;

  // Refs to access current values in stable callbacks without recreating them
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const shotIdRef = useRef(shotId);
  shotIdRef.current = shotId;

  // Fetch merged settings using Supabase with mobile optimizations
  const { data: queryResult, isLoading, error } = useQuery({
    queryKey: queryKeys.settings.tool(toolId, projectId, shotId),
    queryFn: async ({ signal }): Promise<SettingsFetchResult<T>> => {
      const supabaseClient = getSupabaseClient();
      await ensureToolSettingsAuthCacheInitialized(supabaseClient);
      return fetchToolSettingsSupabase<T>(toolId, { projectId, shotId }, signal, supabaseClient);
    },
    enabled: !!toolId && fetchEnabled,
    ...QUERY_PRESETS.static,
    staleTime: 10 * 60 * 1000,
    retry: shouldRetrySettingsQuery,
    retryDelay: STANDARD_RETRY_DELAY,
    networkMode: 'online',
  });

  // Extract settings and hasShotSettings from the query result
  const wrapper = isSettingsWrapper(queryResult);
  const settings = wrapper ? (queryResult as SettingsFetchResult<T>).settings : queryResult;
  const hasShotSettings = wrapper ? ((queryResult as SettingsFetchResult<T>).hasShotSettings ?? false) : false;

  // Log errors for debugging (except expected cancellations)
  if (
    error
    && isDeferredCloudMode
    && classifyToolSettingsError(error).code !== 'cancelled'
  ) {
    normalizeAndPresentError(error, { context: 'useToolSettings', showToast: false });
  }

  // Update settings mutation
  const updateMutation = useMutation({
    mutationFn: async ({ scope, settings: newSettings, entityId }: {
      scope: SettingsScope;
      settings: Partial<T>;
      entityId?: string;
    }) => {
      if (isLocalMode || !isDeferredCloudMode) return null;

      let idForScope: string | undefined = entityId;

      if (!idForScope) {
        if (scope === 'user') {
          const supabaseClient = getSupabaseClient();
          await ensureToolSettingsAuthCacheInitialized(supabaseClient);
          const { data: { user } } = await resolveAndCacheUserId(supabaseClient);
          idForScope = user?.id;
          if (!idForScope) {
            throw new ToolSettingsError(
              'auth_required',
              'Authentication required for user settings update',
            );
          }
        } else if (scope === 'project') {
          idForScope = projectId;
        } else if (scope === 'shot') {
          idForScope = shotId;
        }
      }

      if (!idForScope) {
        throw new ToolSettingsError(
          'invalid_scope_identifier',
          `Missing identifier for ${scope} tool settings update`,
        );
      }

      const fullMergedSettings = await updateToolSettingsSupabase({
          scope,
          id: idForScope,
          toolId,
          patch: newSettings,
      });

      return fullMergedSettings;
    },
    onSuccess: (fullMergedSettings) => {
      handleMutationSuccess(fullMergedSettings, toolId, projectId, shotId, queryClient);
    },
    onError: (error: Error) => {
      handleMutationError(error, toolId, projectId, shotId, queryClient);
    },
  });

  // Get stable reference to mutateAsync - useMutation returns a new object each render
  // but mutateAsync itself is stable
  const mutateAsyncRef = useRef(updateMutation.mutateAsync);
  mutateAsyncRef.current = updateMutation.mutateAsync;

  // CRITICAL: Wrap in useCallback with stable deps to prevent cascading re-renders.
  // Use refs to access current projectId/shotId without recreating this function.
  // The entityId is snapshotted at call time via refs for correctness.
  const update = useCallback(async (scope: SettingsScope, settings: Partial<T>): Promise<void> => {
    // Snapshot the target entity id NOW to prevent cross-project/shot overwrites
    // Use refs to get current values without causing callback recreation
    const entityId = scope === 'project' ? projectIdRef.current : (scope === 'shot' ? shotIdRef.current : undefined);

    // NOTE: No debounce here - callers (like useShotSettings) are responsible for debouncing.
    // Using mutateAsync so callers can await the actual DB write completion.
    // Use ref to access stable mutateAsync without recreating this callback.
    await mutateAsyncRef.current({ scope, settings, entityId });
  }, []); // Empty deps - all values accessed via refs for stability

  return useMemo(() => ({
    settings: settings as T | undefined,
    isLoading,
    error: error as Error | null,
    update,
    isUpdating: updateMutation.isPending,
    hasShotSettings,
  }), [settings, isLoading, error, update, updateMutation.isPending, hasShotSettings]);
}
