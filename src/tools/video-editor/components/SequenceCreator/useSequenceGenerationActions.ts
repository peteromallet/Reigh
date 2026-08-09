import { useCallback, useRef, useState } from 'react';
import { toast } from '@/shared/components/ui/toast.tsx';
import type { SelectedMediaClip } from '@/tools/video-editor/hooks/useSelectedMediaClips.ts';
import type { useTimelineEditorData } from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  createDraftGroupId,
  nameDraftGroupFromPrompt,
  type AllowedSequenceAsset,
  type SequenceCreatorMode,
  type SequenceDraftGroup,
} from '@/tools/video-editor/sequences/generation.ts';
import { useSequenceCreatorStore } from '@/tools/video-editor/state/sequenceCreatorStore.ts';
import { getBundledComponentSource } from '@/tools/video-editor/sequences/getBundledComponentSource.ts';
import { getClipCapabilityDescriptor } from '@/tools/video-editor/sequences/registry.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import {
  runSequenceComponentGenerationRequest,
  runSequenceGenerationRequest,
} from './sequenceGenerationService.ts';

/**
 * Sequence Creator generation lifecycle: the prompt -> classifier -> JSON-or-code
 * routing, and the fork-to-DB confirmation that gates the code path for
 * theme-bundled clips. Owns the in-flight request state (transient by design:
 * a request from before unmount/reload is gone afterward).
 */
export function useSequenceGenerationActions({
  resolvedConfig,
  selectedMedia,
  attachmentSet,
  allowedAssets,
  allowedAssetKeys,
  selectedClipId,
  selectedClipIds,
}: {
  resolvedConfig: ResolvedTimelineConfig | null | undefined;
  selectedMedia: { clips: SelectedMediaClip[] };
  attachmentSet: { clips: SelectedMediaClip[] };
  allowedAssets: AllowedSequenceAsset[];
  allowedAssetKeys: string[];
  selectedClipId: ReturnType<typeof useTimelineEditorData>['selectedClipId'];
  selectedClipIds: ReturnType<typeof useTimelineEditorData>['selectedClipIds'];
}) {
  const abortRef = useRef<AbortController | null>(null);

  const setMode = useSequenceCreatorStore((s) => s.setMode);
  const generationMode = useSequenceCreatorStore((s) => s.generationMode);
  const setDraftGroups = useSequenceCreatorStore((s) => s.setDraftGroups);
  const setSelectedGroupId = useSequenceCreatorStore((s) => s.setSelectedGroupId);
  const setSelectedDraftIndex = useSequenceCreatorStore((s) => s.setSelectedDraftIndex);
  const setGenerationNote = useSequenceCreatorStore((s) => s.setGenerationNote);
  const setActionError = useSequenceCreatorStore((s) => s.setActionError);
  const setClassifierVerdict = useSequenceCreatorStore((s) => s.setClassifierVerdict);
  const forkPending = useSequenceCreatorStore((s) => s.forkPending);
  const setForkPending = useSequenceCreatorStore((s) => s.setForkPending);
  const setGeneratedComponent = useSequenceCreatorStore((s) => s.setGeneratedComponent);
  const setGeneratedComponentSourceClipType = useSequenceCreatorStore((s) => s.setGeneratedComponentSourceClipType);

  // Transient request lifecycle — deliberately NOT lifted to the store.
  // An in-flight request from before unmount/reload is gone afterward.
  const [isGenerating, setIsGenerating] = useState(false);

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
          setActionError(codeResult.error);
          setGenerationNote(`Code-path generation failed: ${codeResult.error}`);
          return;
        }
        setClassifierVerdict({ path: 'code', reason: 'Custom animation mode (forced).' });
        setGeneratedComponent({
          code: codeResult.code,
          name: codeResult.name,
          description: codeResult.description,
          schemaJson: codeResult.schemaJson,
          defaultsJson: codeResult.defaultsJson,
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
          setActionError(codeResult.error);
          setGenerationNote(`Code-path generation failed: ${codeResult.error}`);
          return;
        }
        setGeneratedComponent({
          code: codeResult.code,
          name: codeResult.name,
          description: codeResult.description,
          schemaJson: codeResult.schemaJson,
          defaultsJson: codeResult.defaultsJson,
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
    // Store actions below are stable for the store's lifetime; listed to
    // satisfy exhaustive-deps without widening the strict-lint allowlist.
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
        setActionError(codeResult.error);
        setGenerationNote(`Fork failed: ${codeResult.error}`);
        return;
      }
      setGeneratedComponent({
        code: codeResult.code,
        name: codeResult.name,
        description: codeResult.description,
        schemaJson: codeResult.schemaJson,
        defaultsJson: codeResult.defaultsJson,
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

  return {
    isGenerating,
    runSequenceGeneration,
    handleConfirmFork,
    handleCancelFork,
  };
}
