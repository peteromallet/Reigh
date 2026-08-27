import { useCallback, useRef, useMemo, useEffect } from 'react';
import { TOOL_IDS } from '@/shared/lib/tooling/toolIds';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { useAutoSaveSettings } from '@/shared/settings/hooks/useAutoSaveSettings';
import {
  VideoTravelSettings,
  DEFAULT_PHASE_CONFIG,
  createDefaultVideoTravelSettings,
  normalizeVideoTravelSettings,
} from '../../settings';
import { STORAGE_KEYS } from '@/shared/lib/storage/storageKeys';
import { readLastEditedLoraFromLocalStorage, readLastEditedLoraFromProject } from '@/shared/lib/lastEditedLora';
import { getSupabaseClient as supabase } from '@/integrations/supabase/client';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { DEFAULT_STEERABLE_MOTION_SETTINGS } from '../../components/ShotEditor/state/types';
import { useSessionInheritedDefaults } from './inheritedDefaults';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';

export interface UseShotSettingsReturn {
  // State
  settings: VideoTravelSettings;
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  /** The shot ID these settings are confirmed for (null if not yet loaded) */
  shotId: string | null;
  isDirty: boolean;
  error: Error | null;
  
  // Field Updates
  updateField: <K extends keyof VideoTravelSettings>(
    key: K, 
    value: VideoTravelSettings[K]
  ) => void;
  
  updateFields: (updates: Partial<VideoTravelSettings>) => void;
  
  // Operations
  applyShotSettings: (sourceShotId: string) => Promise<void>;
  applyProjectDefaults: () => Promise<void>;
  resetToDefaults: () => void;
  
  // Saving
  save: () => Promise<void>;
  saveImmediate: () => Promise<void>;
  revert: () => void;
}

/**
 * Shot-specific settings hook built on useAutoSaveSettings.
 * 
 * Adds shot-specific functionality:
 * - Session storage inheritance for new shots
 * - localStorage persistence for cross-shot inheritance
 * - Apply settings from another shot
 * - Apply project defaults
 * - Special handling for advancedMode/phaseConfig initialization
 */
