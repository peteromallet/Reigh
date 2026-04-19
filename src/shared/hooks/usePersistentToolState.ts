import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { SettingsScope } from '@/shared/settings';
import { useRenderLogger } from '@/shared/lib/debug/debugRendering';
import { useAutoSaveSettings } from '@/shared/settings/hooks/useAutoSaveSettings';
import { deepEqual, sanitizeSettings } from '@/shared/lib/utils/deepEqual';
import { getToolDefaults } from '@/tooling/toolDefaultsRegistry';

/**
 * Infer an appropriate "empty" value for a given value based on its type.
 * 
 * IMPORTANT: This is a SAFETY NET for fields that are persisted but don't have
 * explicit defaults defined in their tool's settings.ts file. This prevents stale
 * state from previous projects from persisting when switching projects.
 * 
 * BEST PRACTICE: All persisted fields should have explicit defaults in settings.ts,
 * even if those defaults are empty (e.g., prompts: [], batchVideoPrompt: '').
 * This makes the "contract" of what gets persisted clear and self-documenting.
 * 
 * @param value - The current state value to infer an empty value from
 * @returns An appropriate empty value based on the type of the input
 */
function inferEmptyValue(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (typeof value === 'object' && value !== null) return {};
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return undefined;
}

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>;
type StateMapping<T extends object> = {
  [K in keyof T]: [T[K], StateSetter<T[K]>];
};

interface UsePersistentToolStateOptions<T extends object> {
  debounceMs?: number;
  scope?: SettingsScope;
  /**
   * If false, the hook will skip fetching/saving settings and immediately report ready=true.
   * Useful when the relevant entity (e.g. project) has not been selected yet.
   */
  enabled?: boolean;
  /**
   * Explicit defaults for fields that aren't in the tools manifest.
   * Use this for non-tool callers (e.g. PromptEditorModal) to avoid
   * the "no default value" warning and ensure correct reset behavior.
   */
  defaults?: Partial<T>;
}

interface UsePersistentToolStateResult {
  ready: boolean;
  isSaving: boolean;
  saveError?: Error;
  hasUserInteracted: boolean;
  markAsInteracted: () => void;
}

/**
 * Hook that synchronizes existing `useState` variables with persistent tool settings.
 *
 * Unlike `useAutoSaveSettings` which owns its own state, this hook binds to
 * pre-existing `[value, setter]` pairs -- useful when the form already manages
 * its own `useState` and you want to add persistence without restructuring.
 *
 * Key difference from `useAutoSaveSettings`: the `markAsInteracted()` guard.
 * Settings are only saved after the user explicitly interacts, preventing
 * auto-initialization effects from being persisted as user choices.
 *
 * For new features, prefer `useAutoSaveSettings` unless you specifically need
 * the bind-to-existing-useState pattern or the interaction guard.
 *
 * @param toolId - The tool identifier (e.g., 'image-generation', 'video-travel')
 * @param context - Context for settings resolution (projectId, shotId, etc.)
 * @param stateMapping - Object mapping setting keys to [value, setter] tuples
 * @param options - Additional options for behavior customization
 * @returns Object with ready state, saving state, and interaction tracking
 *
 * @see docs/structure_detail/settings_system.md for the full settings hook decision tree
 *
 * @example
 * const { ready, isSaving, markAsInteracted } = usePersistentToolState(
 *   'image-generation',
 *   { projectId },
 *   {
 *     generationMode: [generationMode, setGenerationMode],
 *     imagesPerPrompt: [imagesPerPrompt, setImagesPerPrompt],
 *   }
 * );
 * // Call markAsInteracted() in onChange handlers to enable persistence
 */
