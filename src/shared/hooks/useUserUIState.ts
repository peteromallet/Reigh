import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { useRenderLogger } from '@/shared/lib/debug/debugRendering';
import type { Json } from '@/integrations/supabase/jsonTypes';
import { updateToolSettingsSupabase } from '@/shared/hooks/settings/useToolSettings';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { SETTINGS_IDS } from '@/shared/lib/settingsIds';
import { isLocalTestMode } from '@/app/localTestRuntime';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { isDeferredCloudDataAuthority } from '@/app/runtime/dataAuthority';

// Module-level request deduplication cache for the raw `users.settings` DB fetch.
//
// WHY THIS EXISTS (instead of React Query):
// This hook reads a single key from `users.settings.ui`, but many instances
// mount concurrently for different keys (generationMethods, privacyDefaults,
// theme, etc.). Without deduplication, each mount fires an identical
// `SELECT settings FROM users WHERE id = ?` query.
//
// WHY NOT React Query: The hook's read path has complex per-key logic
// (fallback merging, normalization, auto-backfill of missing DB fields)
// that runs after fetching the raw settings row. Migrating to React Query
// would require either (a) a single shared query that all instances subscribe
// to (losing per-key granularity for loading/error states), or (b) per-key
// queries that each fetch the same row (defeating deduplication). The current
// approach deduplicates at the network layer while keeping per-key logic local.
//
// WRITES already go through useToolSettings' global write queue, so there is
// no write-side duplication -- only this read-side cache is parallel.
interface CachedUserSettingsRow {
  settings?: Json;
}
interface CachedSettingsResult {
  data: CachedUserSettingsRow | null;
  error: unknown;
}
interface SettingsCacheEntry {
  data: CachedSettingsResult | null;
  timestamp: number;
  loading: Promise<CachedSettingsResult> | null;
}
const settingsCache = new Map<string, SettingsCacheEntry>();
const CACHE_DURATION = 30000; // 30 seconds

// In-flight-only dedupe for the auth `getUser()` burst.
//
// WHY THIS EXISTS: ~18 `useUserUIState` instances mount concurrently (one per
// UI setting key), and every mount used to fire its own
// `supabase().auth.getUser()`. That burst trips Supabase's lock-steal
// protection (each call opens a session lock and steals it from the previous
// call). We share ONE in-flight promise so the burst resolves to a single
// `getUser()` call.
//
// WHY NOT CACHE THE RESULT: auth state can change while the hook stays
// mounted (login/logout), and the resolved user is cheap to re-fetch. Only the
// in-flight promise is shared; once it settles the next mount does a fresh
// auth check. Callers still read the session through the shared Supabase
// client afterward.
interface GetUserResult {
  data: { user: { id: string } | null };
  error: unknown;
}
let pendingUserCheck: Promise<GetUserResult> | null = null;

function dedupeGetUser(): Promise<GetUserResult> {
  if (!pendingUserCheck) {
    pendingUserCheck = supabase().auth.getUser().finally(() => {
      pendingUserCheck = null;
    });
  }
  return pendingUserCheck;
}

