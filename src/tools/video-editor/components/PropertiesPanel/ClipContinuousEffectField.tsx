import { AlertTriangle, Globe, Lock, Monitor, Pencil, RefreshCw, Server, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/shared/components/ui/select.tsx';
import { ParameterControls, getDefaultValues } from '@/tools/video-editor/components/ParameterControls.tsx';
import { continuousEffectTypes } from '@/tools/video-editor/effects/index.tsx';
import type { EffectResource } from '@/tools/video-editor/hooks/useEffectResources.ts';
import type { VideoEditorEffectCatalog } from '@/tools/video-editor/lib/effect-catalog.ts';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';
import type { ResolvedTimelineClip } from '@/tools/video-editor/types/index.ts';
import { FieldLabel, NO_EFFECT } from './clip-panel-primitives.tsx';
import {
  AudioReactiveIcon,
  EffectSelectValue,
  findEffectResourceByType,
  getBlockedRoutes,
  getDefaultEffectParams,
  getEffectDisplayLabel,
  getMergedEffectParams,
  getProvenanceLabel,
  hasCustomParams,
  hasParameterSchema,
  isAudioReactiveEffect,
  isCustomEffectInList,
  isEffectInError,
  isPreviewOnly,
  isReadOnlyEffect,
} from './clip-effect-helpers.tsx';

export function ClipContinuousEffectField({
  clip,
  onChange,
  effectResources,
  canEditEffects,
  setEditingEffect,
  setCreatorOpen,
}: {
  clip: ResolvedTimelineClip;
  onChange: (patch: Partial<ClipMeta> & { at?: number }) => void;
  effectResources: VideoEditorEffectCatalog;
  canEditEffects: boolean;
  setEditingEffect: (effect: EffectResource | null) => void;
  setCreatorOpen: (open: boolean) => void;
}) {
  const continuousEffect = findEffectResourceByType(clip?.continuous?.type, effectResources.effects);

  return (
    <div className="space-y-2 md:col-span-2">
      <FieldLabel>Continuous</FieldLabel>
      <Select
        value={clip.continuous?.type ?? NO_EFFECT}
        onValueChange={(value) => onChange({
          continuous: value === NO_EFFECT
            ? undefined
            : {
                type: value,
                intensity: clip.continuous?.intensity ?? 0.5,
                params: getDefaultEffectParams(value, effectResources.effects),
              },
        })}
      >
        <SelectTrigger><EffectSelectValue type={clip.continuous?.type} effects={effectResources.effects} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_EFFECT}>None</SelectItem>
          {continuousEffectTypes.map((effect) => <SelectItem key={effect} value={effect}>{effect}</SelectItem>)}
          {(effectResources.continuous.length > 0 || (clip.continuous?.type?.startsWith('custom:') && !isCustomEffectInList(clip.continuous.type, effectResources.continuous))) && (
            <>
              <div className="my-1 h-px bg-border" />
              {!isCustomEffectInList(clip.continuous?.type, effectResources.continuous) && clip.continuous?.type && (
                <SelectItem value={clip.continuous.type}>
                  <span className="text-muted-foreground">{getEffectDisplayLabel(clip.continuous.type, effectResources.effects) ?? clip.continuous.type}</span>
                </SelectItem>
              )}
              {effectResources.continuous.map((effect) => {
                const error = isEffectInError(effect);
                const provenanceLabel = getProvenanceLabel(effect);
                const readOnly = isReadOnlyEffect(effect);
                const blocked = getBlockedRoutes(effect);
                return (
                  <SelectItem
                    key={`custom:${effect.id}`}
                    value={`custom:${effect.id}`}
                    disabled={error}
                  >
                    <span className="flex items-center gap-1.5">
                      {error && <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" />}
                      {isAudioReactiveEffect(effect) && <AudioReactiveIcon />}
                      {readOnly && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      {effect.name}
                      {provenanceLabel && (
                        <span className="ml-0.5 rounded-sm bg-blue-500/15 px-1 text-[9px] font-medium text-blue-300">
                          {provenanceLabel}
                        </span>
                      )}
                      {blocked.length > 0 && (
                        <span className="ml-0.5 rounded-sm bg-amber-500/15 px-1 text-[9px] font-medium text-amber-300">
                          {blocked.map((r) => r === 'browser-export' ? 'No B' : r === 'worker-export' ? 'No W' : r).join(', ')}
                        </span>
                      )}
                      {error && <span className="ml-1 text-[10px] text-destructive">(invalid schema)</span>}
                    </span>
                  </SelectItem>
                );
              })}
            </>
          )}
        </SelectContent>
      </Select>
      {continuousEffect && (() => {
        const blockedContinuous = getBlockedRoutes(continuousEffect);
        const isRO = isReadOnlyEffect(continuousEffect);
        const previewOnlyContinuous = isPreviewOnly(continuousEffect);
        return (
          <>
            {(blockedContinuous.length > 0 || isRO || previewOnlyContinuous) && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-[11px] text-amber-200">
                {previewOnlyContinuous && (
                  <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" />Preview only</span>
                )}
                {blockedContinuous.includes('browser-export') && !previewOnlyContinuous && (
                  <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />No browser export</span>
                )}
                {blockedContinuous.includes('worker-export') && !previewOnlyContinuous && (
                  <span className="inline-flex items-center gap-1"><Server className="h-3 w-3" />No worker export</span>
                )}
                {isRO && (
                  <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" />Read-only</span>
                )}
              </div>
            )}
          </>
        );
      })()}
      {clip.continuous && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs text-destructive hover:text-destructive"
            onClick={() => onChange({ continuous: undefined })}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
          {hasParameterSchema(continuousEffect) && hasCustomParams(continuousEffect, clip.continuous.params) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={() => onChange({
                continuous: {
                  type: clip.continuous!.type,
                  intensity: clip.continuous!.intensity ?? 0.5,
                  params: getDefaultValues(continuousEffect!.parameterSchema),
                },
              })}
            >
              <RefreshCw className="h-3 w-3" /> Reset defaults
            </Button>
          )}
          {continuousEffect && !isReadOnlyEffect(continuousEffect) && canEditEffects && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={() => {
                setEditingEffect(continuousEffect);
                setCreatorOpen(true);
              }}
            >
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
        </div>
      )}
      {!clip.continuous && continuousEffect && !isReadOnlyEffect(continuousEffect) && canEditEffects && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={() => {
            setEditingEffect(continuousEffect);
            setCreatorOpen(true);
          }}
        >
          <Pencil className="h-3 w-3" /> Edit
        </Button>
      )}
      {hasParameterSchema(continuousEffect) && (
        <ParameterControls
          schema={continuousEffect.parameterSchema}
          values={getMergedEffectParams(continuousEffect, clip.continuous?.params)}
          onChange={(paramName, value) => onChange({
            continuous: {
              type: clip.continuous?.type ?? `custom:${continuousEffect.id}`,
              intensity: clip.continuous?.intensity ?? 0.5,
              params: {
                ...(clip.continuous?.params ?? {}),
                [paramName]: value,
              },
            },
          })}
          disabled={isEffectInError(continuousEffect)}
          diagnostics={continuousEffect.diagnostics}
        />
      )}
    </div>
  );
}
