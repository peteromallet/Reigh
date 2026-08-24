import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useToolSettings } from '@/shared/hooks/settings/useToolSettings';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { LoraHeaderActions } from '@/shared/components/LoraHeaderActions';
import type { ActiveLora, LoraModel } from '@/domains/lora/types/lora';
import { buildLoraAutoLoadStateKey } from './loraStateHelpers';

interface LoraPersistenceSettings extends Record<string, unknown> {
  loras?: { id: string; strength: number }[];
  hasEverSetLoras?: boolean;
}

interface LoraPersistenceManagerHandle {
  selectedLoras: ActiveLora[];
  selectedLorasRef: React.MutableRefObject<ActiveLora[]>;
  availableLoras: LoraModel[];
  handleAddLora: (lora: LoraModel, isManualAction?: boolean, initialStrength?: number) => void;
  handleRemoveLora: (loraId: string, isManualAction?: boolean) => void;
  handleLoraStrengthChange: (loraId: string, strength: number, isManualAction?: boolean) => void;
  markAsUserSet: () => void;
  setHasEverSetLoras: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseLoraPersistenceArgs {
  projectId?: string;
  shotId?: string;
  persistenceScope: 'project' | 'shot' | 'none';
  persistenceKey: string;
  disableAutoLoad: boolean;
  enableProjectPersistence: boolean;
  manager: LoraPersistenceManagerHandle;
}

interface UseLoraPersistenceReturn {
  persistenceSettings: LoraPersistenceSettings | undefined;
  isSavingLoras: boolean;
  hasSavedLoras: boolean;
  saveSuccess: boolean;
  saveFlash: boolean;
  handleSaveProjectLoras: () => Promise<void>;
  handleLoadProjectLoras: () => Promise<void>;
  renderHeaderActions: (customLoadHandler?: () => Promise<void>) => React.ReactNode;
}

export function useLoraPersistence({
  projectId,
  shotId,
  persistenceScope,
  persistenceKey,
  disableAutoLoad,
  enableProjectPersistence,
  manager,
}: UseLoraPersistenceArgs): UseLoraPersistenceReturn {
  const {
    selectedLoras,
    selectedLorasRef,
    availableLoras,
    handleAddLora,
    handleRemoveLora,
    handleLoraStrengthChange,
    markAsUserSet,
    setHasEverSetLoras,
  } = manager;
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [userHasManuallyInteracted, setUserHasManuallyInteracted] = useState(false);
  const [lastSavedLoras, setLastSavedLoras] = useState<{ id: string; strength: number }[] | null>(null);
  const autoLoadStateRef = useRef<string>('');

  const {
    settings: persistenceSettings,
    update: updatePersistenceSettings,
    isUpdating: isSavingLoras,
  } = useToolSettings<LoraPersistenceSettings>(persistenceKey, {
    projectId: persistenceScope === 'project'
      ? projectId
      : (enableProjectPersistence ? projectId : undefined),
    shotId: persistenceScope === 'shot' ? shotId : undefined,
    enabled: persistenceScope !== 'none' || enableProjectPersistence,
  });

  const projectLoraSettings = enableProjectPersistence ? persistenceSettings : undefined;

  const handleSaveProjectLoras = useCallback(async () => {
    if (!enableProjectPersistence || !projectId) {
      return;
    }

    setSaveFlash(true);
    try {
      const lorasToSave = selectedLorasRef.current.map((lora) => ({
        id: lora.id,
        strength: lora.strength,
      }));

      await updatePersistenceSettings('project', {
        loras: lorasToSave,
        hasEverSetLoras: true,
      });

      setLastSavedLoras(lorasToSave);
      markAsUserSet();
      setSaveFlash(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useLoraManager', showToast: false });
      setSaveFlash(false);
    }
  }, [enableProjectPersistence, markAsUserSet, projectId, selectedLorasRef, updatePersistenceSettings]);

  const handleLoadProjectLoras = useCallback(async () => {
    if (!enableProjectPersistence) {
      return;
    }

    const savedLoras = projectLoraSettings?.loras;
    if (!savedLoras || savedLoras.length === 0) {
      return;
    }

    try {
      setUserHasManuallyInteracted(false);
      const savedLoraIds = new Set(savedLoras.map((lora) => lora.id));
      const currentLoras = selectedLorasRef.current;
      const currentLoraIds = new Set(currentLoras.map((lora) => lora.id));

      const lorasToRemove = currentLoras.filter((lora) => !savedLoraIds.has(lora.id));
      lorasToRemove.forEach((lora) => handleRemoveLora(lora.id, false));

      const lorasToAdd = savedLoras.filter((savedLora) => !currentLoraIds.has(savedLora.id));
      for (const savedLora of lorasToAdd) {
        const availableLora = availableLoras.find((lora) => lora['Model ID'] === savedLora.id);
        if (availableLora) {
          handleAddLora(availableLora, false, savedLora.strength);
        } else {
          console.warn(`LoRA ${savedLora.id} not found in available LoRAs`);
        }
      }

      savedLoras.forEach((savedLora) => {
        if (currentLoraIds.has(savedLora.id)) {
          handleLoraStrengthChange(savedLora.id, savedLora.strength, false);
        }
      });

      markAsUserSet();
    } catch (error) {
      normalizeAndPresentError(error, { context: 'useLoraManager', showToast: false });
    }
  }, [
    availableLoras,
    enableProjectPersistence,
    handleAddLora,
    handleLoraStrengthChange,
    handleRemoveLora,
    markAsUserSet,
    projectLoraSettings?.loras,
    selectedLorasRef,
  ]);

  useEffect(() => {
    if (persistenceScope !== 'none' && persistenceSettings) {
      if (persistenceSettings.hasEverSetLoras !== undefined) {
        setHasEverSetLoras(persistenceSettings.hasEverSetLoras);
      } else if (persistenceSettings.loras && persistenceSettings.loras.length > 0) {
        setHasEverSetLoras(true);
      }
    }
  }, [persistenceScope, persistenceSettings, setHasEverSetLoras]);

  useEffect(() => {
    if (projectLoraSettings?.loras && !lastSavedLoras) {
      setLastSavedLoras(projectLoraSettings.loras);
    }
  }, [lastSavedLoras, projectLoraSettings?.loras]);

  const hasSavedLoras = !!(
    enableProjectPersistence
    && projectLoraSettings?.loras
    && projectLoraSettings.loras.length > 0
  );

  useEffect(() => {
    if (disableAutoLoad) {
      return;
    }

    const stateKey = buildLoraAutoLoadStateKey(
      enableProjectPersistence,
      hasSavedLoras,
      selectedLoras.length,
      userHasManuallyInteracted,
    );
    if (stateKey === autoLoadStateRef.current) {
      return;
    }

    if (enableProjectPersistence && hasSavedLoras && selectedLoras.length === 0 && !userHasManuallyInteracted) {
      void handleLoadProjectLoras();
    }

    autoLoadStateRef.current = stateKey;
  }, [
    disableAutoLoad,
    enableProjectPersistence,
    handleLoadProjectLoras,
    hasSavedLoras,
    selectedLoras.length,
    userHasManuallyInteracted,
  ]);

  const renderHeaderActions = useCallback((customLoadHandler?: () => Promise<void>) => {
    if (!enableProjectPersistence) {
      return null;
    }

    const currentSavedLoras = lastSavedLoras || projectLoraSettings?.loras;
    const savedLorasContent = currentSavedLoras && currentSavedLoras.length > 0
      ? `Saved LoRAs (${currentSavedLoras.length}):\\n${currentSavedLoras.map((lora) => `• ${lora.id} (strength: ${lora.strength})`).join('\\n')}`
      : 'No saved LoRAs available';

    return (
      <LoraHeaderActions
        hasSavedLoras={hasSavedLoras}
        selectedLorasCount={selectedLoras.length}
        isSaving={isSavingLoras}
        saveSuccess={saveSuccess}
        saveFlash={saveFlash}
        savedLorasContent={savedLorasContent}
        onSave={handleSaveProjectLoras}
        onLoad={customLoadHandler || handleLoadProjectLoras}
      />
    );
  }, [
    enableProjectPersistence,
    handleLoadProjectLoras,
    handleSaveProjectLoras,
    hasSavedLoras,
    isSavingLoras,
    lastSavedLoras,
    projectLoraSettings?.loras,
    saveFlash,
    saveSuccess,
    selectedLoras.length,
  ]);

  return {
    persistenceSettings,
    isSavingLoras,
    hasSavedLoras,
    saveSuccess,
    saveFlash,
    handleSaveProjectLoras,
    handleLoadProjectLoras,
    renderHeaderActions,
  };
}
