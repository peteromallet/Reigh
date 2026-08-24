import { useMemo, useState } from 'react';
import { RefreshCw, Trash2, Volume2, X } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import { cn } from '@/shared/components/ui/contracts/cn.ts';
import { Input } from '@/shared/components/ui/input.tsx';
import { MediaVariantPicker } from '@/shared/components/MediaVariantPicker.tsx';
import type { GenerationVariant } from '@/shared/hooks/variants/useVariants.ts';
import { NumberInput } from '@/shared/components/ui/number-input.tsx';
import { Slider } from '@/shared/components/ui/slider.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs.tsx';
import { Textarea } from '@/shared/components/ui/textarea.tsx';
import {
  getRegisteredClipTypeDescriptor,
  getClipTypeOverlayBehavior,
  getDefaultBoxForClipType,
  isClipTypeCommandAvailable,
} from '@/tools/video-editor/clip-types/index.ts';
import { isSequenceParamsSchema } from '@/tools/video-editor/clip-types/defineClipType.ts';
import { useEffectResources, type EffectResource } from '@/tools/video-editor/hooks/useEffectResources.ts';
import type { ClipTab } from '@/tools/video-editor/hooks/useEditorPreferences.ts';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';
import { getVisibleClipTabs } from '@/tools/video-editor/lib/clip-inspector.ts';
import type { TimelineDeviceClass, TimelineInteractionMode } from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import { resolveAvailableClipType } from '@/tools/video-editor/sequences/registry.ts';
import type {
  ResolvedTimelineClip,
  ResolvedTimelineConfig,
  TrackDefinition,
} from '@/tools/video-editor/types/index.ts';
import { useOptionalClipTypeRegistryContext } from '@/tools/video-editor/clip-types/ClipTypeRegistryContext.tsx';
import type { ClipTypeRegistryRecord } from '@/tools/video-editor/clip-types/ClipTypeRegistry.ts';
import { FieldLabel, TAB_COLUMNS_CLASS } from './clip-panel-primitives.tsx';
import { getEffectDisplayLabel } from './clip-effect-helpers.tsx';
import { ClipEffectsTab } from './ClipEffectsTab.tsx';
import { ClipExtensionInspectorSection } from './ClipExtensionInspectorSection.tsx';
import { ClipInspectorActions } from './ClipInspectorActions.tsx';

export { getVisibleClipTabs } from '@/tools/video-editor/lib/clip-inspector.ts';
export { FieldLabel, NO_EFFECT, NO_TRANSITION, TAB_COLUMNS_CLASS } from './clip-panel-primitives.tsx';

interface ClipPanelProps {
  clip: ResolvedTimelineClip | null;
  track: TrackDefinition | null;
  deviceClass: TimelineDeviceClass;
  interactionMode: TimelineInteractionMode;
  precisionEnabled: boolean;
  hasPredecessor: boolean;
  onChange: (patch: Partial<ClipMeta> & { at?: number }) => void;
  onResetPosition: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onToggleMute: () => void;
  onDetachAudio?: () => void;
  onSplitAtPlayhead: () => void;
  onMoveTrackUp: () => void;
  onMoveTrackDown: () => void;
  onSetInteractionMode: (mode: 'move' | 'trim') => void;
  onSetPrecisionEnabled: (enabled: boolean) => void;
  compositionWidth: number;
  compositionHeight: number;
  registry: ResolvedTimelineConfig['registry'];
  activeTab: ClipTab;
  setActiveTab: (tab: ClipTab) => void;
  isVariantStale?: boolean;
  onUpdateVariant?: () => void;
  onDismissStale?: () => void;
  onApplyVariant?: (variant: GenerationVariant) => void | Promise<void>;
  onAddVariantAsGeneration?: (variant: GenerationVariant) => void | Promise<void>;
  isAddingVariantAsGeneration?: (variantId: string) => boolean;
  timelineFps?: number;
  /** Current playhead time in seconds, used by KeyframeInspector. */
  currentTime?: number;
}

