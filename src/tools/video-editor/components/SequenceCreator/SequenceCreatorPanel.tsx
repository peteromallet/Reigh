import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog.tsx';
import { NumberInput } from '@/shared/components/ui/number-input.tsx';
import { Textarea } from '@/shared/components/ui/textarea.tsx';
import { toast } from '@/shared/components/ui/toast.tsx';
import { RemotionPreview } from '@/tools/video-editor/components/PreviewPanel/RemotionPreview.tsx';
import { SequenceParamEditor } from '@/tools/video-editor/components/PropertiesPanel/SequenceParamEditor.tsx';
import { useSelectedMediaClips } from '@/tools/video-editor/hooks/useSelectedMediaClips.ts';
import {
  useTimelineEditorData,
  useTimelineEditorOps,
  useTimelinePlaybackSelector,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  buildInsertSequenceDraftEdit,
  buildReplaceSequenceDraftEdit,
  type SequenceDraftEditError,
} from '@/tools/video-editor/lib/sequence-drafts.ts';
import { requestCenterTimelineClip } from '@/tools/video-editor/lib/timeline-viewport-events.ts';
import { useCurrentAttachmentSet } from '@/shared/state/currentAttachmentSet.ts';
import { composerRemoveAttachment } from '@/shared/state/selectionStore.ts';
import { AgentChatAttachmentStrip } from '@/tools/video-editor/components/AgentChat/AgentChatMessage.tsx';
import {
  attachSequenceGenerationMetadata,
  buildAllowedAssetRegistry,
  buildAllowedSequenceAssets,
  buildSequenceGenerationMetadata,
  createDraftGroupId,
  nameDraftGroupFromPrompt,
  type AllowedSequenceAsset,
  type EditableSequenceDraft,
  type SequenceCreatorMode,
  type SequenceDraftGroup,
} from '@/tools/video-editor/sequences/generation.ts';
import { useSequenceCreatorStore } from '@/tools/video-editor/state/sequenceCreatorStore.ts';
import { materializeResolvedSequenceConfig } from '@/tools/video-editor/sequences/materialize.ts';
import {
  AVAILABLE_SEQUENCE_CLIP_TYPES,
  AVAILABLE_SEQUENCE_METADATA,
  getAvailableClipTypeDescriptor,
  getAvailableSequenceMetadata,
} from '@/tools/video-editor/sequences/registry.ts';
import {
  validateSequenceDraft,
  type ValidatedSequenceDraft,
} from '@/tools/video-editor/sequences/validation.ts';
import { sequenceComponentMetadataToElementManifest } from '@/tools/video-editor/sequence.ts';
import type {
  ResolvedTimelineClip,
  ResolvedTimelineConfig,
} from '@/tools/video-editor/types/index.ts';
import type { SequenceComponentMetadata } from '@/features/resources/hooks/useResources.ts';
import {
  runSequenceComponentGenerationRequest,
  runSequenceGenerationRequest,
} from './sequenceGenerationService.ts';
import { getBundledComponentSource } from '@/tools/video-editor/sequences/getBundledComponentSource.ts';
import { getClipCapabilityDescriptor } from '@/tools/video-editor/sequences/registry.ts';
import { smokeRenderSequenceComponent } from '@/tools/video-editor/sequences/headlessRender.ts';
import {
  useCreateSequenceComponentResource,
  useSequenceResources,
  type SequenceComponentResource,
} from '@/tools/video-editor/hooks/useSequenceResources.ts';
import { useAuth } from '@/shared/contexts/AuthContext.tsx';
import { createGenerationForUploadedImage, createGenerationForUploadedVideo } from '@/shared/lib/media/createGenerationFromFile.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext.tsx';
import { CodePathPreview } from './CodePathPreview.tsx';
import { AssetSlotPicker } from './AssetSlotPicker.tsx';
import { CodePathParamEditor } from './CodePathParamEditor.tsx';
import { ControlsManifestLayout } from './ControlsManifestLayout.tsx';
import { validateControlsManifest } from '@/tools/video-editor/sequences/controlsManifest.ts';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  ASSET_SLOTS_PARAM,
  materializeAssetSlots,
  normalizeAssetSlotBindings,
  normalizeAssetSlots,
  validateAssetSlotBindings,
  type AssetSlotBindings,
  type AssetSlotDefinition,
  type AssetSlotAssetRegistry,
} from '@/tools/video-editor/sequences/assetSlots.ts';
import type { GeneratedComponent } from '@/tools/video-editor/state/sequenceCreatorStore.ts';

type SequenceCreatorPanelProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const sequenceCreatorLog = (message: string, metadata?: Record<string, unknown>): void => {
  console.info('[SequenceCreator:Panel]', message, metadata ?? {});
};

const sequenceCreatorWarn = (message: string, metadata?: Record<string, unknown>): void => {
  console.error('[SequenceCreator:Panel]', message, metadata ?? {});
};

const TEMP_SEQUENCE_PREVIEW_CLIP_ID = '__sequence_preview__';

const formatEditError = (error: SequenceDraftEditError): string => {
  switch (error) {
    case 'no_visual_track':
      return 'Add or select a visual track before inserting a sequence.';
    case 'replace_target_missing':
      return 'Select a visual clip to replace.';
    case 'replace_target_not_visual':
      return 'Sequences can only replace visual clips. Audio clips are not valid replace targets.';
    default:
      return 'This sequence cannot be inserted here.';
  }
};

const validateEditableSequenceDraft = (
  draft: EditableSequenceDraft,
  allowedAssetKeys: readonly string[],
) => validateSequenceDraft(draft, {
  metadata: AVAILABLE_SEQUENCE_METADATA,
  allowedClipTypes: AVAILABLE_SEQUENCE_CLIP_TYPES,
  allowedAssetKeys,
});

export const buildSequencePreviewConfig = (
  resolvedConfig: ResolvedTimelineConfig,
  draft: ValidatedSequenceDraft,
): ResolvedTimelineConfig | null => {
  const sourceTrack = resolvedConfig.tracks.find((track) => track.kind === 'visual');
  const trackId = sourceTrack?.id ?? 'sequence-preview-visual';

  const clip: ResolvedTimelineClip = {
    id: TEMP_SEQUENCE_PREVIEW_CLIP_ID,
    clipType: draft.clipType,
    track: trackId,
    at: 0,
    hold: draft.hold,
    params: { ...draft.params },
  };

  return materializeResolvedSequenceConfig({
    ...resolvedConfig,
    tracks: [
      sourceTrack
        ? { ...sourceTrack, id: trackId }
        : { id: trackId, kind: 'visual', label: 'Sequence preview' },
    ],
    clips: [clip],
  });
};

const summarizeValidationErrors = (errors: readonly { message: string }[]): string => (
  errors.map((error) => error.message).join(' ')
);

const normalizeLibraryAssetSlots = (resource: SequenceComponentResource) => {
  const result = normalizeAssetSlots(resource.assetSlots ?? []);
  if (result.errors.length > 0) {
    sequenceCreatorWarn('library:asset_slots_invalid', {
      resourceId: resource.id,
      clipType: resource.clipType,
      errors: result.errors.map((error) => error.message),
    });
  }
  return result.slots;
};

const buildPanelAssetSlotRegistry = (
  assets: readonly AllowedSequenceAsset[],
): AssetSlotAssetRegistry => Object.fromEntries(assets.map((asset) => [asset.key, {
  key: asset.key,
  url: asset.url,
  mediaType: asset.mediaType,
  type: asset.mediaType,
}]));

const getGeneratedComponentAssetSlots = (
  component: Pick<GeneratedComponent, 'assetSlots'> | null | undefined,
): AssetSlotDefinition[] => (
  Array.isArray(component?.assetSlots) ? component.assetSlots : []
);

const allowedAssetSourceRank: Record<AllowedSequenceAsset['source'], number> = {
  selected: 0,
  attached: 1,
  uploaded: 2,
};

const isAssetValidForSlot = (
  asset: AllowedSequenceAsset | undefined,
  slot: AssetSlotDefinition,
): boolean => Boolean(asset?.url) && asset?.mediaType === slot.mediaType;

