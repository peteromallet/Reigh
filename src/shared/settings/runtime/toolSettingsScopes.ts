import { deepMerge } from '@/shared/lib/utils/deepEqual';
import { getErrorMessage } from '@/shared/lib/errorHandling/errorUtils';
import { getToolDefaults } from '@/tooling/toolDefaultsRegistry';
import { ToolSettingsError } from '@/shared/settings/runtime/toolSettingsErrors';
import type {
  AbortableQuery,
  SettingsFetchResult,
  SettingsRow,
  ToolSettingsContext,
  ToolSettingsSupabaseClient,
} from '@/shared/settings/runtime/toolSettingsTypes';

function maybeAttachAbortSignal<T>(query: T, signal?: AbortSignal): T {
  if (!signal) {
    return query;
  }
  const abortable = query as AbortableQuery<T>;
  if (typeof abortable.abortSignal === 'function') {
    return abortable.abortSignal(signal);
  }
  return query;
}

export function fetchToolSettingsScopes(
  supabaseClient: ToolSettingsSupabaseClient,
  userId: string,
  ctx: ToolSettingsContext,
  signal?: AbortSignal,
): Promise<[SettingsRow, SettingsRow, SettingsRow]> {
  const userQuery = maybeAttachAbortSignal(
    supabaseClient
      .from('users')
      .select('settings')
      .eq('id', userId)
      .maybeSingle(),
    signal,
  );
  const projectQuery = ctx.projectId
    ? maybeAttachAbortSignal(
        supabaseClient
          .from('projects')
          .select('settings')
          .eq('id', ctx.projectId)
          .maybeSingle(),
        signal,
      )
    : Promise.resolve({ data: null, error: null });
  const shotQuery = ctx.shotId
    ? maybeAttachAbortSignal(
        supabaseClient
          .from('shots')
          .select('settings')
          .eq('id', ctx.shotId)
          .maybeSingle(),
        signal,
      )
    : Promise.resolve({ data: null, error: null });

  return Promise.all([userQuery, projectQuery, shotQuery]) as Promise<[SettingsRow, SettingsRow, SettingsRow]>;
}

export function mergeToolSettingsScopes<T extends object>(
  userResult: SettingsRow,
  projectResult: SettingsRow,
  shotResult: SettingsRow,
  toolId: string,
  ctx: ToolSettingsContext,
): SettingsFetchResult<T> {
  if (userResult.error) {
    throw new ToolSettingsError(
      'scope_fetch_failed',
      `Failed to load user settings: ${getErrorMessage(userResult.error)}`,
      { recoverable: true, cause: userResult.error, metadata: { scope: 'user' } },
    );
  }
  if (ctx.projectId && projectResult.error) {
    throw new ToolSettingsError(
      'scope_fetch_failed',
      `Failed to load project settings: ${getErrorMessage(projectResult.error)}`,
      { recoverable: true, cause: projectResult.error, metadata: { scope: 'project', projectId: ctx.projectId } },
    );
  }
  if (ctx.shotId && shotResult.error) {
    throw new ToolSettingsError(
      'scope_fetch_failed',
      `Failed to load shot settings: ${getErrorMessage(shotResult.error)}`,
      { recoverable: true, cause: shotResult.error, metadata: { scope: 'shot', shotId: ctx.shotId } },
    );
  }

  const userSettingsData = userResult.data?.settings as Record<string, unknown> | null;
  const projectSettingsData = projectResult.data?.settings as Record<string, unknown> | null;
  const shotSettingsData = shotResult.data?.settings as Record<string, unknown> | null;
  const userSettings = (userSettingsData?.[toolId] as Record<string, unknown>) ?? {};
  const projectSettings = (projectSettingsData?.[toolId] as Record<string, unknown>) ?? {};
  const shotSettings = (shotSettingsData?.[toolId] as Record<string, unknown>) ?? {};
  const defaultSettings = getToolDefaults(toolId) ?? {};
  const hasShotSettings = Object.keys(shotSettings).length > 0;

  return {
    settings: deepMerge({}, defaultSettings, userSettings, projectSettings, shotSettings) as T,
    hasShotSettings,
  };
}
