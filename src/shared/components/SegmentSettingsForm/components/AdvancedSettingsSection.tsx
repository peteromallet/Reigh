/**
 * AdvancedSettingsSection Component
 *
 * The collapsible "Advanced Settings" area containing:
 * - Before/After prompt text fields
 * - Negative prompt
 * - Motion controls (MotionPresetSelector + LoRA selector)
 * - Structure video section (delegated to StructureVideoSection)
 * - LoRA selector modal
 */

import React from 'react';
import { useAdvancedSettingsHandlers } from '../hooks/useAdvancedSettingsHandlers';
import { useAdvancedSettingsState } from '../hooks/useAdvancedSettingsState';
import { useSaveFieldAsDefault } from '../hooks/useSaveFieldAsDefault';
import { Button } from '@/shared/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';
import { ChevronLeft } from 'lucide-react';
import {
  coerceSelectedModel,
  getModelSpec,
  resolveSelectedModelFromModelName,
} from '@/tools/travel-between-images/settings';
import { usePublicLoras } from '@/features/resources/hooks/useResources';
import { MotionPresetSection } from './MotionPresetSection';
import { StructureVideoSection } from './StructureVideoSection';
import { PromptFieldsSection } from './PromptFieldsSection';
import { NegativePromptField } from './NegativePromptField';
import { AdvancedSettingsLoraModal } from './AdvancedSettingsLoraModal';
import type { useStructureVideoUpload } from '../hooks/useStructureVideoUpload';
import type {
  SegmentSettings,
  SegmentSettingsFormProps,
  SegmentTimelineStructureVideoProps,
  StructureVideoDragHandlers,
} from '../types';

interface AdvancedSettingsSectionProps {
  // Settings
  settings: SegmentSettings;
  onChange: (updates: Partial<SegmentSettings>) => void;
  modelName?: string;
  queryKeyPrefix: string;
  edgeExtendAmount: 4 | 6;

  defaults?: {
    shotDefaults?: SegmentSettingsFormProps['shotDefaults'];
    hasOverride?: SegmentSettingsFormProps['hasOverride'];
    onSaveFieldAsDefault?: SegmentSettingsFormProps['onSaveFieldAsDefault'];
  };
  structureVideo?: {
    type?: SegmentSettingsFormProps['structureVideoType'];
    url?: SegmentSettingsFormProps['structureVideoUrl'];
    frameRange?: SegmentSettingsFormProps['structureVideoFrameRange'];
    defaults?: SegmentSettingsFormProps['structureVideoDefaults'];
  } & SegmentTimelineStructureVideoProps;
  videoInteraction: {
    videoUpload: ReturnType<typeof useStructureVideoUpload>;
  } & StructureVideoDragHandlers;
}