export function ClipPanel({
  clip,
  track,
  deviceClass,
  interactionMode,
  precisionEnabled,
  hasPredecessor,
  onChange,
  onResetPosition,
  onClose,
  onDelete,
  onToggleMute,
  onDetachAudio,
  onSplitAtPlayhead,
  onMoveTrackUp,
  onMoveTrackDown,
  onSetInteractionMode,
  onSetPrecisionEnabled,
  compositionWidth,
  compositionHeight,
  registry,
  activeTab,
  setActiveTab,
  isVariantStale,
  onUpdateVariant,
  onDismissStale,
  onApplyVariant,
  onAddVariantAsGeneration,
  isAddingVariantAsGeneration,
  timelineFps,
  currentTime = 0,
}: ClipPanelProps) {
  const effectResources = useEffectResources();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [editingEffect, setEditingEffect] = useState<EffectResource | null>(null);
  const visibleTabs = useMemo(() => getVisibleClipTabs(clip, track), [clip, track]);
  const clipDescriptor = clip
    ? getRegisteredClipTypeDescriptor(clip.clipType)
    : undefined;
  const holdTiming = clipDescriptor?.hold;
  const clipTypeResolution = resolveAvailableClipType(clip?.clipType);
  const isEffectLayer = clipDescriptor?.renderCapabilities.previewRoute === 'effect-layer';
  const isSequenceClip = Boolean(clipDescriptor && isSequenceParamsSchema(clipDescriptor.paramsSchema));
  const overlayBehavior = getClipTypeOverlayBehavior(clipDescriptor);
  const supportsInlineTextEdit = overlayBehavior.supportsInlineTextEdit;
  // Position fallbacks come from the clip-type descriptor — the same canonical
  // box the renderer draws and the gizmo shows for a position-less clip. The
  // panel used to invent its own (0,0,compW,compH) fallback and disagreed with
  // both other surfaces for text clips.
  const defaultBox = getDefaultBoxForClipType(clip?.clipType, compositionWidth, compositionHeight);
  const commandContext = useMemo(() => (
    clip
      ? { clip, track, selectedClipIds: [clip.id] }
      : { clip, track, selectedClipIds: [] }
  ), [clip, track]);
  const canSplit = Boolean(
    clipDescriptor && isClipTypeCommandAvailable(clipDescriptor, 'split', commandContext),
  );
  const canMoveTrack = Boolean(
    clipDescriptor && isClipTypeCommandAvailable(clipDescriptor, 'move-track-up', commandContext),
  );
  const canToggleMute = Boolean(
    clipDescriptor && isClipTypeCommandAvailable(clipDescriptor, 'toggle-mute', commandContext),
  );
  const canDetachAudio = Boolean(
    clipDescriptor && isClipTypeCommandAvailable(clipDescriptor, 'detach-audio', commandContext),
  );
  const showInspectorActions = deviceClass !== 'desktop';

  // M9 T9: Extension-provided clip inspector section
  const clipTypeRegistryContext = useOptionalClipTypeRegistryContext();
  const clipTypeRegistryRecord: ClipTypeRegistryRecord | undefined = useMemo(() => {
    if (!clip?.clipType || !clipTypeRegistryContext) return undefined;
    return clipTypeRegistryContext.snapshot.get(clip.clipType);
  }, [clip?.clipType, clipTypeRegistryContext]);

  if (!clip) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Select a clip to edit timing, position, audio, text, or effects.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card/70 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {isEffectLayer
              ? (getEffectDisplayLabel(clip.continuous?.type, effectResources.effects) ?? 'Effect Layer')
              : isSequenceClip
                ? (clipDescriptor?.label ?? clip.clipType ?? clip.id)
                : supportsInlineTextEdit
                  ? (clip.text?.content || clipDescriptor?.label || clip.id)
                  : (clip.asset || clipDescriptor?.label || clip.id)}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {clip.clipType ?? 'media'} · {track?.label ?? clip.track}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {clip.assetEntry?.generationId && (
            <MediaVariantPicker
              generationId={clip.assetEntry.generationId}
              currentVariantId={clip.assetEntry.variantId ?? null}
              onVariantApplied={onApplyVariant}
              onAddVariantAsGeneration={onAddVariantAsGeneration}
              isAddingVariantAsGeneration={isAddingVariantAsGeneration}
              inline
              defaultMediaKind={clip.assetEntry.type?.startsWith('video') ? 'video' : 'image'}
            />
          )}
          {onDelete && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            ×
          </Button>
        </div>
      </div>

      {isVariantStale && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">Variant outdated</span>
          {onUpdateVariant && (
            <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-amber-200 hover:bg-amber-500/20 hover:text-amber-100" onClick={onUpdateVariant}>
              Update
            </Button>
          )}
          {onDismissStale && (
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-amber-200/60 hover:bg-amber-500/20 hover:text-amber-100" onClick={onDismissStale}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {showInspectorActions && (
        <ClipInspectorActions
          interactionMode={interactionMode}
          precisionEnabled={precisionEnabled}
          canMoveTrack={canMoveTrack}
          canSplit={canSplit}
          canToggleMute={canToggleMute}
          setActiveTab={setActiveTab}
          onSetInteractionMode={onSetInteractionMode}
          onSetPrecisionEnabled={onSetPrecisionEnabled}
          onMoveTrackUp={onMoveTrackUp}
          onMoveTrackDown={onMoveTrackDown}
          onSplitAtPlayhead={onSplitAtPlayhead}
          onToggleMute={onToggleMute}
          onDelete={onDelete}
        />
      )}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ClipTab)}>
        <TabsList className={cn('grid w-full bg-muted/60', TAB_COLUMNS_CLASS[visibleTabs.length as keyof typeof TAB_COLUMNS_CLASS] ?? 'grid-cols-4')}>
          {visibleTabs.includes('effects') && <TabsTrigger value="effects">{isSequenceClip ? 'Sequence' : 'Effects'}</TabsTrigger>}
          {visibleTabs.includes('timing') && <TabsTrigger value="timing">Timing</TabsTrigger>}
          {visibleTabs.includes('position') && <TabsTrigger value="position">Position</TabsTrigger>}
          {visibleTabs.includes('audio') && <TabsTrigger value="audio">Audio</TabsTrigger>}
          {visibleTabs.includes('text') && <TabsTrigger value="text">Text</TabsTrigger>}
        </TabsList>

        {visibleTabs.includes('effects') && (
          <TabsContent value="effects" className="space-y-3">
            <ClipEffectsTab
              clip={clip}
              onChange={onChange}
              effectResources={effectResources}
              clipDescriptor={clipDescriptor}
              clipTypeResolution={clipTypeResolution}
              isEffectLayer={isEffectLayer}
              isSequenceClip={isSequenceClip}
              registry={registry}
              timelineFps={timelineFps}
              currentTime={currentTime}
              creatorOpen={creatorOpen}
              setCreatorOpen={setCreatorOpen}
              editingEffect={editingEffect}
              setEditingEffect={setEditingEffect}
            />
          </TabsContent>
        )}

        {visibleTabs.includes('timing') && (
          <TabsContent value="timing" className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel>Start (seconds)</FieldLabel>
                <NumberInput value={clip.at} step={0.1} onChange={(value) => { if (value !== null) onChange({ at: value }); }} />
              </div>
              {holdTiming && holdTiming.kind !== 'unsupported' ? (
                <div className="space-y-2">
                  <FieldLabel>Duration (seconds)</FieldLabel>
                  <NumberInput
                    value={clip.hold ?? holdTiming.defaultSeconds}
                    min={holdTiming.minSeconds}
                    max={holdTiming.maxSeconds}
                    step={holdTiming.stepSeconds}
                    onChange={(value) => { if (value !== null) onChange({ hold: value }); }}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <FieldLabel>Speed</FieldLabel>
                    <NumberInput value={clip.speed ?? 1} min={0.1} step={0.1} onChange={(value) => { if (value !== null) onChange({ speed: value }); }} />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Source In</FieldLabel>
                    <NumberInput value={clip.from ?? 0} min={0} step={0.1} onChange={(value) => { if (value !== null) onChange({ from: value }); }} />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Source Out</FieldLabel>
                    <NumberInput value={clip.to ?? clip.assetEntry?.duration ?? 5} min={0} step={0.1} onChange={(value) => { if (value !== null) onChange({ to: value }); }} />
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        )}

        {visibleTabs.includes('position') && (
          <TabsContent value="position" className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel>X</FieldLabel>
                <NumberInput value={clip.x ?? defaultBox.x} onChange={(value) => { if (value !== null) onChange({ x: value }); }} />
              </div>
              <div className="space-y-2">
                <FieldLabel>Y</FieldLabel>
                <NumberInput value={clip.y ?? defaultBox.y} onChange={(value) => { if (value !== null) onChange({ y: value }); }} />
              </div>
              <div className="space-y-2">
                <FieldLabel>Width</FieldLabel>
                <NumberInput value={clip.width ?? defaultBox.width} min={0} max={compositionWidth} onChange={(value) => { if (value !== null) onChange({ width: value }); }} />
              </div>
              <div className="space-y-2">
                <FieldLabel>Height</FieldLabel>
                <NumberInput value={clip.height ?? defaultBox.height} min={0} max={compositionHeight} onChange={(value) => { if (value !== null) onChange({ height: value }); }} />
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel>Opacity</FieldLabel>
              <Slider
                value={[clip.opacity ?? 1]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(value) => onChange({ opacity: value })}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onResetPosition}>
              Reset position
            </Button>
          </TabsContent>
        )}

        {visibleTabs.includes('audio') && (
          <TabsContent value="audio" className="space-y-3">
            <div className="rounded-lg border border-border bg-card/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm text-foreground">
                <Volume2 className="h-4 w-4" />
                Volume
              </div>
              <Slider
                value={[clip.volume ?? 1]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(value) => onChange({ volume: value })}
              />
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onToggleMute} disabled={!canToggleMute}>
                Toggle mute
              </Button>
              {canDetachAudio && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onDetachAudio}
                  disabled={!onDetachAudio}
                >
                  Detach audio
                </Button>
              )}
            </div>
          </TabsContent>
        )}

        {visibleTabs.includes('text') && (
          <TabsContent value="text" className="space-y-3">
            {supportsInlineTextEdit ? (
              <>
                <Textarea
                  value={clip.text?.content ?? ''}
                  onChange={(event) => onChange({ text: { ...(clip.text ?? { content: '' }), content: event.target.value } })}
                  rows={5}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel>Font size</FieldLabel>
                    <NumberInput
                      value={clip.text?.fontSize ?? 64}
                      min={1}
                      step={1}
                      onChange={(value) => {
                        if (value !== null) {
                          onChange({ text: { ...(clip.text ?? { content: '' }), fontSize: value } });
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel>Color</FieldLabel>
                    <Input
                      type="color"
                      value={clip.text?.color ?? '#ffffff'}
                      onChange={(event) => onChange({ text: { ...(clip.text ?? { content: '' }), color: event.target.value } })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                The selected clip is not a text clip.
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* M9 T9: Extension-provided clip inspector section after host controls */}
      {clipTypeRegistryRecord?.inspector && (
        <ClipExtensionInspectorSection
          clip={clip}
          onChange={onChange}
          clipTypeRegistryRecord={clipTypeRegistryRecord}
        />
      )}
    </div>
  );
}
