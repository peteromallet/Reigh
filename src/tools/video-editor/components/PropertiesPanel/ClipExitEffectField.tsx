import { AlertTriangle, Globe, Lock, Monitor, Pencil, RefreshCw, Server, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/shared/components/ui/select.tsx';
import { ParameterControls, getDefaultValues } from '@/tools/video-editor/components/ParameterControls.tsx';
import { exitEffectTypes } from '@/tools/video-editor/effects/index.tsx';
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

export function ClipExitEffectField({
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
  const exitEffect = findEffectResourceByType(clip?.exit?.type, effectResources.effects);

  return (
    <div className="space-y-2">
      <FieldLabel>Exit</FieldLabel>
      <Select
        value={clip.exit?.type ?? NO_EFFECT}
        onValueChange={(value) => onChange({
          exit: value === NO_EFFECT
            ? undefined
            : {
                type: value,
                duration: clip.exit?.duration ?? 0.4,
                params: getDefaultEffectParams(value, effectResources.effects),
              },
        })}
      >
        <SelectTrigger><EffectSelectValue type={clip.exit?.type} effects={effectResources.effects} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_EFFECT}>None</SelectItem>
          {exitEffectTypes.map((effect) => <SelectItem key={effect} value={effect}>{effect}</SelectItem>)}
          {(effectResources.exit.length > 0 || (clip.exit?.type?.startsWith('custom:') && !isCustomEffectInList(clip.exit.type, effectResources.exit))) && (
            <>
              <div className="my-1 h-px bg-border" />
              {!isCustomEffectInList(clip.exit?.type, effectResources.exit) && clip.exit?.type && (
                <SelectItem value={clip.exit.type}>
                  <span className="text-muted-foreground">{getEffectDisplayLabel(clip.exit.type, effectResources.effects) ?? clip.exit.type}</span>
                </SelectItem>
              )}
              {effectResources.exit.map((effect) => {
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
      {exitEffect && (() => {
        const blockedExit = getBlockedRoutes(exitEffect);
        const isRO = isReadOnlyEffect(exitEffect);
        const previewOnlyExit = isPreviewOnly(exitEffect);
        return (
          <>
            {(blockedExit.length > 0 || isRO || previewOnlyExit) && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-[11px] text-amber-200">
                {previewOnlyExit && (
                  <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" />Preview only</span>
                )}
                {blockedExit.includes('browser-export') && !previewOnlyExit && (
                  <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />No browser export</span>
                )}
                {blockedExit.includes('worker-export') && !previewOnlyExit && (
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
      {clip.exit && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs text-destructive hover:text-destructive"
            onClick={() => onChange({ exit: undefined })}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
          {hasParameterSchema(exitEffect) && hasCustomParams(exitEffect, clip.exit.params) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={() => onChange({
                exit: {
                  type: clip.exit!.type,
                  duration: clip.exit!.duration ?? 0.4,
                  params: getDefaultValues(exitEffect!.parameterSchema),
                },
              })}
            >
              <RefreshCw className="h-3 w-3" /> Reset defaults
            </Button>
          )}
          {exitEffect && !isReadOnlyEffect(exitEffect) && canEditEffects && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={() => {
                setEditingEffect(exitEffect);
                setCreatorOpen(true);
              }}
            >
              <Pencil className="h-3 w-3" /> Edit
            </Button>
          )}
        </div>
      )}
      {!clip.exit && exitEffect && !isReadOnlyEffect(exitEffect) && canEditEffects && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={() => {
            setEditingEffect(exitEffect);
            setCreatorOpen(true);
          }}
        >
          <Pencil className="h-3 w-3" /> Edit
        </Button>
      )}
      {hasParameterSchema(exitEffect) && (
        <ParameterControls
          schema={exitEffect.parameterSchema}
          values={getMergedEffectParams(exitEffect, clip.exit?.params)}
          onChange={(paramName, value) => onChange({
            exit: {
              type: clip.exit?.type ?? `custom:${exitEffect.id}`,
              duration: clip.exit?.duration ?? 0.4,
              params: {
                ...(clip.exit?.params ?? {}),
                [paramName]: value,
              },
            },
          })}
          disabled={isEffectInError(exitEffect)}
          diagnostics={exitEffect.diagnostics}
        />
      )}
    </div>
  );
}