const defaultBindingsForAvailableAssets = (
  slots: readonly AssetSlotDefinition[],
  existingBindings: unknown,
  assets: readonly AllowedSequenceAsset[],
): AssetSlotBindings => {
  const normalized = normalizeAssetSlotBindings(existingBindings).bindings;
  const assetsByKey = new Map(assets.map((asset) => [asset.key, asset]));
  const nextBindings: AssetSlotBindings = {};
  let changed = false;

  for (const slot of slots) {
    const existingKeys = normalized[slot.id] ?? [];
    const validExistingKeys = existingKeys.filter((key) => isAssetValidForSlot(assetsByKey.get(key), slot));
    const needsRebind = existingKeys.length > 0
      ? validExistingKeys.length !== existingKeys.length || validExistingKeys.length > slot.maxItems
      : slot.required || slot.minItems > 0;

    if (!needsRebind) {
      if (validExistingKeys.length > 0) {
        nextBindings[slot.id] = validExistingKeys;
      }
      continue;
    }

    const candidates = assets
      .filter((asset) => isAssetValidForSlot(asset, slot))
      .sort((a, b) => (
        allowedAssetSourceRank[a.source] - allowedAssetSourceRank[b.source]
        || a.label.localeCompare(b.label)
      ));
    const desiredCount = existingKeys.length > 0
      ? Math.min(slot.maxItems, Math.max(slot.minItems, existingKeys.length))
      : slot.minItems;
    const replacementKeys = candidates.slice(0, desiredCount).map((asset) => asset.key);
    if (replacementKeys.length > 0) {
      nextBindings[slot.id] = replacementKeys;
    }
    changed = changed
      || replacementKeys.length !== existingKeys.length
      || replacementKeys.some((key, index) => key !== existingKeys[index]);
  }

  for (const slotId of Object.keys(normalized)) {
    if (!slots.some((slot) => slot.id === slotId)) {
      changed = true;
    }
  }

  return changed ? nextBindings : normalized;
};

const applyAvailableAssetSlotDefaults = (
  defaultsJson: object,
  slots: readonly AssetSlotDefinition[],
  assets: readonly AllowedSequenceAsset[],
): object => {
  if (slots.length === 0) return defaultsJson;
  const defaults = (defaultsJson ?? {}) as Record<string, unknown>;
  const nextBindings = defaultBindingsForAvailableAssets(
    slots,
    defaults[ASSET_SLOT_BINDINGS_PARAM],
    assets,
  );
  return {
    ...defaults,
    [ASSET_SLOT_BINDINGS_PARAM]: nextBindings,
  };
};

const materializeGeneratedComponentDefaults = (
  component: GeneratedComponent,
  assets: readonly AllowedSequenceAsset[],
): { ok: true; defaultsJson: Record<string, unknown> } | { ok: false; error: string } => {
  const baseDefaults = (component.defaultsJson ?? {}) as Record<string, unknown>;
  const assetSlots = getGeneratedComponentAssetSlots(component);
  if (assetSlots.length === 0) {
    return { ok: true, defaultsJson: baseDefaults };
  }

  const result = materializeAssetSlots({
    slots: assetSlots,
    bindings: baseDefaults[ASSET_SLOT_BINDINGS_PARAM],
    registry: buildPanelAssetSlotRegistry(assets),
    path: `defaultsJson.${ASSET_SLOT_BINDINGS_PARAM}`,
  });
  if (result.errors.length > 0) {
    return {
      ok: false,
      error: result.errors.map((error) => error.message).join(' '),
    };
  }

  return {
    ok: true,
    defaultsJson: {
      ...baseDefaults,
      [ASSET_SLOTS_PARAM]: result.assetSlots,
    },
  };
};

