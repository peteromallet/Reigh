import { Plus } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { SequenceParamEditor } from '@/tools/video-editor/components/PropertiesPanel/SequenceParamEditor.tsx';
import { isEditorParamsSchema } from '@/tools/video-editor/clip-types/defineClipType.ts';
import type { ClipTypeDescriptor } from '@/tools/video-editor/clip-types/defineClipType.ts';
import { KeyframeInspector } from '@/tools/video-editor/components/KeyframeInspector/KeyframeInspector';
import { EffectCreatorPanel } from '@/tools/video-editor/components/EffectCreatorPanel.tsx';
import type { EffectResource } from '@/tools/video-editor/hooks/useEffectResources.ts';
import type { VideoEditorEffectCatalog } from '@/tools/video-editor/lib/effect-catalog.ts';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';
import type { resolveAvailableClipType } from '@/tools/video-editor/sequences/registry.ts';
import type {
  ResolvedTimelineClip,
  ResolvedTimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import { ClipContinuousEffectField } from './ClipContinuousEffectField.tsx';
import { ClipEntranceEffectField } from './ClipEntranceEffectField.tsx';
import { ClipExitEffectField } from './ClipExitEffectField.tsx';
import { ClipShaderSection } from './ClipShaderSection.tsx';
import { ClipTransitionSection } from './ClipTransitionSection.tsx';

/** Body of the inspector's Effects tab (Sequence tab for sequence clip types). */
export function ClipEffectsTab({
  clip,
  onChange,
  effectResources,
  clipDescriptor,
  clipTypeResolution,
  isEffectLayer,
  isSequenceClip,
  registry,
  timelineFps,
  currentTime,
  creatorOpen,
  setCreatorOpen,
  editingEffect,
  setEditingEffect,
}: {
  clip: ResolvedTimelineClip;
  onChange: (patch: Partial<ClipMeta> & { at?: number }) => void;
  effectResources: VideoEditorEffectCatalog;
  clipDescriptor: ClipTypeDescriptor | undefined;
  clipTypeResolution: ReturnType<typeof resolveAvailableClipType>;
  isEffectLayer: boolean;
  isSequenceClip: boolean;
  registry: ResolvedTimelineConfig['registry'];
  timelineFps?: number;
  currentTime: number;
  creatorOpen: boolean;
  setCreatorOpen: (open: boolean) => void;
  editingEffect: EffectResource | null;
  setEditingEffect: (effect: EffectResource | null) => void;
}) {
  const canCreateEffects = effectResources.canCreateEffect;
  const canEditEffects = effectResources.canUpdateEffect;

  if (!clipDescriptor && clip.clipType) {
    return (
      <div className="rounded-xl border border-dashed border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        {clip.clipType} is not registered in the clip-type registry for this editor build.
      </div>
    );
  }

  if (isSequenceClip && clipTypeResolution.status === 'available') {
    return (
      <SequenceParamEditor
        clipType={clip.clipType}
        params={clip.params}
        registry={registry}
        onChange={(nextParams) => onChange({ params: nextParams })}
      />
    );
  }

  if (isSequenceClip && clipTypeResolution.status === 'unavailable') {
    return (
      <div className="rounded-xl border border-dashed border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
        {clip.clipType} is trusted in the clip-type registry, but its render component is not available in this editor build.
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {!isEffectLayer && (
          <ClipEntranceEffectField
            clip={clip}
            onChange={onChange}
            effectResources={effectResources}
            canEditEffects={canEditEffects}
            setEditingEffect={setEditingEffect}
            setCreatorOpen={setCreatorOpen}
          />
        )}
        {!isEffectLayer && (
          <ClipExitEffectField
            clip={clip}
            onChange={onChange}
            effectResources={effectResources}
            canEditEffects={canEditEffects}
            setEditingEffect={setEditingEffect}
            setCreatorOpen={setCreatorOpen}
          />
        )}
        <ClipContinuousEffectField
          clip={clip}
          onChange={onChange}
          effectResources={effectResources}
          canEditEffects={canEditEffects}
          setEditingEffect={setEditingEffect}
          setCreatorOpen={setCreatorOpen}
        />
        <ClipShaderSection clip={clip} onChange={onChange} />
        <ClipTransitionSection clip={clip} onChange={onChange} />
      </div>
      {isEffectLayer && !clip.continuous && (
        <div className="rounded-lg border border-dashed border-violet-400/40 bg-violet-500/10 p-3 text-sm text-violet-100">
          Select a continuous effect to turn this layer into an active adjustment clip.
        </div>
      )}
      {canCreateEffects && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1.5"
          onClick={() => {
            setEditingEffect(null);
            setCreatorOpen(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Create Effect
        </Button>
      )}
      <EffectCreatorPanel
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        editingEffect={editingEffect}
        previewAssetSrc={clip?.assetEntry?.src}
        timelineFps={timelineFps}
        onSaved={(resourceId, savedCategory, defaultParams) => {
          const effectType = `custom:${resourceId}`;
          const params = Object.keys(defaultParams).length > 0 ? defaultParams : undefined;
          if (isEffectLayer) {
            if (savedCategory !== 'continuous') {
              return;
            }
            onChange({ continuous: { type: effectType, intensity: clip.continuous?.intensity ?? 0.5, params } });
            return;
          }
          if (!isEffectLayer && savedCategory === 'entrance') {
            onChange({ entrance: { type: effectType, duration: clip.entrance?.duration ?? 0.4, params } });
          } else if (!isEffectLayer && savedCategory === 'exit') {
            onChange({ exit: { type: effectType, duration: clip.exit?.duration ?? 0.4, params } });
          } else {
            onChange({ continuous: { type: effectType, intensity: clip.continuous?.intensity ?? 0.5, params } });
          }
        }}
      />
      {/* M9: Keyframe Inspector — shown when clip type has editor params schema */}
      {clipDescriptor && isEditorParamsSchema(clipDescriptor.paramsSchema) && (
        <KeyframeInspector
          schema={clipDescriptor.paramsSchema.params}
          keyframes={clip.keyframes ?? {}}
          currentTime={currentTime}
          onChange={(updatedKeyframes) => onChange({ keyframes: updatedKeyframes })}
        />
      )}
    </>
  );
}