interface UISettings {
  defaultTool: {
    toolId: string;
  };
  paneLocks: {
    shots: boolean;
    tasks: boolean;
    gens: boolean;
    editor: boolean;
  };
  settingsModal: {
    activeTab: string;
  };
  videoTravelWidescreen: {
    enabled: boolean;
  };
  imageDeletion?: {
    skipConfirmation: boolean;
  };
  generationMethods: {
    onComputer: boolean;
    inCloud: boolean;
  };
  aiInputMode: {
    mode: 'voice' | 'text';
  };
  privacyDefaults: {
    resourcesPublic: boolean;
    generationsPublic: boolean;
  };
  theme: {
    darkMode: boolean; // Defaults to true (dark mode) for new users
  };
  productTour?: {
    completed: boolean;
    skipped: boolean;
  };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function decodePaneLocks(
  value: unknown,
  fallback: UISettings['paneLocks'],
): UISettings['paneLocks'] {
  const record = toRecord(value);
  return {
    shots: readBoolean(record?.shots, fallback.shots),
    tasks: readBoolean(record?.tasks, fallback.tasks),
    gens: readBoolean(record?.gens, fallback.gens),
    editor: readBoolean(record?.editor, fallback.editor),
  };
}

function decodeDefaultTool(
  value: unknown,
  fallback: UISettings['defaultTool'],
): UISettings['defaultTool'] {
  const record = toRecord(value);
  return {
    toolId: readString(record?.toolId, fallback.toolId),
  };
}

function decodeSettingsModal(
  value: unknown,
  fallback: UISettings['settingsModal'],
): UISettings['settingsModal'] {
  const record = toRecord(value);
  return {
    activeTab: readString(record?.activeTab, fallback.activeTab),
  };
}

function decodeVideoTravelWidescreen(
  value: unknown,
  fallback: UISettings['videoTravelWidescreen'],
): UISettings['videoTravelWidescreen'] {
  const record = toRecord(value);
  return {
    enabled: readBoolean(record?.enabled, fallback.enabled),
  };
}

function decodeImageDeletion(
  value: unknown,
  fallback: NonNullable<UISettings['imageDeletion']>,
): NonNullable<UISettings['imageDeletion']> {
  const record = toRecord(value);
  return {
    skipConfirmation: readBoolean(record?.skipConfirmation, fallback.skipConfirmation),
  };
}

function decodeGenerationMethods(
  value: unknown,
  fallback: UISettings['generationMethods'],
): UISettings['generationMethods'] {
  const record = toRecord(value);
  const normalized = {
    inCloud: readBoolean(record?.inCloud, fallback.inCloud),
    onComputer: readBoolean(record?.onComputer, fallback.onComputer),
  };

  if (normalized.inCloud && normalized.onComputer) {
    return {
      inCloud: true,
      onComputer: false,
    };
  }

  return normalized;
}

function decodeAIInputMode(
  value: unknown,
  fallback: UISettings['aiInputMode'],
): UISettings['aiInputMode'] {
  const record = toRecord(value);
  const mode = record?.mode === 'voice' || record?.mode === 'text'
    ? record.mode
    : fallback.mode;

  return { mode };
}

function decodePrivacyDefaults(
  value: unknown,
  fallback: UISettings['privacyDefaults'],
): UISettings['privacyDefaults'] {
  const record = toRecord(value);
  return {
    resourcesPublic: readBoolean(record?.resourcesPublic, fallback.resourcesPublic),
    generationsPublic: readBoolean(record?.generationsPublic, fallback.generationsPublic),
  };
}

function decodeTheme(
  value: unknown,
  fallback: UISettings['theme'],
): UISettings['theme'] {
  const record = toRecord(value);
  return {
    darkMode: readBoolean(record?.darkMode, fallback.darkMode),
  };
}

function decodeProductTour(
  value: unknown,
  fallback: NonNullable<UISettings['productTour']>,
): NonNullable<UISettings['productTour']> {
  const record = toRecord(value);
  return {
    completed: readBoolean(record?.completed, fallback.completed),
    skipped: readBoolean(record?.skipped, fallback.skipped),
  };
}

function normalizeUserUISetting<K extends keyof UISettings>(
  key: K,
  value: unknown,
  fallback: UISettings[K],
): UISettings[K] {
  switch (key) {
    case 'defaultTool':
      return decodeDefaultTool(value, fallback as UISettings['defaultTool']) as UISettings[K];
    case 'paneLocks':
      return decodePaneLocks(value, fallback as UISettings['paneLocks']) as UISettings[K];
    case 'settingsModal':
      return decodeSettingsModal(value, fallback as UISettings['settingsModal']) as UISettings[K];
    case 'videoTravelWidescreen':
      return decodeVideoTravelWidescreen(
        value,
        fallback as UISettings['videoTravelWidescreen'],
      ) as UISettings[K];
    case 'imageDeletion':
      return decodeImageDeletion(
        value,
        fallback as NonNullable<UISettings['imageDeletion']>,
      ) as UISettings[K];
    case 'generationMethods':
      return decodeGenerationMethods(
        value,
        fallback as UISettings['generationMethods'],
      ) as UISettings[K];
    case 'aiInputMode':
      return decodeAIInputMode(value, fallback as UISettings['aiInputMode']) as UISettings[K];
    case 'privacyDefaults':
      return decodePrivacyDefaults(
        value,
        fallback as UISettings['privacyDefaults'],
      ) as UISettings[K];
    case 'theme':
      return decodeTheme(value, fallback as UISettings['theme']) as UISettings[K];
    case 'productTour':
      return decodeProductTour(
        value,
        fallback as NonNullable<UISettings['productTour']>,
      ) as UISettings[K];
    default:
      return fallback;
  }
}

function mergeSettingRecords(currentValue: unknown, patch: unknown): Record<string, unknown> {
  return {
    ...(toRecord(currentValue) ?? {}),
    ...(toRecord(patch) ?? {}),
  };
}

function hasPersistedValueDrift(value: unknown, normalizedValue: unknown): boolean {
  return JSON.stringify(value) !== JSON.stringify(normalizedValue);
}

// Cached settings loader to prevent duplicate database calls  
const loadUserSettingsCached = async (userId: string) => {
  const cacheKey = `user_settings_${userId}`;
  const cached = settingsCache.get(cacheKey);
  
  // Return fresh cached data
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.data;
  }
  
