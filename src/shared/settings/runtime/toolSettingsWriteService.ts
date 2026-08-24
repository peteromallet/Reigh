import { getSupabaseClient } from '@/integrations/supabase/client';
import {
  enqueueSettingsWrite,
  initializeSettingsWriteQueue,
  type QueuedWrite,
} from '@/shared/lib/settingsWriteQueue';
import { deepMerge } from '@/shared/lib/utils/deepEqual';
import { toJsonObject } from '@/shared/lib/json/toJsonObject';
import { isCancellationError } from '@/shared/lib/errorHandling/errorUtils';
import { ToolSettingsError } from './toolSettingsService';

export type SettingsScope = 'user' | 'project' | 'shot';
type SettingsScopeTableName = 'users' | 'projects' | 'shots';

const SETTINGS_SCOPE_TABLES: Record<SettingsScope, SettingsScopeTableName> = {
  user: 'users',
  project: 'projects',
  shot: 'shots',
};

function assertNeverScope(scope: never): never {
  throw new Error(`Unsupported settings scope: ${String(scope)}`);
}

function resolveSettingsScopeTable(scope: SettingsScope): SettingsScopeTableName {
  switch (scope) {
    case 'user':
    case 'project':
    case 'shot':
      return SETTINGS_SCOPE_TABLES[scope];
    default:
      return assertNeverScope(scope);
  }
}

function selectSettingsForScope(scope: SettingsScope, id: string) {
  const tableName = resolveSettingsScopeTable(scope);
  return getSupabaseClient()
    .from(tableName)
    .select('settings')
    .eq('id', id)
    .single();
}

function callUpdateToolSettingsAtomicRpc(
  tableName: SettingsScopeTableName,
  id: string,
  toolId: string,
  settings: Record<string, unknown>,
) {
  return getSupabaseClient().rpc('update_tool_settings_atomic', {
    p_table_name: tableName,
    p_id: id,
    p_tool_id: toolId,
    p_settings: toJsonObject(settings),
  });
}

type SettingsWriteMode = 'debounced' | 'immediate';

interface UpdateToolSettingsParams {
  scope: SettingsScope;
  id: string;
  toolId: string;
  patch: unknown;
}

interface UpdateToolSettingsOptions {
  signal?: AbortSignal;
  mode?: SettingsWriteMode;
}

interface AbortSignalCapable<T> {
  abortSignal?: (signal: AbortSignal) => T;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return !!value
    && typeof value === 'object'
    && 'aborted' in value
    && typeof (value as AbortSignal).addEventListener === 'function';
}

function isSettingsWriteMode(value: unknown): value is SettingsWriteMode {
  return value === 'debounced' || value === 'immediate';
}

function maybeAttachAbortSignal<T>(query: T, signal?: AbortSignal): T {
  if (!signal) return query;

  const candidate = query as T & AbortSignalCapable<T>;
  if (typeof candidate.abortSignal === 'function') {
    return candidate.abortSignal(signal);
  }

  return query;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ToolSettingsError('cancelled', 'Request was cancelled', {
      recoverable: true,
      cause: signal.reason,
    });
  }
}

async function fetchSettingsForScope(
  scope: SettingsScope,
  id: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);

  return maybeAttachAbortSignal(selectSettingsForScope(scope, id), signal);
}

async function rawUpdateToolSettings(write: QueuedWrite): Promise<Record<string, unknown>> {
  const { scope, entityId: id, toolId, patch, signal } = write;

  try {
    if (scope !== 'user' && scope !== 'project' && scope !== 'shot') {
      throw new ToolSettingsError(
        'invalid_scope_identifier',
        `Invalid scope: ${scope}`,
      );
    }

    const tableName = resolveSettingsScopeTable(scope);
    const { data: currentEntity, error: fetchError } = await fetchSettingsForScope(scope, id, signal);

    if (fetchError) {
      const errorMessage = fetchError.message || '';
      if (
        errorMessage.includes('ERR_INSUFFICIENT_RESOURCES')
        || errorMessage.includes('Failed to fetch')
        || fetchError.code === 'ERR_INSUFFICIENT_RESOURCES'
      ) {
        throw new ToolSettingsError(
          'network',
          `Network exhaustion: ${errorMessage}`,
          { recoverable: true, cause: fetchError },
        );
      }
      throw new ToolSettingsError(
        'scope_fetch_failed',
        `Failed to fetch current ${scope} settings: ${errorMessage}`,
        { recoverable: true, cause: fetchError },
      );
    }

    const currentSettings = (currentEntity?.settings as Record<string, unknown>) ?? {};
    const currentToolSettings = (currentSettings[toolId] as Record<string, unknown>) ?? {};
    const updatedToolSettings = deepMerge({}, currentToolSettings, patch);

    throwIfAborted(signal);
    const { error: rpcError } = await maybeAttachAbortSignal(
      callUpdateToolSettingsAtomicRpc(
        tableName,
        id,
        toolId,
        updatedToolSettings,
      ),
      signal,
    );

    if (rpcError) {
      throw new ToolSettingsError(
        'scope_fetch_failed',
        `Failed to update ${scope} settings: ${rpcError.message}`,
        { recoverable: true, cause: rpcError },
      );
    }

    return updatedToolSettings;
  } catch (error: unknown) {
    if (isCancellationError(error)) {
      throw new ToolSettingsError('cancelled', 'Request was cancelled', {
        recoverable: true,
        cause: error,
      });
    }

    throw error;
  }
}

export function initializeToolSettingsWriteRuntime(): void {
  initializeSettingsWriteQueue(rawUpdateToolSettings);
}

export function updateToolSettingsSupabase(
  params: UpdateToolSettingsParams,
  options: UpdateToolSettingsOptions = {},
): Promise<Record<string, unknown>> {
  const { scope, id, toolId, patch } = params;
  const signal = isAbortSignal(options.signal) ? options.signal : undefined;
  const mode = isSettingsWriteMode(options.mode) ? options.mode : 'debounced';

  return enqueueSettingsWrite({
    scope,
    entityId: id,
    toolId,
    patch: patch as Record<string, unknown>,
    ...(signal ? { signal } : {}),
  }, mode, rawUpdateToolSettings) as Promise<Record<string, unknown>>;
}