export function SequenceCreatorPanel({
  open = true,
  onOpenChange,
}: SequenceCreatorPanelProps) {
  const selectedMedia = useSelectedMediaClips();
  const attachmentSet = useCurrentAttachmentSet();
  const { data, resolvedConfig, selectedClipId, selectedClipIds, selectedTrackId } = useTimelineEditorData();
  const { applyEdit, registerGenerationAsset } = useTimelineEditorOps();
  const runtime = useVideoEditorRuntime();
  const currentTime = useTimelinePlaybackSelector((playback) => playback.currentTime);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Lifted into useSequenceCreatorStore so closing/reopening the panel —
  // and full reloads — preserve in-progress state. See the store file's
  // header for what's persisted vs transient.
  //
  // generationMode routing override:
  //   'auto'  → run the JSON edge function with classifier preamble; if the
  //              classifier says path=code, dispatch the code-path follow-up
  //              (current behavior, default).
  //   'code'  → skip the classifier entirely and call the code-path
  //              edge function directly (Custom animation).
  //   'json'  → call the JSON edge function and ignore any classifier
  //              verdict, force-treat the response as JSON drafts (Basic).
  const mode = useSequenceCreatorStore((s) => s.mode);
  const setMode = useSequenceCreatorStore((s) => s.setMode);
  const generationMode = useSequenceCreatorStore((s) => s.generationMode);
  const setGenerationMode = useSequenceCreatorStore((s) => s.setGenerationMode);
  const prompt = useSequenceCreatorStore((s) => s.prompt);
  const setPrompt = useSequenceCreatorStore((s) => s.setPrompt);
  const editPrompt = useSequenceCreatorStore((s) => s.editPrompt);
  const setEditPrompt = useSequenceCreatorStore((s) => s.setEditPrompt);
  const draftGroups = useSequenceCreatorStore((s) => s.draftGroups);
  const setDraftGroups = useSequenceCreatorStore((s) => s.setDraftGroups);
  const selectedGroupId = useSequenceCreatorStore((s) => s.selectedGroupId);
  const setSelectedGroupId = useSequenceCreatorStore((s) => s.setSelectedGroupId);
  const selectedDraftIndex = useSequenceCreatorStore((s) => s.selectedDraftIndex);
  const setSelectedDraftIndex = useSequenceCreatorStore((s) => s.setSelectedDraftIndex);
  const generationNote = useSequenceCreatorStore((s) => s.generationNote);
  const setGenerationNote = useSequenceCreatorStore((s) => s.setGenerationNote);
  const actionError = useSequenceCreatorStore((s) => s.actionError);
  const setActionError = useSequenceCreatorStore((s) => s.setActionError);

  // Unified-UX classifier state: tracks what path the most recent
  // generation took (json|code) so the path/capability badge can render
  // unconditionally (always visible per CLAUDE.md UI conventions).
  const classifierVerdict = useSequenceCreatorStore((s) => s.classifierVerdict);
  const setClassifierVerdict = useSequenceCreatorStore((s) => s.setClassifierVerdict);

  // Fork-to-DB pending state: when the classifier returns path:'code' AND
  // the selected clip is theme-bundled (`installed-sequence` source), we
  // gate the code-path follow-up behind a deliberate "Customize this
  // sequence for yourself" confirmation. Stores the prompt + classifier
  // reason so the confirm action can dispatch the follow-up call.
  const forkPending = useSequenceCreatorStore((s) => s.forkPending);
  const setForkPending = useSequenceCreatorStore((s) => s.setForkPending);

  // Latest generated component metadata (when the code path produces a
  // result). Surfaces in the path badge so the user can see whether
  // they're editing JSON params or DB-stored component code.
  const generatedComponent = useSequenceCreatorStore((s) => s.generatedComponent);
  const setGeneratedComponent = useSequenceCreatorStore((s) => s.setGeneratedComponent);
  // When the user loads an entry from the Library tab, this holds the
  // resource's existing clipType. persistGeneratedComponent reuses it instead
  // of inserting a duplicate DB row.
  const generatedComponentSourceClipType = useSequenceCreatorStore((s) => s.generatedComponentSourceClipType);
  const setGeneratedComponentSourceClipType = useSequenceCreatorStore((s) => s.setGeneratedComponentSourceClipType);

  // Library tab: list of saved sequence-component resources for the current
  // user (plus public ones the merge logic in useSequenceResources adds).
  const { userId } = useAuth();
  const libraryCatalog = useSequenceResources(userId);

  // Transient request lifecycle — deliberately NOT lifted to the store.
  // An in-flight request from before unmount/reload is gone afterward.
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedAllowedAssets, setUploadedAllowedAssets] = useState<AllowedSequenceAsset[]>([]);
  const [isUploadingAllowedAsset, setIsUploadingAllowedAsset] = useState(false);
  const [libraryPreviewResource, setLibraryPreviewResource] = useState<SequenceComponentResource | null>(null);
  const [deletingLibraryResourceId, setDeletingLibraryResourceId] = useState<string | null>(null);

  const baseAllowedAssets = useMemo(() => (
    resolvedConfig
      ? buildAllowedSequenceAssets(selectedMedia.clips, attachmentSet.clips, resolvedConfig.registry)
      : []
  ), [attachmentSet.clips, resolvedConfig, selectedMedia.clips]);

  const allowedAssets = useMemo(() => {
    const byKey = new Map<string, AllowedSequenceAsset>();
    for (const asset of [...baseAllowedAssets, ...uploadedAllowedAssets]) {
      byKey.set(asset.key, asset);
    }
    return [...byKey.values()];
  }, [baseAllowedAssets, uploadedAllowedAssets]);

  const allowedAssetKeys = useMemo(() => allowedAssets.map((asset) => asset.key), [allowedAssets]);

  const allowedRegistry = useMemo(() => (
    resolvedConfig ? buildAllowedAssetRegistry(allowedAssets, resolvedConfig.registry) : {}
  ), [allowedAssets, resolvedConfig]);

  const selectedGroup = useMemo(() => (
    selectedGroupId
      ? draftGroups.find((group) => group.id === selectedGroupId) ?? null
      : null
  ), [draftGroups, selectedGroupId]);
  const drafts = selectedGroup?.drafts ?? [];
  const selectedDraft = drafts[selectedDraftIndex] ?? null;
  const selectedValidation = useMemo(() => (
    selectedDraft ? validateEditableSequenceDraft(selectedDraft, allowedAssetKeys) : null
  ), [allowedAssetKeys, selectedDraft]);
  const validatedDraft = selectedValidation?.ok ? selectedValidation.draft : null;
  const selectedDescriptor = selectedDraft
    ? getAvailableClipTypeDescriptor(selectedDraft.clipType)
    : undefined;
  const selectedMetadata = selectedDraft ? getAvailableSequenceMetadata(selectedDraft.clipType) : undefined;
  const generatedComponentAssetSlots = useMemo(
    () => getGeneratedComponentAssetSlots(generatedComponent),
    [generatedComponent],
  );
  const generatedAssetSlotValidation = useMemo(() => {
    if (!generatedComponent || generatedComponentAssetSlots.length === 0) {
      return { bindings: {}, errors: [] };
    }
    return validateAssetSlotBindings({
      slots: generatedComponentAssetSlots,
      bindings: (generatedComponent.defaultsJson as Record<string, unknown>)[ASSET_SLOT_BINDINGS_PARAM],
      registry: buildPanelAssetSlotRegistry(allowedAssets),
      path: `defaultsJson.${ASSET_SLOT_BINDINGS_PARAM}`,
    });
  }, [allowedAssets, generatedComponent, generatedComponentAssetSlots]);
  const generatedAssetSlotError = generatedAssetSlotValidation.errors.length > 0
    ? generatedAssetSlotValidation.errors.map((error) => error.message).join(' ')
    : null;

  useEffect(() => {
    if (!generatedComponent || generatedComponentAssetSlots.length === 0) return;
    const hasUnavailableBinding = generatedAssetSlotValidation.errors.some((error) => (
      error.code === 'unknown_asset_key'
      || error.code === 'media_type_mismatch'
      || error.code === 'missing_asset_url'
    ));
    if (!hasUnavailableBinding) return;

    const defaults = (generatedComponent.defaultsJson ?? {}) as Record<string, unknown>;
    const currentBindings = normalizeAssetSlotBindings(defaults[ASSET_SLOT_BINDINGS_PARAM]).bindings;
    const nextDefaults = applyAvailableAssetSlotDefaults(
      generatedComponent.defaultsJson,
      generatedComponentAssetSlots,
      allowedAssets,
    ) as Record<string, unknown>;
    const nextBindings = normalizeAssetSlotBindings(nextDefaults[ASSET_SLOT_BINDINGS_PARAM]).bindings;
    if (JSON.stringify(currentBindings) === JSON.stringify(nextBindings)) return;

    setGeneratedComponent((prev) => (
      prev === generatedComponent
        ? { ...prev, defaultsJson: nextDefaults }
        : prev
    ));
  }, [
    allowedAssets,
    generatedAssetSlotValidation.errors,
    generatedComponent,
    generatedComponentAssetSlots,
    setGeneratedComponent,
  ]);

  const previewConfig = useMemo(() => {
    if (!resolvedConfig || !validatedDraft) return null;
    return buildSequencePreviewConfig(resolvedConfig, validatedDraft);
  }, [resolvedConfig, validatedDraft]);

  const replaceProbe = useMemo(() => {
    if (!data || !validatedDraft) return null;
    return buildReplaceSequenceDraftEdit(data, validatedDraft, { selectedClipId, selectedClipIds });
  }, [data, selectedClipId, selectedClipIds, validatedDraft]);

  const replaceDisabledReason = useMemo(() => {
    if (generatedComponent && generatedAssetSlotError) {
      return generatedAssetSlotError;
    }
    if (!validatedDraft && !generatedComponent) {
      return selectedValidation && !selectedValidation.ok
        ? summarizeValidationErrors(selectedValidation.errors)
        : 'Generate or select a sequence first.';
    }
    if (!selectedClipId && (!selectedClipIds || selectedClipIds.length === 0)) {
      return 'Select a visual clip to replace.';
    }
    if (validatedDraft) {
      if (!replaceProbe) return 'Select a visual clip to replace.';
      return replaceProbe.ok ? null : formatEditError(replaceProbe.error);
    }
    return null;
  }, [generatedAssetSlotError, generatedComponent, replaceProbe, selectedClipId, selectedClipIds, selectedValidation, validatedDraft]);

  const runSequenceGeneration = useCallback(async (rawPrompt: string, options: {
    mode?: SequenceCreatorMode;
    replaceGroupId?: string | null;
    editContext?: unknown;
    nameOverride?: string;
  } = {}) => {
    const generationPrompt = rawPrompt.trim();
    if (!generationPrompt) {
      toast({
        title: 'Prompt required',
        description: options.mode === 'edit' ? 'Describe how to change this animation.' : 'Describe the sequence you want to create.',
        variant: 'destructive',
      });
      return;
    }
    if (!resolvedConfig) {
      toast({ title: 'Timeline unavailable', description: 'Load a timeline before generating a sequence.', variant: 'destructive' });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setGenerationNote(null);
    setActionError(null);
    if ((options.mode ?? 'generate') === 'generate') {
      setSelectedGroupId(null);
    }

    try {
      // Custom animation mode: skip the classifier round-trip and call the
      // code-path edge function directly. Avoids wasted Claude tokens on a
      // routing decision the user has already made.
      if (generationMode === 'code') {
        sequenceCreatorLog('code_path:forced:start', {
          promptLength: generationPrompt.length,
          selectedClipCount: selectedMedia.clips.length,
          attachedClipCount: attachmentSet.clips.length,
          allowedAssetCount: allowedAssets.length,
        });
        const codeResult = await runSequenceComponentGenerationRequest({
          prompt: generationPrompt,
          resolvedConfig,
          selectedClips: selectedMedia.clips,
          attachedClips: attachmentSet.clips,
          allowedAssets,
          allowedAssetKeys,
          signal: controller.signal,
        });
        if (codeResult.status === 'aborted') return;
        if (codeResult.status === 'error') {
          sequenceCreatorWarn('code_path:forced:error', {
            error: codeResult.error,
            rawOutputLength: codeResult.rawOutput?.length ?? 0,
          });
          setActionError(codeResult.error);
          setGenerationNote(`Code-path generation failed: ${codeResult.error}`);
          return;
        }
        sequenceCreatorLog('code_path:forced:ok', {
          codeLength: codeResult.code.length,
          name: codeResult.name,
          model: codeResult.model,
          controlsManifestCount: codeResult.controlsManifest.length,
        });
        setClassifierVerdict({ path: 'code', reason: 'Custom animation mode (forced).' });
        setGeneratedComponent({
          code: codeResult.code,
          name: codeResult.name,
          description: codeResult.description,
          schemaJson: codeResult.schemaJson,
          defaultsJson: codeResult.defaultsJson,
          assetSlots: codeResult.assetSlots,
          controlsManifest: codeResult.controlsManifest as unknown[],
        });
        setGeneratedComponentSourceClipType(undefined);
        setMode('edit');
        setGenerationNote(codeResult.message ?? 'Generated component code (browser-only render).');
        return;
      }

      const result = await runSequenceGenerationRequest({
        prompt: generationPrompt,
        mode: options.mode,
        editContext: options.editContext,
        resolvedConfig,
        selectedClips: selectedMedia.clips,
        attachedClips: attachmentSet.clips,
        allowedAssets,
        allowedAssetKeys,
        signal: controller.signal,
      });
      if (result.status === 'aborted') return;

      // Basic mode: force-ignore any classifier verdict and treat the
      // response as JSON-only. The edge function still includes the
      // classifier preamble; we just refuse to route to code.
      if (generationMode === 'json' && result.status === 'classifier_code') {
        setClassifierVerdict({ path: 'json', reason: 'Basic mode (classifier override).' });
        setGenerationNote('Basic mode: stayed on JSON path even though the classifier suggested code.');
        return;
      }

      if (result.status === 'classifier_code') {
        sequenceCreatorLog('code_path:classifier_routed', {
          reason: result.classifier.reason,
          promptLength: result.generationPrompt.length,
        });
        // Unified-UX (T13): classifier routed this prompt to the code path.
        // For theme-bundled clips we require deliberate fork-to-DB confirmation
        // ("Customize this sequence for yourself"); otherwise we dispatch
        // the follow-up call directly.
        setClassifierVerdict(result.classifier);
        // Resolve the clipType of the currently-selected timeline clip via
        // resolvedConfig — `SelectedMediaClip` doesn't carry clipType.
        const primaryClipId = selectedClipId ?? selectedClipIds?.values().next().value ?? null;
        const primaryClip = primaryClipId
          ? resolvedConfig.clips.find((c) => c.id === primaryClipId) ?? null
          : null;
        const selectedClipType = primaryClip?.clipType ?? '';
        const descriptor = getClipCapabilityDescriptor(selectedClipType);
        const isThemeBundled = descriptor?.source === 'installed-sequence';
        if (isThemeBundled && selectedClipType) {
          const bundled = getBundledComponentSource(selectedClipType);
          sequenceCreatorLog('code_path:fork_pending', {
            selectedClipType,
            bundledStatus: bundled.status,
          });
          setForkPending({
            prompt: result.generationPrompt,
            reason: result.classifier.reason,
            selectedClipType,
            bundledSource: bundled,
          });
          setGenerationNote(
            bundled.status === 'cannot-fork'
              ? bundled.reason
              : 'This change requires custom component code. Confirm fork-to-DB to proceed.',
          );
          return;
        }
        // Non-bundled selection (DB-stored sequence or no selection): dispatch
        // the code-path call directly.
        sequenceCreatorLog('code_path:classifier_followup:start', {
          promptLength: result.generationPrompt.length,
          selectedClipCount: selectedMedia.clips.length,
          attachedClipCount: attachmentSet.clips.length,
          allowedAssetCount: allowedAssets.length,
        });
        const codeResult = await runSequenceComponentGenerationRequest({
          prompt: result.generationPrompt,
          resolvedConfig,
          selectedClips: selectedMedia.clips,
          attachedClips: attachmentSet.clips,
          allowedAssets,
          allowedAssetKeys,
          signal: controller.signal,
        });
        if (codeResult.status === 'aborted') return;
        if (codeResult.status === 'error') {
          sequenceCreatorWarn('code_path:classifier_followup:error', {
            error: codeResult.error,
            rawOutputLength: codeResult.rawOutput?.length ?? 0,
          });
          setActionError(codeResult.error);
          setGenerationNote(`Code-path generation failed: ${codeResult.error}`);
          return;
        }
        sequenceCreatorLog('code_path:classifier_followup:ok', {
          codeLength: codeResult.code.length,
          name: codeResult.name,
          model: codeResult.model,
          controlsManifestCount: codeResult.controlsManifest.length,
        });
        setGeneratedComponent({
          code: codeResult.code,
          name: codeResult.name,
          description: codeResult.description,
          schemaJson: codeResult.schemaJson,
          defaultsJson: codeResult.defaultsJson,
          assetSlots: codeResult.assetSlots,
          controlsManifest: codeResult.controlsManifest as unknown[],
        });
        setGeneratedComponentSourceClipType(undefined);
        setMode('edit');
        setGenerationNote(codeResult.message ?? 'Generated component code (browser-only render).');
        return;
      }

      if (result.status === 'no_valid_drafts') {
        setClassifierVerdict(result.classifier ?? null);
        setGenerationNote(result.generationNote);
        return;
      }

      const nextGroupId = options.replaceGroupId ?? createDraftGroupId();
      setDraftGroups((current) => {
        const nextGroup: SequenceDraftGroup = {
          id: nextGroupId,
          name: options.nameOverride ?? nameDraftGroupFromPrompt(generationPrompt, current.length),
          prompt: result.generationPrompt,
          intent: result.animationIntentPayload,
          drafts: result.validDrafts,
        };
        if (options.replaceGroupId) {
          return current.map((group) => (group.id === options.replaceGroupId ? nextGroup : group));
        }
        return [nextGroup];
      });
      setSelectedGroupId(nextGroupId);
      setSelectedDraftIndex(0);
      setMode('edit');
      setGenerationNote(result.generationNote);
      setClassifierVerdict(result.classifier ?? null);
      // Successful JSON-path result: clear any stale generated component.
      setGeneratedComponent(null);
      setGeneratedComponentSourceClipType(undefined);
      setForkPending(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Sequence generation failed.';
      toast({ title: 'Sequence generation failed', description: message, variant: 'destructive' });
      setGenerationNote(message);
    } finally {
      setIsGenerating(false);
    }
  }, [
    allowedAssetKeys,
    allowedAssets,
    attachmentSet.clips,
    generationMode,
    resolvedConfig,
    selectedClipId,
    selectedClipIds,
    selectedMedia.clips,
    setActionError,
    setClassifierVerdict,
    setDraftGroups,
    setForkPending,
    setGeneratedComponent,
    setGeneratedComponentSourceClipType,
    setGenerationNote,
    setMode,
    setSelectedDraftIndex,
    setSelectedGroupId,
  ]);

  const handleGenerate = useCallback(() => {
    void runSequenceGeneration(prompt);
  }, [prompt, runSequenceGeneration]);

  // Fork-to-DB confirmation handler (T13): when the classifier asked for
  // the code path on a theme-bundled clip, this dispatches the actual
  // ai-generate-sequence-component call with `existingComponent` derived
  // from the bundled TSX source. The badge stays visible after either
  // success or error so the user always knows which path ran.
  const handleConfirmFork = useCallback(async () => {
    if (!forkPending || forkPending.bundledSource.status !== 'available' || !resolvedConfig) {
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setActionError(null);
    try {
      sequenceCreatorLog('code_path:fork:start', {
        selectedClipType: forkPending.selectedClipType,
        promptLength: forkPending.prompt.length,
        bundledCodeLength: forkPending.bundledSource.code.length,
      });
      const codeResult = await runSequenceComponentGenerationRequest({
        prompt: forkPending.prompt,
        existingComponent: {
          code: forkPending.bundledSource.code,
          schema: forkPending.bundledSource.schema,
          defaults: forkPending.bundledSource.defaults,
        },
        // Bundled clip types pre-date the manifest concept, so no controls
        // are surfaced for fork; the model generates a fresh manifest.
        resolvedConfig,
        selectedClips: selectedMedia.clips,
        attachedClips: attachmentSet.clips,
        allowedAssets,
        allowedAssetKeys,
        signal: controller.signal,
      });
      if (codeResult.status === 'aborted') return;
      if (codeResult.status === 'error') {
        sequenceCreatorWarn('code_path:fork:error', {
          error: codeResult.error,
          rawOutputLength: codeResult.rawOutput?.length ?? 0,
        });
        setActionError(codeResult.error);
        setGenerationNote(`Fork failed: ${codeResult.error}`);
        return;
      }
      sequenceCreatorLog('code_path:fork:ok', {
        codeLength: codeResult.code.length,
        name: codeResult.name,
        model: codeResult.model,
        controlsManifestCount: codeResult.controlsManifest.length,
      });
      setGeneratedComponent({
        code: codeResult.code,
        name: codeResult.name,
        description: codeResult.description,
        schemaJson: codeResult.schemaJson,
        defaultsJson: codeResult.defaultsJson,
        assetSlots: codeResult.assetSlots,
        controlsManifest: codeResult.controlsManifest as unknown[],
      });
      setGeneratedComponentSourceClipType(undefined);
      setMode('edit');
      setGenerationNote(
        codeResult.message ?? `Forked "${forkPending.selectedClipType}" into a custom DB-stored sequence.`,
      );
      setForkPending(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Fork failed.';
      setActionError(message);
      setGenerationNote(message);
    } finally {
      setIsGenerating(false);
    }
  }, [
    allowedAssetKeys,
    allowedAssets,
    attachmentSet.clips,
    forkPending,
    resolvedConfig,
    selectedMedia.clips,
    setActionError,
    setForkPending,
    setGeneratedComponent,
    setGeneratedComponentSourceClipType,
    setGenerationNote,
    setMode,
  ]);

  const handleCancelFork = useCallback(() => {
    setForkPending(null);
    setGenerationNote(null);
  }, [setForkPending, setGenerationNote]);

  // T14 — headless smoke-render gate before persisting a generated
  // sequence component. Save flow:
  //   1. Run smokeRenderSequenceComponent({code, schema, defaults}). If it
  //      returns { ok: false }, surface the error inline (NOT a toast — per
  //      CLAUDE.md UI conventions: errors-only toasts; panel-inline is
  //      correct for this gate) and DO NOT persist.
  //   2. On success, call useCreateSequenceComponentResource.mutateAsync
  //      with the SequenceComponentMetadata derived from the generated
  //      component.
  // The gate catches compile errors + obvious runtime errors via
  // react-dom/server.renderToString — see headlessRender.ts for the
  // FLAG-005 caveat that ThemeProvider/SequenceContext are NOT exercised.
  // Smoke-render gate + DB persist + emit a synthetic ValidatedSequenceDraft
  // that downstream Insert/Replace builders can consume. This unifies the
  // code-path flow with the JSON-path flow (effects pattern: save-on-action,
  // not save-as-a-separate-button). Returns the draft pointing at the
  // freshly-saved resource's unique clipType so the timeline edit will
  // resolve to the correct component via DynamicSequenceRegistry.
  const createSequenceComponent = useCreateSequenceComponentResource();
  const [isSaving, setIsSaving] = useState(false);
  const persistGeneratedComponent = useCallback(async ():
    Promise<{ ok: true; draft: ValidatedSequenceDraft } | { ok: false; error: string }> => {
    if (!generatedComponent) return { ok: false, error: 'No generated component.' };
    const startedAt = Date.now();
    sequenceCreatorLog('persist:start', {
      name: generatedComponent.name,
      codeLength: generatedComponent.code.length,
      controlsManifestCount: generatedComponent.controlsManifest?.length ?? 0,
      sourceClipType: generatedComponentSourceClipType ?? null,
    });
    const defaultHold = 4;
    // Loaded from library: the resource already exists in DB. Reuse its
    // clipType and skip the create-resource smoke/save gate so Insert/Replace
    // cannot be blocked by a persistence-only check.
    if (generatedComponentSourceClipType) {
      sequenceCreatorLog('persist:reuse_existing', {
        durationMs: Date.now() - startedAt,
        clipType: generatedComponentSourceClipType,
      });
      return {
        ok: true,
        draft: {
          clipType: generatedComponentSourceClipType,
          hold: defaultHold,
          params: (generatedComponent.defaultsJson ?? {}) as ValidatedSequenceDraft['params'],
        },
      };
    }

    const smokeDefaults = materializeGeneratedComponentDefaults(generatedComponent, allowedAssets);
    if (!smokeDefaults.ok) {
      sequenceCreatorWarn('persist:asset_slots_invalid', {
        durationMs: Date.now() - startedAt,
        error: smokeDefaults.error,
      });
      return { ok: false, error: `Asset slot bindings invalid: ${smokeDefaults.error}. Component NOT saved.` };
    }
    const smoke = await smokeRenderSequenceComponent({
      code: generatedComponent.code,
      schemaJson: generatedComponent.schemaJson,
      defaultsJson: smokeDefaults.defaultsJson,
      fps: resolvedConfig?.output.fps ?? 30,
    });
    if (!smoke.ok) {
      sequenceCreatorWarn('persist:smoke_failed', {
        durationMs: Date.now() - startedAt,
        error: smoke.error,
      });
      return { ok: false, error: `Smoke render failed: ${smoke.error}. Component NOT saved.` };
    }
    sequenceCreatorLog('persist:smoke_ok', {
      durationMs: Date.now() - startedAt,
    });
    const slug = (generatedComponent.name || 'component')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    const uniqueClipType = forkPending?.selectedClipType
      ?? `custom-component:${slug}-${Date.now().toString(36)}`;
    const metadata: SequenceComponentMetadata = {
      name: generatedComponent.name || 'Untitled component',
      slug,
      code: generatedComponent.code,
      schemaJson: generatedComponent.schemaJson,
      defaultsJson: generatedComponent.defaultsJson,
      controlsManifest: generatedComponent.controlsManifest,
      assetSlots: getGeneratedComponentAssetSlots(generatedComponent),
      clipType: uniqueClipType,
      themeId: resolvedConfig?.theme ?? '2rp',
      description: generatedComponent.description,
      created_by: { is_you: true },
      is_public: false,
    };
    metadata.elementManifest = sequenceComponentMetadataToElementManifest(metadata, {
      id: `reigh:sequence-component:${uniqueClipType}`,
      generatedBy: 'sequence-creator',
    });
    try {
      sequenceCreatorLog('persist:save:start', {
        clipType: uniqueClipType,
        slug,
        themeId: metadata.themeId,
      });
      await createSequenceComponent.mutateAsync({ metadata });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed.';
      console.error('[SequenceCreator:Panel] persist:save_failed', {
        durationMs: Date.now() - startedAt,
        clipType: uniqueClipType,
        message,
      });
      return { ok: false, error: `Save failed: ${message}. Component NOT saved.` };
    }
    sequenceCreatorLog('persist:save_ok', {
      durationMs: Date.now() - startedAt,
      clipType: uniqueClipType,
      slug,
    });
    return {
      ok: true,
      draft: {
        clipType: uniqueClipType,
        hold: defaultHold,
        params: (generatedComponent.defaultsJson ?? {}) as ValidatedSequenceDraft['params'],
      },
    };
  }, [
    allowedAssets,
    createSequenceComponent,
    forkPending,
    generatedComponent,
    generatedComponentSourceClipType,
    resolvedConfig?.output.fps,
    resolvedConfig?.theme,
  ]);

  const buildLibraryResourceDraft = useCallback((resource: SequenceComponentResource): ValidatedSequenceDraft => {
    const assetSlots = normalizeLibraryAssetSlots(resource);
    const defaultsJson = generatedComponentSourceClipType === resource.clipType && generatedComponent
      ? generatedComponent.defaultsJson
      : applyAvailableAssetSlotDefaults(resource.defaultsJson, assetSlots, allowedAssets);
    return {
      clipType: resource.clipType,
      hold: 4,
      params: (defaultsJson ?? {}) as ValidatedSequenceDraft['params'],
    };
  }, [allowedAssets, generatedComponent, generatedComponentSourceClipType]);

  const handleEditSelected = useCallback(() => {
    if (!selectedGroup || !selectedDraft) return;
    void runSequenceGeneration(editPrompt, {
      mode: 'edit',
      replaceGroupId: selectedGroup.id,
      nameOverride: selectedGroup.name,
      editContext: {
        original_prompt: selectedGroup.prompt,
        selected_draft_index: selectedDraftIndex,
        source_draft: selectedDraft,
        valid_source_draft: validatedDraft,
      },
    });
  }, [editPrompt, runSequenceGeneration, selectedDraft, selectedDraftIndex, selectedGroup, validatedDraft]);

  const updateSelectedDraft = useCallback((patch: Partial<EditableSequenceDraft>) => {
    if (!selectedGroup) return;
    setDraftGroups((current) => current.map((group) => (
      group.id === selectedGroup.id
        ? {
            ...group,
            drafts: group.drafts.map((draft, index) => (
              index === selectedDraftIndex
                ? { ...draft, ...patch }
                : draft
            )),
          }
        : group
    )));
    setActionError(null);
  }, [selectedDraftIndex, selectedGroup, setActionError, setDraftGroups]);

  const updateGeneratedAssetSlotBinding = useCallback((slotId: string, assetKeys: string[]) => {
    const nextAssetKeys = [...new Set(assetKeys)];
    setGeneratedComponent((prev) => {
      if (!prev) return prev;
      const defaults = (prev.defaultsJson ?? {}) as Record<string, unknown>;
      const normalized = normalizeAssetSlotBindings(defaults[ASSET_SLOT_BINDINGS_PARAM]);
      const nextBindings = { ...normalized.bindings };
      if (nextAssetKeys.length === 0) {
        delete nextBindings[slotId];
      } else {
        nextBindings[slotId] = nextAssetKeys;
      }
      return {
        ...prev,
        defaultsJson: {
          ...defaults,
          [ASSET_SLOT_BINDINGS_PARAM]: nextBindings,
        },
      };
    });
    setActionError(null);
  }, [setActionError, setGeneratedComponent]);

  // Resolve the draft to insert/replace with: prefer an explicit JSON
  // validated draft; otherwise persist the code-path generatedComponent and
  // synthesize a draft pointing at its DB resource.
  const resolveDraftForApply = useCallback(async ():
    Promise<{ ok: true; draft: ValidatedSequenceDraft } | { ok: false; error: string }> => {
    if (mode === 'library' && libraryPreviewResource) {
      sequenceCreatorLog('apply:resolve_draft:library_preview', {
        name: libraryPreviewResource.name,
        clipType: libraryPreviewResource.clipType,
      });
      return { ok: true, draft: buildLibraryResourceDraft(libraryPreviewResource) };
    }
    if (validatedDraft) {
      sequenceCreatorLog('apply:resolve_draft:validated', {
        clipType: validatedDraft.clipType,
      });
      return { ok: true, draft: validatedDraft };
    }
    if (generatedComponent) {
      sequenceCreatorLog('apply:resolve_draft:generated_component', {
        name: generatedComponent.name,
        codeLength: generatedComponent.code.length,
      });
      return persistGeneratedComponent();
    }
    sequenceCreatorWarn('apply:resolve_draft:missing');
    return { ok: false, error: 'Generate a sequence first.' };
  }, [
    buildLibraryResourceDraft,
    generatedComponent,
    libraryPreviewResource,
    mode,
    persistGeneratedComponent,
    validatedDraft,
  ]);

  const handleInsert = useCallback(async () => {
    if (!data) return;
    setIsSaving(true);
    setActionError(null);
    try {
      sequenceCreatorLog('apply:insert:start', {
        currentTime,
        selectedTrackId: selectedTrackId ?? null,
      });
      const resolved = await resolveDraftForApply();
      if (!resolved.ok) {
        sequenceCreatorWarn('apply:insert:resolve_failed', {
          error: resolved.error,
        });
        setActionError(resolved.error);
        return;
      }
      sequenceCreatorLog('apply:insert:draft_resolved', {
        clipType: resolved.draft.clipType,
        hold: resolved.draft.hold,
        paramKeys: Object.keys(resolved.draft.params ?? {}),
      });
      const result = buildInsertSequenceDraftEdit(data, resolved.draft, {
        at: currentTime,
        selectedTrackId,
      });
      if (!result.ok) {
        sequenceCreatorWarn('apply:insert:build_failed', {
          error: result.error,
          clipType: resolved.draft.clipType,
        });
        setActionError(formatEditError(result.error));
        return;
      }
      sequenceCreatorLog('apply:insert:build_ok', {
        clipId: result.clipId,
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      applyEdit(attachSequenceGenerationMetadata(
        result.mutation,
        result.clipId,
        buildSequenceGenerationMetadata(selectedGroup, selectedDraftIndex),
      ), {
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      requestCenterTimelineClip(result.selectedClipId);
      sequenceCreatorLog('apply:insert:applied', {
        clipId: result.clipId,
        selectedClipId: result.selectedClipId,
      });
      onOpenChange?.(false);
    } finally {
      setIsSaving(false);
    }
  }, [applyEdit, currentTime, data, onOpenChange, resolveDraftForApply, selectedDraftIndex, selectedGroup, selectedTrackId, setActionError]);

  const handleReplace = useCallback(async () => {
    if (!data) return;
    setIsSaving(true);
    setActionError(null);
    try {
      sequenceCreatorLog('apply:replace:start', {
        selectedClipId: selectedClipId ?? null,
        selectedClipIds: selectedClipIds ? Array.from(selectedClipIds) : [],
      });
      const resolved = await resolveDraftForApply();
      if (!resolved.ok) {
        sequenceCreatorWarn('apply:replace:resolve_failed', {
          error: resolved.error,
        });
        setActionError(resolved.error);
        return;
      }
      sequenceCreatorLog('apply:replace:draft_resolved', {
        clipType: resolved.draft.clipType,
        hold: resolved.draft.hold,
        paramKeys: Object.keys(resolved.draft.params ?? {}),
      });
      const result = buildReplaceSequenceDraftEdit(data, resolved.draft, { selectedClipId, selectedClipIds });
      if (!result.ok) {
        sequenceCreatorWarn('apply:replace:build_failed', {
          error: result.error,
          clipType: resolved.draft.clipType,
        });
        setActionError(formatEditError(result.error));
        return;
      }
      sequenceCreatorLog('apply:replace:build_ok', {
        clipId: result.clipId,
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      applyEdit(attachSequenceGenerationMetadata(
        result.mutation,
        result.clipId,
        buildSequenceGenerationMetadata(selectedGroup, selectedDraftIndex),
      ), {
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      requestCenterTimelineClip(result.selectedClipId);
      sequenceCreatorLog('apply:replace:applied', {
        clipId: result.clipId,
        selectedClipId: result.selectedClipId,
      });
      onOpenChange?.(false);
    } finally {
      setIsSaving(false);
    }
  }, [applyEdit, data, onOpenChange, resolveDraftForApply, selectedClipId, selectedClipIds, selectedDraftIndex, selectedGroup, setActionError]);

  const handleRemoveAllowedAsset = useCallback((asset: {
    clipId: string;
    url: string;
    mediaType: 'image' | 'video';
    generationId?: string;
    assetKey?: string;
  }) => {
    if (asset.assetKey) {
      setUploadedAllowedAssets((current) => current.filter((item) => item.key !== asset.assetKey));
    }
    composerRemoveAttachment({
      clipId: asset.clipId,
      url: asset.url,
      mediaType: asset.mediaType,
      generationId: asset.generationId,
    });
  }, []);

  const handleUploadAllowedAssets = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((file) => (
      file.type.startsWith('image/') || file.type.startsWith('video/')
    ));
    if (fileArray.length === 0) return;

    const projectId = runtime.project.projectId;
    if (!projectId) {
      toast({ title: 'Project unavailable', description: 'Load a project before uploading sequence assets.', variant: 'destructive' });
      return;
    }

    setIsUploadingAllowedAsset(true);
    setActionError(null);
    try {
      const uploaded: AllowedSequenceAsset[] = [];
      for (const file of fileArray) {
        const isVideo = file.type.startsWith('video/');
        const generation = isVideo
          ? await createGenerationForUploadedVideo({ videoFile: file, projectId })
          : await createGenerationForUploadedImage({ imageFile: file, projectId });
        const url = typeof generation.location === 'string' ? generation.location : '';
        if (!url) {
          throw new Error(`Upload completed without a media URL for ${file.name}`);
        }
        const thumbnailUrl = typeof generation.thumbnail_url === 'string' ? generation.thumbnail_url : url;
        const assetKey = registerGenerationAsset({
          generationId: generation.id,
          variantType: isVideo ? 'video' : 'image',
          imageUrl: url,
          thumbUrl: thumbnailUrl,
          metadata: {
            content_type: file.type || (isVideo ? 'video/mp4' : 'image/png'),
            original_filename: file.name,
          },
        });
        if (!assetKey) {
          throw new Error(`Failed to register uploaded asset ${file.name}`);
        }
        uploaded.push({
          key: assetKey,
          url,
          mediaType: isVideo ? 'video' : 'image',
          source: 'uploaded',
          label: file.name,
          clipId: `sequence-upload:${assetKey}`,
          generationId: generation.id,
        });
      }
      setUploadedAllowedAssets((current) => {
        const byKey = new Map(current.map((asset) => [asset.key, asset]));
        uploaded.forEach((asset) => byKey.set(asset.key, asset));
        return [...byKey.values()];
      });
      toast({ title: 'Assets uploaded', description: `${uploaded.length} asset${uploaded.length === 1 ? '' : 's'} added to Sequence Creator.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload sequence assets.';
      setActionError(message);
      toast({ title: 'Upload failed', description: message, variant: 'destructive' });
    } finally {
      setIsUploadingAllowedAsset(false);
    }
  }, [registerGenerationAsset, runtime.project.projectId, setActionError]);

  const handleRemoveAllowedShot = useCallback((shotId: string) => {
    allowedAssets
      .filter((asset) => asset.shotId === shotId)
      .forEach((asset) => composerRemoveAttachment({
        clipId: asset.clipId,
        url: asset.url,
        mediaType: asset.mediaType,
        generationId: asset.generationId,
      }));
  }, [allowedAssets]);

  const insertDisabledReason = generatedComponent && generatedAssetSlotError
    ? generatedAssetSlotError
    : ((!validatedDraft && !generatedComponent)
      ? (selectedValidation && !selectedValidation.ok
        ? summarizeValidationErrors(selectedValidation.errors)
        : 'Generate or select a sequence first.')
      : (!data ? 'Timeline unavailable.' : null));

  // Library list — sorted newest-first by created_at, falling back to name.
  const libraryComponents = useMemo(() => {
    const list = [...libraryCatalog.components];
    list.sort((a, b) => {
      const aCreated = a.created_at ?? a.createdAt ?? '';
      const bCreated = b.created_at ?? b.createdAt ?? '';
      if (aCreated && bCreated) {
        return bCreated.localeCompare(aCreated);
      }
      if (aCreated) return -1;
      if (bCreated) return 1;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    return list;
  }, [libraryCatalog.components]);
  const libraryPreviewAssetSlots = useMemo(() => (
    libraryPreviewResource ? normalizeLibraryAssetSlots(libraryPreviewResource) : []
  ), [libraryPreviewResource]);

  const handleLoadLibraryComponent = useCallback((resource: SequenceComponentResource) => {
    const assetSlots = normalizeLibraryAssetSlots(resource);
    setGeneratedComponent({
      code: resource.code,
      name: resource.name,
      description: resource.description ?? '',
      schemaJson: resource.schemaJson,
      defaultsJson: applyAvailableAssetSlotDefaults(resource.defaultsJson, assetSlots, allowedAssets),
      assetSlots,
      controlsManifest: resource.controlsManifest as unknown[] | undefined,
    });
    setGeneratedComponentSourceClipType(resource.clipType);
    setClassifierVerdict({ path: 'code', reason: 'Loaded from library.' });
    // Clear any JSON-path draft selection so the right-pane uses the
    // generatedComponent code-path branch.
    setSelectedGroupId(null);
    setActionError(null);
    setGenerationNote(`Loaded "${resource.name}" from library.`);
    setMode('edit');
  }, [
    setActionError,
    setClassifierVerdict,
    setGeneratedComponent,
    setGeneratedComponentSourceClipType,
    setGenerationNote,
    setMode,
    setSelectedGroupId,
    allowedAssets,
  ]);

  const handlePreviewLibraryComponent = useCallback((resource: SequenceComponentResource) => {
    const assetSlots = normalizeLibraryAssetSlots(resource);
    setLibraryPreviewResource(resource);
    setGeneratedComponent({
      code: resource.code,
      name: resource.name,
      description: resource.description ?? '',
      schemaJson: resource.schemaJson,
      defaultsJson: applyAvailableAssetSlotDefaults(resource.defaultsJson, assetSlots, allowedAssets),
      assetSlots,
      controlsManifest: resource.controlsManifest as unknown[] | undefined,
    });
    setGeneratedComponentSourceClipType(resource.clipType);
    setClassifierVerdict({ path: 'code', reason: 'Previewing from library.' });
    setSelectedGroupId(null);
    setActionError(null);
    setGenerationNote(`Previewing "${resource.name}" from library.`);
  }, [
    setActionError,
    setClassifierVerdict,
    setGeneratedComponent,
    setGeneratedComponentSourceClipType,
    setGenerationNote,
    setSelectedGroupId,
    allowedAssets,
  ]);

  const handleDeleteLibraryComponent = useCallback(async (resource: SequenceComponentResource) => {
    if (!libraryCatalog.canDeleteComponent || !libraryCatalog.deleteComponent) {
      setActionError('This library does not support deleting saved sequences.');
      return;
    }
    setDeletingLibraryResourceId(resource.id);
    setActionError(null);
    try {
      await libraryCatalog.deleteComponent({ id: resource.id });
      if (generatedComponentSourceClipType === resource.clipType) {
        setGeneratedComponent(null);
        setGeneratedComponentSourceClipType(undefined);
      }
      setLibraryPreviewResource((current) => (current?.id === resource.id ? null : current));
      toast({ title: 'Sequence deleted', description: resource.name || 'Saved sequence removed.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete saved sequence.';
      setActionError(message);
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setDeletingLibraryResourceId(null);
    }
  }, [
    generatedComponentSourceClipType,
    libraryCatalog,
    setActionError,
    setGeneratedComponent,
    setGeneratedComponentSourceClipType,
  ]);

  // Edit tab is enabled when there's anything to edit: a JSON draft group OR
  // a code-path generated component.
  const editTabDisabled = draftGroups.length === 0 && !generatedComponent;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,820px)] max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="border-b border-border px-5 py-4">
            <div className="pr-8">
              <DialogTitle>Sequence Creator</DialogTitle>
              <DialogDescription>
                Generate trusted timeline sequence drafts from a prompt and the currently selected or attached assets.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,420px)_1fr] overflow-hidden">
            <div className="min-h-0 overflow-y-auto border-r border-border p-4">
              <div className="space-y-4">
                <div className="grid grid-cols-3 rounded-lg border border-border bg-muted/30 p-1">
                  <button
                    type="button"
                    className={[
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      mode === 'generate'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                    onClick={() => setMode('generate')}
                  >
                    Generate
                  </button>
                  <button
                    type="button"
                    className={[
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      mode === 'edit'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                    onClick={() => setMode('edit')}
                    disabled={editTabDisabled}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={[
                      'rounded-md px-3 py-1.5 text-sm transition-colors',
                      mode === 'library'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                    onClick={() => setMode('library')}
                  >
                    Library
                  </button>
                </div>

                {mode === 'generate' ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">Generation mode</div>
                      <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-background p-1 text-xs">
                        {([
                          { value: 'auto', label: 'Automatic', help: 'Let the model pick: param tweak vs custom code.' },
                          { value: 'code', label: 'Custom animation', help: 'Always generate a custom React component.' },
                          { value: 'json', label: 'Basic', help: 'Always edit JSON params on a trusted clip type.' },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            data-testid={`sequence-creator-mode-${option.value}`}
                            onClick={() => setGenerationMode(option.value)}
                            title={option.help}
                            className={[
                              'rounded-sm px-2 py-1 text-foreground transition-colors',
                              generationMode === option.value
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted',
                            ].join(' ')}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-foreground">Prompt</div>
                    <Textarea
                      value={prompt}
                      rows={5}
                      placeholder="Make these selected images jump between each other..."
                      onChange={(event) => setPrompt(event.target.value)}
                      voiceInput
                      onVoiceResult={(result) => setPrompt(result.transcription)}
                      voiceContext="The user is describing an animated sequence to generate inside a video editor. They may refer to selected or attached images, videos, text, motion, timing, or style. Transcribe their animation request accurately."
                      voiceTask="transcribe_only"
                    />
                    <Button
                      type="button"
                      className="w-full gap-2"
                      onClick={handleGenerate}
                      disabled={isGenerating || !prompt.trim()}
                    >
                      {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Generate new animation
                    </Button>
                  </div>
                ) : mode === 'library' ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">Your saved sequences</div>
                      <div className="text-xs text-muted-foreground">{libraryComponents.length}</div>
                    </div>
                    {libraryCatalog.isLoading && libraryComponents.length === 0 ? (
                      <div className="text-xs text-muted-foreground">Loading…</div>
                    ) : libraryComponents.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No saved sequences yet. Generate one and Insert it to save.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {libraryComponents.map((resource) => (
                          <div
                            key={resource.id}
                            className={[
                              'group relative rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40',
                              generatedComponentSourceClipType === resource.clipType
                                ? 'border-primary/70'
                                : 'border-border',
                            ].join(' ')}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {resource.name || 'Untitled component'}
                                </div>
                                {resource.description && (
                                  <div className="line-clamp-2 text-xs text-muted-foreground">
                                    {resource.description}
                                  </div>
                                )}
                              </div>
                              {libraryCatalog.canDeleteComponent && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                  title="Delete saved sequence"
                                  disabled={deletingLibraryResourceId === resource.id}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteLibraryComponent(resource);
                                  }}
                                >
                                  {deletingLibraryResourceId === resource.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              )}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <div className="min-w-0 truncate text-xs text-muted-foreground">
                                {resource.clipType}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                  onClick={() => handlePreviewLibraryComponent(resource)}
                                >
                                  Preview
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => handleLoadLibraryComponent(resource)}
                                >
                                  Load
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-lg border border-border bg-card/60 p-3">
                    <div className="text-sm font-medium text-foreground">Selected Animation</div>
                    {selectedGroup ? (
                      <>
                        <div className="text-sm text-foreground">{selectedGroup.name}</div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{selectedGroup.prompt}</div>
                        <Textarea
                          value={editPrompt}
                          rows={4}
                          placeholder="Make the motion faster, use all three selected images, remove the title..."
                          onChange={(event) => setEditPrompt(event.target.value)}
                          voiceInput
                          onVoiceResult={(result) => setEditPrompt(result.transcription)}
                          voiceContext="The user is describing edits to an existing generated animated sequence in a video editor. They may ask to change motion, timing, selected assets, titles, labels, or layout. Transcribe their edit instruction accurately."
                          voiceTask="transcribe_only"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full gap-2"
                          onClick={handleEditSelected}
                          disabled={isGenerating || !editPrompt.trim() || !selectedDraft}
                        >
                          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          Apply edit to animation
                        </Button>
                      </>
                    ) : generatedComponent ? (
                      <div className="text-xs text-muted-foreground">
                        Tweak the component params on the right, then Insert at playhead or Replace selected.
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">Generate an animation before editing.</div>
                    )}
                  </div>
                )}

                <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">Allowed Assets</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-muted-foreground">{allowedAssets.length}</div>
                      <Button
                        type="button"
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 px-2 text-xs"
                        disabled={isUploadingAllowedAsset}
                      >
                        <label>
                          {isUploadingAllowedAsset ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          Upload
                          <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            className="sr-only"
                            disabled={isUploadingAllowedAsset}
                            onChange={(event) => {
                              const files = event.currentTarget.files;
                              if (files && files.length > 0) {
                                void handleUploadAllowedAssets(files);
                              }
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </Button>
                    </div>
                  </div>
                  {allowedAssets.length > 0 ? (
                    <AgentChatAttachmentStrip
                      attachments={allowedAssets.map((asset) => ({
                        clipId: asset.clipId,
                        url: asset.url,
                        mediaType: asset.mediaType,
                        isPlaceholder: asset.isPlaceholder,
                        generationId: asset.generationId,
                        assetKey: asset.key,
                        shotId: asset.shotId,
                        shotName: asset.shotName,
                        shotSelectionClipCount: asset.shotSelectionClipCount,
                      }))}
                      isUser={false}
                      className="mt-0"
                      onRemoveAttachment={handleRemoveAllowedAsset}
                      onRemoveShot={handleRemoveAllowedShot}
                      maxPreviewCount={null}
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Select timeline media or attach asset chips before asking for asset-backed drafts.
                    </div>
                  )}
                </div>

                {/*
                  Path/capability badge (T13): always visible. Surfaces
                  whether the classifier ran the JSON path or the code
                  path so the user knows whether their clip can be
                  worker-rendered server-side. Uses Tailwind tokens
                  (bg-background/text-foreground) per CLAUDE.md.
                */}
                <div
                  data-testid="sequence-creator-path-badge"
                  className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
                >
                  <span className="font-medium">Mode:</span>
                  {generatedComponent || classifierVerdict?.path === 'code' ? (
                    <span>Generated component code · browser-only render (DB-stored)</span>
                  ) : classifierVerdict?.path === 'json' ? (
                    <span>Edited params · worker render available</span>
                  ) : (
                    <span className="text-muted-foreground">Awaiting generation…</span>
                  )}
                </div>

                {generatedComponent && (
                  <div
                    data-testid="sequence-creator-generated-component"
                    className="space-y-1 rounded-lg border border-border bg-background p-3 text-xs text-foreground"
                  >
                    <div className="font-medium">{generatedComponent.name || 'Generated component'}</div>
                    {generatedComponent.description && (
                      <p className="text-muted-foreground">{generatedComponent.description}</p>
                    )}
                    <p className="text-muted-foreground italic">
                      Use Insert at playhead or Replace selected — the component is saved to your library on the same click.
                    </p>
                  </div>
                )}

                {forkPending && (
                  <div
                    data-testid="sequence-creator-fork-prompt"
                    className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground"
                  >
                    <div className="font-medium">Customize this sequence for yourself</div>
                    <p className="text-muted-foreground">
                      This change requires a custom component. Forking copies "{forkPending.selectedClipType}"
                      into a per-user DB resource you can edit. The result renders in browser only —
                      worker-side render isn't supported for custom components yet.
                    </p>
                    <p className="text-muted-foreground italic">{forkPending.reason}</p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleConfirmFork()}
                        disabled={
                          isGenerating || forkPending.bundledSource.status !== 'available'
                        }
                      >
                        Customize
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={handleCancelFork}>
                        Cancel
                      </Button>
                    </div>
                    {forkPending.bundledSource.status === 'cannot-fork' && (
                      <div className="text-destructive">{forkPending.bundledSource.reason}</div>
                    )}
                  </div>
                )}

                {generationNote && (
                  <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                    {generationNote}
                  </div>
                )}

                {drafts.length > 1 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Draft Variants</div>
                    <div className="space-y-2">
                      {drafts.map((draft, index) => {
                        const metadata = getAvailableSequenceMetadata(draft.clipType);
                        return (
                          <button
                            key={`${draft.clipType}-${index}`}
                            type="button"
                            className={[
                              'w-full rounded-lg border p-3 text-left transition-colors',
                              index === selectedDraftIndex
                                ? 'border-primary bg-primary/10'
                                : 'border-border bg-card/60 hover:bg-muted/60',
                            ].join(' ')}
                            onClick={() => {
                              setSelectedDraftIndex(index);
                              setActionError(null);
                            }}
                          >
                            <div className="text-sm font-medium text-foreground">
                              {metadata?.label ?? draft.clipType}
                            </div>
                            <div className="text-xs text-muted-foreground">{draft.hold}s</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid min-h-0 grid-rows-[minmax(180px,1fr)_minmax(0,360px)]">
              <div className="min-h-0 overflow-hidden bg-black">
                {mode === 'library' && libraryPreviewResource ? (
                  <CodePathPreview
                    code={
                      generatedComponentSourceClipType === libraryPreviewResource.clipType
                        ? generatedComponent?.code ?? libraryPreviewResource.code
                        : libraryPreviewResource.code
                    }
                    defaultsJson={
                      generatedComponentSourceClipType === libraryPreviewResource.clipType
                        ? generatedComponent?.defaultsJson ?? libraryPreviewResource.defaultsJson
                        : libraryPreviewResource.defaultsJson
                    }
                    fps={resolvedConfig?.output.fps ?? 30}
                    allowedAssets={allowedAssets}
                    assetSlots={
                      generatedComponentSourceClipType === libraryPreviewResource.clipType
                        ? generatedComponent?.assetSlots ?? libraryPreviewAssetSlots
                        : libraryPreviewAssetSlots
                    }
                  />
                ) : previewConfig ? (
                  <RemotionPreview
                    config={previewConfig}
                    onTimeUpdate={() => undefined}
                    playerContainerRef={previewContainerRef}
                    compact
                    initialTime={0}
                  />
                ) : generatedComponent ? (
                  <CodePathPreview
                    code={generatedComponent.code}
                    defaultsJson={generatedComponent.defaultsJson}
                    fps={resolvedConfig?.output.fps ?? 30}
                    allowedAssets={allowedAssets}
                    assetSlots={generatedComponentAssetSlots}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Generate a sequence to preview it here.
                  </div>
                )}
              </div>

              <div className="flex max-h-[360px] min-h-0 flex-col border-t border-border">
                {(selectedDraft && selectedMetadata) || generatedComponent ? (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="space-y-4">
                        {selectedDraft && selectedMetadata ? (
                          <>
                            <div className="grid grid-cols-[1fr_140px] items-end gap-3">
                              <div>
                                <div className="text-sm font-medium text-foreground">
                                  {selectedDescriptor?.label ?? selectedMetadata.label}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {selectedDescriptor?.description ?? selectedMetadata.description}
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <div className="text-xs font-medium text-muted-foreground">Duration</div>
                                <NumberInput
                                  value={selectedDraft.hold}
                                  min={selectedMetadata.hold.minSeconds}
                                  max={selectedMetadata.hold.maxSeconds}
                                  step={selectedMetadata.hold.stepSeconds}
                                  onChange={(value) => updateSelectedDraft({ hold: value ?? selectedMetadata.hold.defaultSeconds })}
                                />
                              </div>
                            </div>

                            <SequenceParamEditor
                              clipType={selectedDraft.clipType}
                              metadata={selectedMetadata}
                              params={selectedDraft.params}
                              registry={allowedRegistry}
                              onChange={(params) => updateSelectedDraft({ params })}
                            />

                            {selectedValidation && !selectedValidation.ok && (
                              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                                {summarizeValidationErrors(selectedValidation.errors)}
                              </div>
                            )}
                          </>
                        ) : generatedComponent ? (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-foreground">
                                {generatedComponent.name || 'Generated component'}
                              </div>
                              {generatedComponent.description && (
                                <div className="text-xs text-muted-foreground">
                                  {generatedComponent.description}
                                </div>
                              )}
                            </div>
                            {generatedComponentAssetSlots.length > 0 && (
                              <AssetSlotPicker
                                slots={generatedComponentAssetSlots}
                                bindings={generatedAssetSlotValidation.bindings}
                                allowedAssets={allowedAssets}
                                errors={generatedAssetSlotValidation.errors}
                                onChangeSlot={updateGeneratedAssetSlotBinding}
                              />
                            )}
                            {(() => {
                              // Render controls via the new manifest layout when the
                              // component declared one (AI-generated post-manifest).
                              // Backwards compat: components saved before the manifest
                              // existed fall back to the JSON-schema-driven editor so
                              // they keep working without forcing a regeneration.
                              const manifestResult = generatedComponent.controlsManifest
                                ? validateControlsManifest(generatedComponent.controlsManifest, { code: generatedComponent.code })
                                : null;
                              if (manifestResult?.ok) {
                                return (
                                  <ControlsManifestLayout
                                    manifest={manifestResult.manifest}
                                    values={generatedComponent.defaultsJson as Record<string, unknown>}
                                    onChange={(next) => setGeneratedComponent((prev) => (
                                      prev ? { ...prev, defaultsJson: next } : prev
                                    ))}
                                  />
                                );
                              }
                              return (
                                <CodePathParamEditor
                                  schemaJson={generatedComponent.schemaJson}
                                  values={generatedComponent.defaultsJson as Record<string, unknown>}
                                  allowedAssetKeys={allowedAssetKeys}
                                  allowedAssets={allowedAssets}
                                  onChange={(next) => setGeneratedComponent((prev) => (
                                    prev ? { ...prev, defaultsJson: next } : prev
                                  ))}
                                />
                              );
                            })()}
                          </div>
                        ) : null}

                        {(actionError || replaceDisabledReason || insertDisabledReason) && (
                          <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                            {actionError ?? replaceDisabledReason ?? insertDisabledReason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background/95 p-4">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={Boolean(replaceDisabledReason) || isSaving}
                        onClick={() => void handleReplace()}
                        title={replaceDisabledReason ?? undefined}
                      >
                        {isSaving ? 'Saving…' : 'Replace selected'}
                      </Button>
                      <Button
                        type="button"
                        disabled={Boolean(insertDisabledReason) || isSaving}
                        onClick={() => void handleInsert()}
                        title={insertDisabledReason ?? undefined}
                      >
                        {isSaving ? 'Saving…' : 'Insert at playhead'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="p-4">
                    <div className="rounded-lg border border-border bg-card/60 p-4 text-sm text-muted-foreground">
                      Generated sequence drafts will appear here for timing and parameter edits.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