  // If there's already a loading request, wait for it
  if (cached?.loading) {
    return await cached.loading;
  }
  
  // Make new database call and cache the promise
  const loadingPromise: Promise<CachedSettingsResult> = (async () => {
    try {
      const result = await supabase().from('users')
        .select('settings')
        .eq('id', userId)
        .single();
      const typedResult: CachedSettingsResult = {
        data: result.data ? { settings: result.data.settings } : null,
        error: result.error,
      };
      settingsCache.set(cacheKey, {
        data: typedResult,
        timestamp: Date.now(),
        loading: null
      });
      return typedResult;
    } catch (error) {
      settingsCache.delete(cacheKey);
      throw error;
    }
  })();
  
  // Cache the loading promise to prevent duplicate requests
  settingsCache.set(cacheKey, {
    data: cached?.data || null,
    timestamp: cached?.timestamp || 0,
    loading: loadingPromise
  });
  
  return await loadingPromise;
};

/**
 * Hook for user-scoped UI preferences (theme, pane locks, generation methods, etc.).
 *
 * Scope: user-only (stored in `users.settings.ui`).
 * Auto-save: yes, 200ms debounce via the global settings write queue.
 *
 * Use this for preferences that follow the user across all projects/shots.
 * For project/shot-scoped settings, use `useAutoSaveSettings` instead.
 *
 * @see docs/structure_detail/settings_system.md for the full settings hook decision tree
 */