export const AdvancedSettingsSection: React.FC<AdvancedSettingsSectionProps> = ({
  settings,
  onChange,
  modelName,
  queryKeyPrefix,
  edgeExtendAmount,
  defaults,
  structureVideo,
  videoInteraction,
}) => {
  const shotDefaults = defaults?.shotDefaults;
  const hasOverride = defaults?.hasOverride;
  const onSaveFieldAsDefault = defaults?.onSaveFieldAsDefault;
  const {
    type: structureVideoType,
    url: structureVideoUrl,
    frameRange: structureVideoFrameRange,
    defaults: structureVideoDefaults,
    isTimelineMode,
    onAddSegmentStructureVideo,
    onRemoveSegmentStructureVideo,
  } = structureVideo ?? {};
  const {
    videoUpload,
    isDraggingVideo,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
  } = videoInteraction;
  const {
    showAdvanced,
    setShowAdvanced,
    isLoraModalOpen,
    openLoraModal,
    closeLoraModal,
    generationMode,
    builtinPreset,
    featuredPresetIds,
    effectiveLoras,
    isUsingMotionDefaults,
    isUsingLorasDefault,
  } = useAdvancedSettingsState({
    modelName,
    settings,
    shotDefaults,
  });

  const effectiveSelectedModel = coerceSelectedModel(
    settings.selectedModel ?? (modelName ? resolveSelectedModelFromModelName(modelName) : undefined)
  );
  const spec = getModelSpec(effectiveSelectedModel);

  const { savingField, handleSaveFieldAsDefault } = useSaveFieldAsDefault({
    onSaveFieldAsDefault,
    onChange,
  });
  const { data: availableLoras = [] } = usePublicLoras();
  const {
    handleMotionModeChange,
    handlePhaseConfigChange,
    handlePhasePresetSelect,
    handlePhasePresetRemove,
    handleRandomSeedChange,
    handleAddLoraClick,
    handleLoraSelect,
    handleRemoveLora,
    handleLoraStrengthChange,
    handleModelChange,
  } = useAdvancedSettingsHandlers({
    onChange,
    settings,
    shotDefaults,
    effectiveLoras,
    openLoraModal,
  });

  return (
    <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`w-full justify-between h-9 text-xs font-medium ${
            showAdvanced
              ? 'bg-muted text-foreground hover:bg-muted rounded-b-none'
              : 'bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary'
          }`}
        >
          <span>Advanced Settings</span>
          <ChevronLeft className={`w-3 h-3 transition-transform ${showAdvanced ? '-rotate-90' : ''}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className={edgeExtendAmount === 6 ? '-mx-6' : '-mx-4'}>
        <div className={`space-y-3 bg-muted/30 border-y border-border/50 ${edgeExtendAmount === 6 ? 'px-6 py-3' : 'px-4 py-3'}`}>
          <PromptFieldsSection
            settings={settings}
            onChange={onChange}
            shotDefaults={shotDefaults}
            hasOverride={hasOverride}
            onSaveFieldAsDefault={onSaveFieldAsDefault}
            handleSaveFieldAsDefault={handleSaveFieldAsDefault}
            savingField={savingField}
          />
          <NegativePromptField
            settings={settings}
            onChange={onChange}
            shotDefaults={shotDefaults}
            hasOverride={hasOverride}
            onSaveFieldAsDefault={onSaveFieldAsDefault}
            handleSaveFieldAsDefault={handleSaveFieldAsDefault}
            savingField={savingField}
          />

          {spec.supportsPhaseConfig && (
            <MotionPresetSection
              builtinPreset={builtinPreset}
              featuredPresetIds={featuredPresetIds}
              generationMode={generationMode}
              settings={settings}
              onChange={onChange}
              shotDefaults={shotDefaults}
              queryKeyPrefix={queryKeyPrefix}
              availableLoras={availableLoras}
              effectiveLoras={effectiveLoras}
              onMotionModeChange={handleMotionModeChange}
              onPhaseConfigChange={handlePhaseConfigChange}
              onPhasePresetSelect={handlePhasePresetSelect}
              onPhasePresetRemove={handlePhasePresetRemove}
              onRandomSeedChange={handleRandomSeedChange}
              onAddLoraClick={handleAddLoraClick}
              onRemoveLora={handleRemoveLora}
              onLoraStrengthChange={handleLoraStrengthChange}
              onSaveFieldAsDefault={onSaveFieldAsDefault}
              handleSaveFieldAsDefault={handleSaveFieldAsDefault}
              savingField={savingField}
              isUsingMotionDefaults={isUsingMotionDefaults}
              isUsingLorasDefault={isUsingLorasDefault}
            />
          )}

          {/* Structure Video Section */}
          <StructureVideoSection
            structureVideoType={structureVideoType}
            structureVideoUrl={structureVideoUrl}
            structureVideoFrameRange={structureVideoFrameRange}
            structureVideoDefaults={structureVideoDefaults}
            settings={settings}
            onChange={onChange}
            shotDefaults={shotDefaults}
            hasOverride={hasOverride}
            isTimelineMode={isTimelineMode}
              onAddSegmentStructureVideo={onAddSegmentStructureVideo}
            onRemoveSegmentStructureVideo={onRemoveSegmentStructureVideo}
            onModelChange={handleModelChange}
            videoUpload={videoUpload}
            isDraggingVideo={isDraggingVideo}
            onDragOver={onDragOver}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onSaveFieldAsDefault={onSaveFieldAsDefault}
            handleSaveFieldAsDefault={handleSaveFieldAsDefault}
            savingField={savingField}
          />
        </div>

        <AdvancedSettingsLoraModal
          isOpen={isLoraModalOpen}
          onClose={closeLoraModal}
          availableLoras={availableLoras}
          effectiveLoras={effectiveLoras}
          onAddLora={handleLoraSelect}
          onRemoveLora={handleRemoveLora}
          onUpdateLoraStrength={handleLoraStrengthChange}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};