export const useShotSettings = (
  shotId: string | null | undefined,
  projectId: string | null | undefined,
): UseShotSettingsReturn => {
  const inheritedSettings = useSessionInheritedDefaults<VideoTravelSettings>({
    shotId,
    storageKeyForShot: STORAGE_KEYS.APPLY_PROJECT_DEFAULTS,
    mergeDefaults: (defaults) => {
      const { _uiSettings, ...validSettings } = defaults;
      return normalizeVideoTravelSettings({
        ...createDefaultVideoTravelSettings(),
        ...validSettings,
        steerableMotionSettings: {
          ...DEFAULT_STEERABLE_MOTION_SETTINGS,
          ...(typeof validSettings.steerableMotionSettings === 'object' && validSettings.steerableMotionSettings
            ? validSettings.steerableMotionSettings
            : {}),
        },
      });
    },
    context: 'useShotSettings',
  });
  
  // Memoize defaults so the reference is stable across renders — an unstable
  // `defaults` ripples into useAutoSaveSettings' load effects (their deps include
  // `defaults`), causing the whole settings tree to re-render on every tick.
  const stableDefaults = useMemo(
    () => inheritedSettings || createDefaultVideoTravelSettings(),
    [inheritedSettings],
  );

  // Use the shared auto-save hook with inherited settings as initial defaults
  const autoSave = useAutoSaveSettings<VideoTravelSettings>({
    toolId: TOOL_IDS.TRAVEL_BETWEEN_IMAGES,
    shotId,
    projectId,
    scope: 'shot',
    defaults: stableDefaults,
    enabled: !!shotId,
    debounceMs: 300,
  });
  const {
    settings,
    status,
    entityId,
    isDirty,
    error,
    hasShotSettings,
    updateField: autoSaveUpdateField,
    updateFields: autoSaveUpdateFields,
    saveImmediate,
    revert,
  } = autoSave;
  const seededLastEditedLoraShotIdRef = useRef<string | null>(null);
  const isLocalMode = hasLocalModeUrlParams(typeof window === 'undefined' ? '' : window.location.search);

  useEffect(() => {
    seededLastEditedLoraShotIdRef.current = null;
  }, [shotId]);

  console.log('[ModeDebug][ShotSettings] shotId=%s status=%s hasShotSettings=%s generationMode=%s hasInherited=%s', shotId, status, hasShotSettings, settings?.generationMode ?? 'NOT SET', !!inheritedSettings);

  // Save inherited settings to DB immediately if we have them
  // CRITICAL: Only save if the shot doesn't already have settings in DB
  // to prevent overwriting existing settings with inherited defaults
  // We use `hasShotSettings` from useToolSettings which checks at the DB level
  // Apply inherited settings for a brand-new shot.
  // We use `updateFields` (not `saveImmediate`) because the shared useToolSettings
  // cascade returns the project-level fallback (often with `loras: []`) for shots
  // without their own row, and useAutoSaveSettings spreads that fallback over our
  // inherited defaults — wiping the seeded LoRA from UI state. `updateFields` marks
  // the settings as pending-write, which causes the RQ loader to skip its overwrite
  // and keep our inherited seed. It also triggers persistence.
  // We fire as soon as possible (no status gate) so this happens before the RQ
  // loader would otherwise overwrite state.
  const appliedInheritedShotIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!inheritedSettings || !shotId || hasShotSettings) return;
    if (appliedInheritedShotIdRef.current === shotId) return;
    appliedInheritedShotIdRef.current = shotId;
    try {
      autoSaveUpdateFields(inheritedSettings);
    } catch (err) {
      appliedInheritedShotIdRef.current = null;
      normalizeAndPresentError(err, { context: 'useShotSettings', showToast: false });
    }
  }, [inheritedSettings, shotId, hasShotSettings, autoSaveUpdateFields]);

  useEffect(() => {
    appliedInheritedShotIdRef.current = null;
  }, [shotId]);

  useEffect(() => {
    if (
      !shotId
      || status !== 'ready'
      || hasShotSettings
      || inheritedSettings
      || !settings
      || (settings.loras ?? []).length > 0
      || seededLastEditedLoraShotIdRef.current === shotId
    ) {
      return;
    }

    seededLastEditedLoraShotIdRef.current = shotId;
    let cancelled = false;

    const seedUnopenedShotLoras = async () => {
      try {
        const localLastEditedLora = readLastEditedLoraFromLocalStorage(projectId);
        const lastEditedLora = isLocalMode
          ? localLastEditedLora
          : localLastEditedLora === undefined
          ? await readLastEditedLoraFromProject(projectId)
          : localLastEditedLora;
        if (cancelled) {
          return;
        }

        // Only persist when we actually have a LoRA to seed. Saving an empty array
        // here would lock `loras: []` into the shot's DB row and permanently wipe
        // LoRAs for users who haven't set lastEditedLora yet.
        if (!lastEditedLora) {
          return;
        }

        await saveImmediate({
          ...settings,
          loras: [lastEditedLora],
        });
      } catch (err) {
        seededLastEditedLoraShotIdRef.current = null;
        if (!cancelled) {
          normalizeAndPresentError(err, { context: 'useShotSettings.seedLastEditedLora', showToast: false });
        }
      }
    };

    void seedUnopenedShotLoras();

    return () => {
      cancelled = true;
    };
  }, [hasShotSettings, inheritedSettings, isLocalMode, projectId, saveImmediate, settings, shotId, status]);
  
  // Persist settings to localStorage for future inheritance
  useEffect(() => {
    if (shotId && projectId && status === 'ready' && settings) {
      try {
        // Project-specific key
        const projectStorageKey = STORAGE_KEYS.LAST_ACTIVE_SHOT_SETTINGS(projectId);
        localStorage.setItem(projectStorageKey, JSON.stringify(settings));
        
        // Global key (without pairConfigs which are shot-specific)
        const globalSettings = { ...settings, pairConfigs: [] };
        localStorage.setItem(STORAGE_KEYS.GLOBAL_LAST_ACTIVE_SHOT_SETTINGS, JSON.stringify(globalSettings));
      } catch (e) {
        normalizeAndPresentError(e, { context: 'useShotSettings', showToast: false });
      }
    }
  }, [settings, shotId, projectId, status]);
  
  // Refs for callbacks that need latest values without recreation
  const autoSaveSettingsRef = useRef(autoSave.settings);
  autoSaveSettingsRef.current = autoSave.settings;
  const shotIdRef = useRef(shotId);
  shotIdRef.current = shotId;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // Wrapped updateField with special handling for advancedMode/phaseConfig
  const updateField = useCallback(<K extends keyof VideoTravelSettings>(
    key: K,
    value: VideoTravelSettings[K]
  ) => {
    // Handle special case: when switching to advanced mode, initialize phaseConfig
    if (key === 'advancedMode' && value === true) {
      const currentSettings = autoSaveSettingsRef.current;
      if (!currentSettings.phaseConfig) {
        autoSaveUpdateFields({
          [key]: value,
          phaseConfig: DEFAULT_PHASE_CONFIG,
        } as Partial<VideoTravelSettings>);
        return;
      }
    }
    if (key === 'motionMode' && value === 'advanced') {
      const currentSettings = autoSaveSettingsRef.current;
      if (!currentSettings.phaseConfig) {
        autoSaveUpdateFields({
          [key]: value,
          phaseConfig: DEFAULT_PHASE_CONFIG,
        } as Partial<VideoTravelSettings>);
        return;
      }
    }

    autoSaveUpdateField(key, value);
  }, [autoSaveUpdateField, autoSaveUpdateFields]);
  
  // Apply settings from another shot
  const applyShotSettings = useCallback(async (sourceShotId: string) => {
    if (isLocalMode) {
      toast.info('Applying settings is unavailable for a local Astrid timeline.');
      return;
    }
    if (!shotIdRef.current || !sourceShotId) {
      toast.error('Cannot apply settings: missing shot ID');
      return;
    }

    try {
      const { data, error: fetchError } = await supabase().from('shots')
        .select('settings')
        .eq('id', sourceShotId)
        .single();

      if (fetchError) throw fetchError;

      const sourceSettingsRaw = (data?.settings as Record<string, unknown>)?.[TOOL_IDS.TRAVEL_BETWEEN_IMAGES];

      if (sourceSettingsRaw) {
        autoSaveUpdateFields(normalizeVideoTravelSettings(sourceSettingsRaw));
      } else {
        toast.error('Source shot has no settings');
      }
    } catch (err) {
      normalizeAndPresentError(err, { context: 'useShotSettings', toastTitle: 'Failed to apply settings' });
    }
  }, [autoSaveUpdateFields, isLocalMode]);

  // Apply project defaults
  const applyProjectDefaults = useCallback(async () => {
    if (isLocalMode) {
      toast.info('Project defaults are unavailable for a local Astrid timeline.');
      return;
    }
    if (!projectIdRef.current) {
      toast.error('Cannot apply defaults: no project selected');
      return;
    }

    try {
      const { data, error: fetchError } = await supabase().from('projects')
        .select('settings')
        .eq('id', projectIdRef.current)
        .single();

      if (fetchError) throw fetchError;

      const projectDefaultsRaw = (data?.settings as Record<string, unknown>)?.[TOOL_IDS.TRAVEL_BETWEEN_IMAGES];

      if (projectDefaultsRaw) {
        autoSaveUpdateFields(normalizeVideoTravelSettings(projectDefaultsRaw));
      } else {
        toast.error('Project has no default settings');
      }
    } catch (err) {
      normalizeAndPresentError(err, { context: 'useShotSettings', toastTitle: 'Failed to apply defaults' });
    }
  }, [autoSaveUpdateFields, isLocalMode]);

  // Reset to hardcoded defaults
  const resetToDefaults = useCallback(() => {
    autoSaveUpdateFields(createDefaultVideoTravelSettings());
  }, [autoSaveUpdateFields]);
  
  // Memoize return value
  return useMemo(() => ({
    settings,
    status: status as 'idle' | 'loading' | 'ready' | 'saving' | 'error',
    shotId: entityId,
    isDirty,
    error,
    updateField,
    updateFields: autoSaveUpdateFields,
    applyShotSettings,
    applyProjectDefaults,
    resetToDefaults,
    save: saveImmediate,
    saveImmediate,
    revert,
  }), [
    settings,
    status,
    entityId,
    isDirty,
    error,
    updateField,
    autoSaveUpdateFields,
    saveImmediate,
    revert,
    applyShotSettings,
    applyProjectDefaults,
    resetToDefaults,
  ]);
};