export function useUserUIState<K extends keyof UISettings>(
  key: K,
  fallback: UISettings[K]
) {
  // `localTest=1` deliberately boots without Supabase. User preferences are
  // presentation inputs in that runtime, so use the supplied defaults and
  // keep updates local instead of touching an intentionally absent client.
  const localTestMode = isLocalTestMode();
  // Local Astrid editor mode is a bridge-owned surface.  The app shell still
  // mounts a number of preference consumers around it, but none of those
  // consumers may probe or write the Supabase `users.settings` row.  Keep the
  // check at this shared boundary so a newly-mounted shell consumer cannot
  // accidentally reintroduce a remote request.
  const isLocalMode = hasLocalModeUrlParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const isDeferredCloudMode = isDeferredCloudDataAuthority();
  // Stabilize fallback using a ref so callers can pass inline objects without causing
  // infinite render loops. The load effect reads fallbackRef.current instead of depending
  // on fallback directly, preventing re-runs when the reference changes but values don't.
  const fallbackRef = useRef<UISettings[K]>(fallback);
  fallbackRef.current = fallback;

  useRenderLogger(`UserUIState:${key}`);

  const [value, setValue] = useState<UISettings[K]>(fallback);
  const [isLoading, setIsLoading] = useState(
    !(localTestMode || isLocalMode || !isDeferredCloudMode),
  );
  const userIdRef = useRef<string>();
  const debounceRef = useRef<NodeJS.Timeout>();
  // Ref so that `update` can read the latest value without depending on it
  const valueRef = useRef(value);
  valueRef.current = value;

  // Helper function to save fallback values to database (preserves all existing settings)
  // This automatically backfills existing users with default values when they first load the app
  // IMPORTANT: Only runs when the key is completely missing from database (undefined)
  // Does NOT override explicit user choices (including both options set to false)
  const saveFallbackToDatabase = useCallback(async (userId: string) => {
    if (localTestMode || isLocalMode || !isDeferredCloudMode) return;

    try {
      const fallbackToSave = normalizeUserUISetting(key, fallbackRef.current, fallbackRef.current);

      // Use the global queue to save - it handles merging
      await updateToolSettingsSupabase({
        scope: 'user',
        id: userId,
        toolId: SETTINGS_IDS.USER_UI_STATE,
        patch: { [key]: fallbackToSave },
      }, { mode: 'immediate' });

      // Invalidate cache so other components see the backfilled values
      const cacheKey = `user_settings_${userId}`;
      settingsCache.delete(cacheKey);
      setValue(fallbackToSave); // Update local state after successful save
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useUserUIState.saveFallbackToDatabase', showToast: false });
    }
  }, [isDeferredCloudMode, isLocalMode, key, localTestMode]);

  // Load initial value from database
  useEffect(() => {
    if (localTestMode || isLocalMode || !isDeferredCloudMode) {
      userIdRef.current = undefined;
      setIsLoading(false);
      return;
    }

    const loadUserSettings = async () => {
      try {
        const { data: { user } } = await dedupeGetUser();
        if (!user) {
          // Skip loading for unauthenticated users (e.g., on public share pages)
          setIsLoading(false);
          return;
        }

        userIdRef.current = user.id;

        const cachedResult = await loadUserSettingsCached(user.id);
        const data = cachedResult?.data ?? null;
        const error = cachedResult?.error ?? null;

        if (error) {
          normalizeAndPresentError(error, { context: 'useUserUIState.loadSettings', showToast: false });
          setIsLoading(false);
          return;
        }

        const settingsRecord = toRecord(data?.settings);
        const uiSettings = toRecord(settingsRecord?.ui);
        const keyValue = uiSettings?.[key];

        if (keyValue !== undefined) {
          const normalizedValue = normalizeUserUISetting(key, keyValue, fallbackRef.current);
          setValue(normalizedValue);

          // If any fields from the fallback are missing in the stored value OR
          // normalization changed the value, backfill them in DB
          if (hasPersistedValueDrift(keyValue, normalizedValue)) {
            // Use the global queue to save - it handles merging
            updateToolSettingsSupabase({
              scope: 'user',
              id: user.id,
              toolId: SETTINGS_IDS.USER_UI_STATE,
              patch: { [key]: normalizedValue },
            }, { mode: 'immediate' }).then(() => {
              const cacheKey = `user_settings_${user.id}`;
              settingsCache.delete(cacheKey);
            }).catch(e => {
              normalizeAndPresentError(e, { context: 'useUserUIState.backfillFields', showToast: false });
            });
          }
        } else {
          // Key doesn't exist in database - this is an existing user who hasn't set preferences yet
          // Save fallback values to backfill them (only runs when completely empty)
          const normalizedFallback = normalizeUserUISetting(key, fallbackRef.current, fallbackRef.current);
          setValue(normalizedFallback); // Set normalized fallback immediately for responsive UI

          // Save to database in background (don't block loading)
          saveFallbackToDatabase(user.id).catch(error => {
            normalizeAndPresentError(error, { context: 'useUserUIState.saveFallback', showToast: false });
          });
        }

        setIsLoading(false);
      } catch (error) {
        normalizeAndPresentError(error, { context: 'useUserUIState.loadUserSettings', showToast: false });
        setIsLoading(false);
      }
    };

    loadUserSettings();
  }, [isDeferredCloudMode, isLocalMode, key, localTestMode, saveFallbackToDatabase]);

  // Debounced update function
  // Uses the global settings write queue (via updateToolSettingsSupabase) to prevent
  // race conditions with other hooks that write to users.settings (e.g., useToolSettings
  // writing user-preferences). The write queue serializes writes and uses an atomic RPC.
  const update = useCallback((patch: Partial<UISettings[K]>) => {
    // Immediately update local state for responsive UI (with normalization)
    const normalizedPatch = normalizeUserUISetting(
      key,
      mergeSettingRecords(valueRef.current, patch),
      fallbackRef.current,
    );
    setValue(normalizedPatch);

    if (localTestMode || isLocalMode || !isDeferredCloudMode) {
      return;
    }

    // Clear existing timeout
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Preference changes inside local mode are intentionally ephemeral.  The
    // caller still gets an immediate local update for responsive UI, but no
    // timer is armed and therefore no Supabase write can happen later.
    if (isLocalMode || !isDeferredCloudMode) return;

    // Debounce the database write via the global settings write queue
    debounceRef.current = setTimeout(async () => {
      const userId = userIdRef.current;
      if (!userId) return;

      try {
        // Use the write queue which handles atomic DB updates and merging.
        // This prevents race conditions with other hooks writing to users.settings.
        await updateToolSettingsSupabase({
          scope: 'user',
          id: userId,
          toolId: SETTINGS_IDS.USER_UI_STATE,
          patch: { [key]: normalizedPatch },
        });

        // Invalidate local cache so other useUserUIState instances see the update
        const cacheKey = `user_settings_${userId}`;
        settingsCache.delete(cacheKey);
      } catch (error) {
        normalizeAndPresentError(error, { context: 'useUserUIState.update', showToast: false });
      }
    }, 200);
  }, [isDeferredCloudMode, isLocalMode, key, localTestMode]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return useMemo(() => ({
    value,
    update,
    isLoading
  }), [value, update, isLoading]);
}

/** @internal Only for test isolation — do not call in production code. */
export function _resetUserUIStateCacheForTesting(): void {
  settingsCache.clear();
  pendingUserCheck = null;
}