export function usePersistentToolState<T extends object>(
  toolId: string,
  context: { projectId?: string; shotId?: string },
  stateMapping: StateMapping<T>,
  options: UsePersistentToolStateOptions<T> = {}
): UsePersistentToolStateResult {
  const { debounceMs = 500, scope = 'project', enabled = true, defaults: explicitDefaults } = options;
  const warnedMissingDefaultsRef = useRef<Set<string>>(new Set());
  const persistenceScope: 'shot' | 'project' = scope === 'shot' ? 'shot' : 'project';

  // Track hydration and interaction state
  const hasHydratedRef = useRef(false);
  const userHasInteractedRef = useRef(false);
  const lastSyncedSettingsRef = useRef<T | null>(null);
  const hydratedForEntityRef = useRef<string | null>(null);

  // Public state for consumers
  const [ready, setReady] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Get a unique key for the current entity (project/shot)
  const entityKey = persistenceScope === 'shot' ? context.shotId : context.projectId;
  const normalizedProjectId = context.projectId ?? null;
  const normalizedShotId = context.shotId ?? null;

  useRenderLogger(`PersistentToolState:${toolId}`, { entityKey, enabled });

  const resolvedDefaults = useMemo(() => {
    const fromRegistry = explicitDefaults ?? getToolDefaults(toolId);
    const merged: Record<string, unknown> = { ...(fromRegistry ?? {}) };

    Object.entries(stateMapping).forEach(([key, mapping]) => {
      const [currentValue] = mapping as [T[keyof T], React.Dispatch<React.SetStateAction<T[keyof T]>>];
      if (merged[key] !== undefined) return;
      const inferred = inferEmptyValue(currentValue);
      merged[key] = inferred;

      if (import.meta.env.DEV) {
        const warningKey = `${toolId}:${key}`;
        if (!warnedMissingDefaultsRef.current.has(warningKey)) {
          warnedMissingDefaultsRef.current.add(warningKey);
          console.warn(
            `[usePersistentToolState] Field "${key}" in tool "${toolId}" has no default value. ` +
            `Inferring empty value (${JSON.stringify(inferred)}). ` +
            `Consider adding explicit default in settings.ts`
          );
        }
      }
    });

    return merged as T;
  }, [explicitDefaults, stateMapping, toolId]);

  const autoSave = useAutoSaveSettings<T>({
    toolId,
    shotId: normalizedShotId,
    projectId: normalizedProjectId,
    scope: persistenceScope,
    defaults: resolvedDefaults,
    enabled: enabled && !!entityKey,
    // Preserve existing behavior: this adapter intentionally keeps a short debounce.
    debounceMs: Math.min(debounceMs, 100),
  });
  const autoSaveStatus = autoSave.status;
  const autoSaveSettings = autoSave.settings as Partial<T>;
  const autoSaveUpdateFields = autoSave.updateFields as (updates: Partial<T>) => void;
  const autoSaveError = autoSave.error;

  // Reset hydration when entity changes
  useEffect(() => {
    if (entityKey !== hydratedForEntityRef.current) {
      hasHydratedRef.current = false;
      userHasInteractedRef.current = false;
      lastSyncedSettingsRef.current = null;
      hydratedForEntityRef.current = entityKey || null;
      setReady(false);
      setHasUserInteracted(false);
    }
  }, [entityKey, toolId]);

  // Hydrate external state setters from persisted settings once entity is ready.
  useEffect(() => {
    if (!enabled || !entityKey || hasHydratedRef.current || autoSaveStatus !== 'ready') return;

    const effectiveSettings = (autoSaveSettings || resolvedDefaults) as Partial<T>;
    Object.entries(stateMapping).forEach(([key, mapping]) => {
      const [, setter] = mapping as [T[keyof T], React.Dispatch<React.SetStateAction<T[keyof T]>>];
      setter(effectiveSettings[key as keyof T] as T[keyof T]);
    });

    hasHydratedRef.current = true;
    userHasInteractedRef.current = false;
    setReady(true);
  }, [autoSaveSettings, autoSaveStatus, enabled, entityKey, resolvedDefaults, stateMapping]);

  // Collect current state values from the mapping
  const getCurrentState = useCallback((): T => {
    const currentState: Record<string, unknown> = {};
    Object.entries(stateMapping as Record<string, [unknown, React.Dispatch<React.SetStateAction<unknown>>]>).forEach(([key, [value]]) => {
      currentState[key] = value;
    });
    return currentState as T;
  }, [stateMapping]);

  // Function to mark that user has interacted
  const markAsInteracted = useCallback(() => {
    if (!enabled) return;
    userHasInteractedRef.current = true;
    setHasUserInteracted(true);
  }, [enabled]);

  const noopMarkAsInteracted = useCallback(() => {}, []);
  const stateValuesSignature = useMemo(() => {
    const stateValues: Record<string, unknown> = {};
    Object.entries(stateMapping as Record<string, [unknown, React.Dispatch<React.SetStateAction<unknown>>]>).forEach(([key, [value]]) => {
      stateValues[key] = value;
    });
    return JSON.stringify(stateValues);
  }, [stateMapping]);

  // Push external state updates into the canonical auto-save hook after user interaction.
  useEffect(() => {
    if (
      !enabled ||
      !entityKey ||
      !hasHydratedRef.current ||
      !userHasInteractedRef.current ||
      autoSaveStatus === 'loading'
    ) {
      return;
    }

    const currentState = getCurrentState();

    if (
      lastSyncedSettingsRef.current &&
      deepEqual(
        sanitizeSettings(currentState),
        sanitizeSettings(lastSyncedSettingsRef.current)
      )
    ) {
      return;
    }

    if (deepEqual(sanitizeSettings(currentState), sanitizeSettings(autoSaveSettings))) {
      return;
    }

    lastSyncedSettingsRef.current = currentState;
    autoSaveUpdateFields(currentState);
  }, [
    autoSaveSettings,
    autoSaveStatus,
    autoSaveUpdateFields,
    enabled,
    entityKey,
    getCurrentState,
    stateValuesSignature,
  ]);

  return {
    ready: enabled ? !!entityKey && ready : true,
    isSaving: enabled ? autoSaveStatus === 'saving' : false,
    saveError: enabled ? autoSaveError ?? undefined : undefined,
    hasUserInteracted: enabled ? hasUserInteracted : false,
    markAsInteracted: enabled ? markAsInteracted : noopMarkAsInteracted,
  };
}
