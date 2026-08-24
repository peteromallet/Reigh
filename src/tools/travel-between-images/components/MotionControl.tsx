import React, { useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { Label } from '@/shared/components/ui/primitives/label';
import { PhaseConfigVertical } from '@/shared/components/PhaseConfigSelectorModal';
import { PhaseConfigSelectorModal } from '@/shared/components/PhaseConfigSelectorModal';
import { FEATURED_PRESET_IDS } from './MotionControl.constants';
import { MotionControlBasicTab } from './MotionControlBasicTab';
import { useMotionControlPresetState } from './hooks/useMotionControlPresetState';
import type { MotionControlProps } from './MotionControl.types';
import { getModelSpec } from '../settings';

export const MotionControl: React.FC<MotionControlProps> = ({
  mode,
  lora,
  presets,
  advanced,
  stateOverrides,
}) => {
  const {
    motionMode,
    onMotionModeChange,
    selectedModel,
    generationTypeMode = 'i2v',
    hasStructureVideo = false,
    guidanceKind,
  } = mode;
  const spec = getModelSpec(selectedModel);
  const {
    selectedLoras,
    availableLoras,
    onAddLoraClick,
    onRemoveLora,
    onLoraStrengthChange,
    onAddTriggerWord,
    renderLoraHeaderActions,
  } = lora;
  const {
    selectedPhasePresetId,
    onPhasePresetSelect,
    onPhasePresetRemove,
    currentSettings,
    featuredPresetIds = FEATURED_PRESET_IDS,
  } = presets;
  const {
    phaseConfig,
    onPhaseConfigChange,
    onBlurSave,
    randomSeed,
    onRandomSeedChange,
    onRestoreDefaults,
  } = advanced;
  const {
    turboMode,
    settingsLoading,
    smoothContinuations,
    onSmoothContinuationsChange,
  } = stateOverrides ?? {};

  const {
    isPresetModalOpen,
    openPresetModal,
    closePresetModal,
    allPresets,
    builtinDefaultId,
    isCustomConfig,
    isSelectedPresetKnown,
    handleSwitchToAdvanced,
    handleCustomClick,
    handlePresetSelect,
  } = useMotionControlPresetState({
    generationTypeMode,
    featuredPresetIds,
    selectedPhasePresetId,
    onPhasePresetSelect,
    onPhasePresetRemove,
    motionMode,
    settingsLoading,
    onMotionModeChange,
  });

  const handleModeChange = useCallback(
    (newMode: string) => {
      if (newMode === motionMode) {
        return;
      }

      if (turboMode && newMode === 'advanced') {
        return;
      }

      onMotionModeChange(newMode as 'basic' | 'advanced');
    },
    [motionMode, onMotionModeChange, turboMode],
  );

  return (
    <div className="space-y-4">
      {spec.ui.motionPresets ? (
        <Tabs value={motionMode} onValueChange={handleModeChange}>
          <div className="flex items-center gap-3 mb-3">
            <Label className="text-sm font-medium">Mode:</Label>
            <TabsList className="grid w-40 grid-cols-2">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="advanced" disabled={turboMode}>
                Advanced
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="basic" className="mt-0">
            <MotionControlBasicTab
              selectedModel={selectedModel}
              generationTypeMode={generationTypeMode}
              guidanceKind={guidanceKind}
              hasStructureVideo={hasStructureVideo}
              smoothContinuations={smoothContinuations}
              onSmoothContinuationsChange={onSmoothContinuationsChange}
              isSelectedPresetKnown={isSelectedPresetKnown}
              allPresets={allPresets}
              isCustomConfig={isCustomConfig}
              selectedPhasePresetId={selectedPhasePresetId}
              builtinDefaultId={builtinDefaultId}
              onPresetSelect={handlePresetSelect}
              onCustomClick={handleCustomClick}
              onOpenPresetModal={openPresetModal}
              phaseConfig={phaseConfig}
              onSwitchToAdvanced={handleSwitchToAdvanced}
              onPhasePresetRemove={onPhasePresetRemove}
              onAddLoraClick={onAddLoraClick}
              selectedLoras={selectedLoras}
              onRemoveLora={onRemoveLora}
              onLoraStrengthChange={onLoraStrengthChange}
              availableLoras={availableLoras}
              onAddTriggerWord={onAddTriggerWord}
              renderLoraHeaderActions={renderLoraHeaderActions}
            />
          </TabsContent>

          <TabsContent value="advanced" className="mt-4">
            {phaseConfig ? (
              <PhaseConfigVertical
                phaseConfig={phaseConfig}
                onPhaseConfigChange={onPhaseConfigChange}
                onBlurSave={onBlurSave}
                randomSeed={randomSeed}
                onRandomSeedChange={onRandomSeedChange}
                availableLoras={availableLoras}
                selectedPhasePresetId={selectedPhasePresetId}
                onPhasePresetSelect={onPhasePresetSelect}
                onPhasePresetRemove={onPhasePresetRemove}
                currentSettings={currentSettings}
                generationTypeMode={generationTypeMode}
                onRestoreDefaults={onRestoreDefaults}
              />
            ) : (
              <div className="text-sm text-muted-foreground p-4">
                No phase configuration available. Please enable advanced mode.
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <MotionControlBasicTab
          selectedModel={selectedModel}
          generationTypeMode={generationTypeMode}
          guidanceKind={guidanceKind}
          hasStructureVideo={hasStructureVideo}
          smoothContinuations={smoothContinuations}
          onSmoothContinuationsChange={onSmoothContinuationsChange}
          isSelectedPresetKnown={isSelectedPresetKnown}
          allPresets={allPresets}
          isCustomConfig={isCustomConfig}
          selectedPhasePresetId={selectedPhasePresetId}
          builtinDefaultId={builtinDefaultId}
          onPresetSelect={handlePresetSelect}
          onCustomClick={handleCustomClick}
          onOpenPresetModal={openPresetModal}
          phaseConfig={phaseConfig}
          onSwitchToAdvanced={handleSwitchToAdvanced}
          onPhasePresetRemove={onPhasePresetRemove}
          onAddLoraClick={onAddLoraClick}
          selectedLoras={selectedLoras}
          onRemoveLora={onRemoveLora}
          onLoraStrengthChange={onLoraStrengthChange}
          availableLoras={availableLoras}
          onAddTriggerWord={onAddTriggerWord}
          renderLoraHeaderActions={renderLoraHeaderActions}
        />
      )}

      {spec.ui.motionPresets && (
        <PhaseConfigSelectorModal
          isOpen={isPresetModalOpen}
          onClose={closePresetModal}
          onSelectPreset={(preset) => {
            handlePresetSelect({
              id: preset.id,
              metadata: {
                description: preset.metadata.description,
                phaseConfig: preset.metadata.phaseConfig,
                phase_config: preset.metadata.phaseConfig,
              },
            });
          }}
          onRemovePreset={onPhasePresetRemove}
          selectedPresetId={selectedPhasePresetId || null}
          currentPhaseConfig={phaseConfig}
          currentSettings={currentSettings}
        />
      )}
    </div>
  );
};
