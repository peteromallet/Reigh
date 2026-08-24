import { useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/shared/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog.tsx';
import { Textarea } from '@/shared/components/ui/textarea.tsx';
import { RemotionPreview } from '@/tools/video-editor/components/PreviewPanel/RemotionPreview.tsx';
import { useSelectedMediaClips } from '@/tools/video-editor/hooks/useSelectedMediaClips.ts';
import {
  useTimelineEditorData,
  useTimelineEditorOps,
  useTimelinePlaybackSelector,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  buildInsertSequenceDraftEdit,
  buildReplaceSequenceDraftEdit,
} from '@/tools/video-editor/lib/sequence-drafts.ts';
import { requestCenterTimelineClip } from '@/tools/video-editor/lib/timeline-viewport-events.ts';
import { useCurrentAttachmentSet } from '@/shared/state/currentAttachmentSet.ts';
import { composerRemoveAttachment } from '@/shared/state/selectionStore.ts';
import {
  attachSequenceGenerationMetadata,
  buildAllowedAssetRegistry,
  buildAllowedSequenceAssets,
  buildSequenceGenerationMetadata,
  type EditableSequenceDraft,
} from '@/tools/video-editor/sequences/generation.ts';
import { useSequenceCreatorStore } from '@/tools/video-editor/state/sequenceCreatorStore.ts';
import {
  getAvailableClipTypeDescriptor,
  getAvailableSequenceMetadata,
} from '@/tools/video-editor/sequences/registry.ts';
import type { ValidatedSequenceDraft } from '@/tools/video-editor/sequences/validation.ts';
import { CodePathPreview } from './CodePathPreview.tsx';
import {
  useClipTypeRegistrySnapshot,
  buildExtensionClipTypeDescriptorMap,
  getExtensionClipTypeDescriptor,
} from '@/tools/video-editor/clip-types/index.ts';
import type { ClipTypeDescriptor } from '@/tools/video-editor/clip-types/defineClipType.ts';
import {
  buildSequencePreviewConfig,
  formatEditError,
  summarizeValidationErrors,
  validateEditableSequenceDraft,
} from './sequence-creator-helpers.ts';
import { useSequenceComponentPersistence } from './useSequenceComponentPersistence.ts';
import { useSequenceGenerationActions } from './useSequenceGenerationActions.ts';
import { SequenceCreatorAllowedAssets } from './SequenceCreatorAllowedAssets.tsx';
import { SequenceCreatorComponentControls } from './SequenceCreatorComponentControls.tsx';
import { SequenceCreatorDraftParams } from './SequenceCreatorDraftParams.tsx';
import { SequenceCreatorDraftVariants } from './SequenceCreatorDraftVariants.tsx';
import { SequenceCreatorForkPrompt } from './SequenceCreatorForkPrompt.tsx';
import { SequenceCreatorLibraryList } from './SequenceCreatorLibraryList.tsx';
import { useSequenceResources, type SequenceComponentResource } from '@/tools/video-editor/hooks/useSequenceResources.ts';
import { useAuth } from '@/shared/contexts/AuthContext.tsx';

export { buildSequencePreviewConfig } from './sequence-creator-helpers.ts';

type SequenceCreatorPanelProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function SequenceCreatorPanel({
  open = true,
  onOpenChange,
}: SequenceCreatorPanelProps) {
  const selectedMedia = useSelectedMediaClips();
  const attachmentSet = useCurrentAttachmentSet();
  const { data, resolvedConfig, selectedClipId, selectedClipIds, selectedTrackId } = useTimelineEditorData();
  const { applyEdit } = useTimelineEditorOps();
  const currentTime = useTimelinePlaybackSelector((playback) => playback.currentTime);
  const previewContainerRef = useRef<HTMLDivElement>(null);

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

  // Latest generated component metadata (when the code path produces a
  // result). Surfaces in the path badge so the user can see whether
  // they're editing JSON params or DB-stored component code.
  const generatedComponent = useSequenceCreatorStore((s) => s.generatedComponent);
  const setGeneratedComponent = useSequenceCreatorStore((s) => s.setGeneratedComponent);
  // When the user loads an entry from the Library tab, this holds the
  // resource's existing clipType. persistGeneratedComponent reuses it instead
  // of inserting a duplicate DB row.
  const setGeneratedComponentSourceClipType = useSequenceCreatorStore((s) => s.setGeneratedComponentSourceClipType);

  // Library tab: list of saved sequence-component resources for the current
  // user (plus public ones the merge logic in useSequenceResources adds).
  const { userId } = useAuth();
  const libraryCatalog = useSequenceResources(userId);

  // T7: Read extension clip types from the ClipTypeRegistry so the Sequence
  // Creator panel can surface their labels, defaults, and param editors.
  const clipTypeRegistrySnapshot = useClipTypeRegistrySnapshot();
  const extensionClipTypeRecords = useMemo(
    () => clipTypeRegistrySnapshot.records,
    [clipTypeRegistrySnapshot.records],
  );
  const extensionClipTypeDescriptorMap = useMemo(
    () => buildExtensionClipTypeDescriptorMap(extensionClipTypeRecords),
    [extensionClipTypeRecords],
  );
  const extensionClipTypeIds = useMemo(
    () => new Set(extensionClipTypeRecords.map((r) => r.clipTypeId)),
    [extensionClipTypeRecords],
  );

  const allowedAssets = useMemo(() => (
    resolvedConfig
      ? buildAllowedSequenceAssets(selectedMedia.clips, attachmentSet.clips, resolvedConfig.registry)
      : []
  ), [attachmentSet.clips, resolvedConfig, selectedMedia.clips]);

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
    selectedDraft ? validateEditableSequenceDraft(selectedDraft, allowedAssetKeys, extensionClipTypeIds) : null
  ), [allowedAssetKeys, extensionClipTypeIds, selectedDraft]);
  const validatedDraft = selectedValidation?.ok ? selectedValidation.draft : null;
  const selectedDescriptor = selectedDraft
    ? (getAvailableClipTypeDescriptor(selectedDraft.clipType)
      ?? extensionClipTypeDescriptorMap.get(selectedDraft.clipType))
    : undefined;
  const selectedMetadata = selectedDraft ? getAvailableSequenceMetadata(selectedDraft.clipType) : undefined;
  // For extension clip types, derive a descriptor from the extension registry.
  const resolvedDescriptor: ClipTypeDescriptor | undefined = selectedDescriptor
    ?? (selectedDraft
      ? getExtensionClipTypeDescriptor(selectedDraft.clipType, extensionClipTypeRecords)
      : undefined);

  const previewConfig = useMemo(() => {
    if (!resolvedConfig || !validatedDraft) return null;
    return buildSequencePreviewConfig(resolvedConfig, validatedDraft);
  }, [resolvedConfig, validatedDraft]);

  const replaceProbe = useMemo(() => {
    if (!data || !validatedDraft) return null;
    return buildReplaceSequenceDraftEdit(data, validatedDraft, { selectedClipId, selectedClipIds });
  }, [data, selectedClipId, selectedClipIds, validatedDraft]);

  const replaceDisabledReason = useMemo(() => {
    if (!validatedDraft && !generatedComponent) {
      return selectedValidation && !selectedValidation.ok
        ? summarizeValidationErrors(selectedValidation.errors)
        : 'Generate or select a sequence first.';
    }
    if (!selectedClipId && (!selectedClipIds || selectedClipIds.size === 0)) {
      return 'Select a visual clip to replace.';
    }
    if (validatedDraft) {
      if (!replaceProbe) return 'Select a visual clip to replace.';
      return replaceProbe.ok ? null : formatEditError(replaceProbe.error);
    }
    return null;
  }, [generatedComponent, replaceProbe, selectedClipId, selectedClipIds, selectedValidation, validatedDraft]);

  const {
    isGenerating,
    runSequenceGeneration,
    handleConfirmFork,
    handleCancelFork,
  } = useSequenceGenerationActions({
    resolvedConfig,
    selectedMedia,
    attachmentSet,
    allowedAssets,
    allowedAssetKeys,
    selectedClipId,
    selectedClipIds,
  });

  const handleGenerate = useCallback(() => {
    void runSequenceGeneration(prompt);
  }, [prompt, runSequenceGeneration]);

  const persistGeneratedComponent = useSequenceComponentPersistence({ resolvedConfig });
  const [isSaving, setIsSaving] = useState(false);

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
  }, [selectedDraftIndex, selectedGroup]);

  // Resolve the draft to insert/replace with: prefer an explicit JSON
  // validated draft; otherwise persist the code-path generatedComponent and
  // synthesize a draft pointing at its DB resource.
  const resolveDraftForApply = useCallback(async ():
    Promise<{ ok: true; draft: ValidatedSequenceDraft } | { ok: false; error: string }> => {
    if (validatedDraft) return { ok: true, draft: validatedDraft };
    if (generatedComponent) return persistGeneratedComponent();
    return { ok: false, error: 'Generate a sequence first.' };
  }, [generatedComponent, persistGeneratedComponent, validatedDraft]);

  const handleInsert = useCallback(async () => {
    if (!data) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const resolved = await resolveDraftForApply();
      if (!resolved.ok) {
        setActionError(resolved.error);
        return;
      }
      const result = buildInsertSequenceDraftEdit(data, resolved.draft, {
        at: currentTime,
        selectedTrackId,
        extensionRecords: extensionClipTypeRecords,
      });
      if (!result.ok) {
        setActionError(formatEditError(result.error));
        return;
      }
      applyEdit(attachSequenceGenerationMetadata(
        result.mutation,
        result.clipId,
        buildSequenceGenerationMetadata(selectedGroup, selectedDraftIndex),
      ), {
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      requestCenterTimelineClip(result.selectedClipId);
      onOpenChange?.(false);
    } finally {
      setIsSaving(false);
    }
  }, [applyEdit, currentTime, data, extensionClipTypeRecords, onOpenChange, resolveDraftForApply, selectedDraftIndex, selectedGroup, selectedTrackId]);

  const handleReplace = useCallback(async () => {
    if (!data) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const resolved = await resolveDraftForApply();
      if (!resolved.ok) {
        setActionError(resolved.error);
        return;
      }
      const result = buildReplaceSequenceDraftEdit(data, resolved.draft, {
        selectedClipId,
        selectedClipIds,
        extensionRecords: extensionClipTypeRecords,
      });
      if (!result.ok) {
        setActionError(formatEditError(result.error));
        return;
      }
      applyEdit(attachSequenceGenerationMetadata(
        result.mutation,
        result.clipId,
        buildSequenceGenerationMetadata(selectedGroup, selectedDraftIndex),
      ), {
        selectedClipId: result.selectedClipId,
        selectedTrackId: result.selectedTrackId,
      });
      requestCenterTimelineClip(result.selectedClipId);
      onOpenChange?.(false);
    } finally {
      setIsSaving(false);
    }
  }, [applyEdit, data, extensionClipTypeRecords, onOpenChange, resolveDraftForApply, selectedClipId, selectedClipIds, selectedDraftIndex, selectedGroup]);

  const handleRemoveAllowedAsset = useCallback((asset: {
    clipId: string;
    url: string;
    mediaType: 'image' | 'video';
    generationId?: string;
  }) => {
    composerRemoveAttachment({
      clipId: asset.clipId,
      url: asset.url,
      mediaType: asset.mediaType,
      generationId: asset.generationId,
    });
  }, []);

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

  const insertDisabledReason = (!validatedDraft && !generatedComponent)
    ? (selectedValidation && !selectedValidation.ok
      ? summarizeValidationErrors(selectedValidation.errors)
      : 'Generate or select a sequence first.')
    : (!data ? 'Timeline unavailable.' : null);

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

  const handleLoadLibraryComponent = useCallback((resource: SequenceComponentResource) => {
    setGeneratedComponent({
      code: resource.code,
      name: resource.name,
      description: resource.description ?? '',
      schemaJson: resource.schemaJson,
      defaultsJson: resource.defaultsJson,
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
                  <SequenceCreatorLibraryList
                    libraryComponents={libraryComponents}
                    isLoading={libraryCatalog.isLoading}
                    onLoadLibraryComponent={handleLoadLibraryComponent}
                  />
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

                <SequenceCreatorAllowedAssets
                  allowedAssets={allowedAssets}
                  onRemoveAllowedAsset={handleRemoveAllowedAsset}
                  onRemoveAllowedShot={handleRemoveAllowedShot}
                />

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
                  <SequenceCreatorForkPrompt
                    forkPending={forkPending}
                    isGenerating={isGenerating}
                    onConfirmFork={() => void handleConfirmFork()}
                    onCancelFork={handleCancelFork}
                  />
                )}

                {generationNote && (
                  <div className="rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
                    {generationNote}
                  </div>
                )}

                {drafts.length > 1 && (
                  <SequenceCreatorDraftVariants
                    drafts={drafts}
                    selectedDraftIndex={selectedDraftIndex}
                    extensionClipTypeDescriptorMap={extensionClipTypeDescriptorMap}
                    onSelectDraftIndex={(index) => {
                      setSelectedDraftIndex(index);
                      setActionError(null);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="grid min-h-0 grid-rows-[minmax(180px,1fr)_minmax(0,360px)]">
              <div className="min-h-0 overflow-hidden bg-black">
                {previewConfig ? (
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
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Generate a sequence to preview it here.
                  </div>
                )}
              </div>

              <div className="flex max-h-[360px] min-h-0 flex-col border-t border-border">
                {(selectedDraft && (selectedMetadata || resolvedDescriptor)) || generatedComponent ? (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4">
                      <div className="space-y-4">
                        {selectedDraft && (selectedMetadata || resolvedDescriptor) ? (
                          <SequenceCreatorDraftParams
                            selectedDraft={selectedDraft}
                            selectedMetadata={selectedMetadata}
                            resolvedDescriptor={resolvedDescriptor}
                            selectedValidation={selectedValidation}
                            allowedRegistry={allowedRegistry}
                            updateSelectedDraft={updateSelectedDraft}
                          />
                        ) : generatedComponent ? (
                          <SequenceCreatorComponentControls
                            generatedComponent={generatedComponent}
                            allowedAssets={allowedAssets}
                            allowedAssetKeys={allowedAssetKeys}
                            setGeneratedComponent={setGeneratedComponent}
                          />
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
