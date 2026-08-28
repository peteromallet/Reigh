import { memo, useCallback, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import type { Shot } from '@/domains/generation/types/index.ts';
import { toast } from '@/shared/components/ui/runtime/sonner.tsx';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError.ts';
import { useProjectSelectionContext } from '@/shared/contexts/ProjectContext.tsx';
import { useShots } from '@/shared/contexts/ShotsContext.tsx';
import { useShotCreation } from '@/shared/hooks/shotCreation/useShotCreation.ts';
import { useShotNavigation } from '@/shared/hooks/shots/useShotNavigation.ts';
import { VideoGenerationModal } from '@/tools/travel-between-images/components/VideoGenerationModal.tsx';
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import { TimelineEditorCore, resolveSelectedGenerationIdsForShotCreation } from '@/tools/video-editor/components/TimelineEditor/TimelineEditorCore.tsx';
import { buildEmptyShotAnchorEdit } from '@/tools/video-editor/lib/shot-group-commands.ts';
import { useActiveTaskClips } from '@/tools/video-editor/hooks/useActiveTaskClips.ts';
import { useFinalVideoAvailable } from '@/tools/video-editor/hooks/useFinalVideoAvailable.ts';
import {
  usePinnedGroupSync,
  usePinnedShotGroups,
  usePinnedShotGroupViews,
} from '@/tools/video-editor/hooks/usePinnedShotGroups.ts';
import { useShotGroupHandlers } from '@/tools/video-editor/hooks/useShotGroupHandlers.ts';
import { useShotGroups } from '@/tools/video-editor/hooks/useShotGroups.ts';
import { useSwitchToFinalVideo } from '@/tools/video-editor/hooks/useSwitchToFinalVideo.ts';
import {
  useTimelineDataSelector,
  useTimelineChromeSelector,
  useTimelineConfigVersion,
  useTimelineOpsSelector,
} from '@/tools/video-editor/hooks/timelineStore.ts';
import { buildDuplicateClipEdit } from '@/tools/video-editor/lib/duplicate-clip.ts';
import { duplicateGenerationAsset } from '@/tools/video-editor/lib/generation-utils.ts';
import {
  duplicateShotGroup,
  promotePrimaryVariant,
} from '@/tools/video-editor/lib/shot-group-pack-commands.ts';
import type { ClipMeta } from '@/tools/video-editor/lib/timeline-data.ts';

interface ReighTimelineEditorProps {
  onOpenSequenceCreator?: () => void;
}

const EMPTY_ASSET_GENERATION_MAP: Record<string, string> = {};

function ReighTimelineEditorComponent({ onOpenSequenceCreator }: ReighTimelineEditorProps) {
  const [videoModalShot, setVideoModalShot] = useState<Shot | null>(null);
  const [videoModalShowImages, setVideoModalShowImages] = useState(false);
  const [duplicatingClipId, setDuplicatingClipId] = useState<string | null>(null);
  const { createShot, isCreating } = useShotCreation();
  const { navigateToShot } = useShotNavigation();
  const { selectedProjectId } = useProjectSelectionContext();
  const { shots } = useShots();
  const runtime = useVideoEditorRuntime();
  const isDocumentShotMode = runtime.userId === null;
  const configVersion = useTimelineConfigVersion();
  const reloadFromServer = useTimelineChromeSelector((chrome) => chrome.reloadFromServer);
  const {
    data,
    resolvedConfig,
    dataRef,
    selectedClipIds,
    interactionStateRef,
  } = useTimelineDataSelector((timeline) => ({
    data: timeline.data,
    resolvedConfig: timeline.resolvedConfig,
    dataRef: timeline.dataRef,
    selectedClipIds: timeline.selectedClipIds,
    interactionStateRef: timeline.interactionStateRef,
  }), shallow);
  const {
    applyEdit,
    patchRegistry,
    unpatchRegistry,
    registerAsset,
    registerGenerationAsset,
  } = useTimelineOpsSelector((ops) => ({
    applyEdit: ops.applyEdit,
    patchRegistry: ops.patchRegistry,
    unpatchRegistry: ops.unpatchRegistry,
    registerAsset: ops.registerAsset,
    registerGenerationAsset: ops.registerGenerationAsset,
  }), shallow);

  const assetGenerationMap = useMemo<Record<string, string>>(() => {
    const assets = data?.registry?.assets;
    if (!assets) {
      return EMPTY_ASSET_GENERATION_MAP;
    }

    return Object.entries(assets).reduce<Record<string, string>>((acc, [assetKey, assetEntry]) => {
      if (typeof assetEntry?.generationId === 'string' && assetEntry.generationId.length > 0) {
        acc[assetKey] = assetEntry.generationId;
      }
      return acc;
    }, {});
  }, [data?.registry?.assets]);

  const selectionShotCreationState = useMemo(() => {
    if (!data?.rows || !data?.meta) {
      return { canCreateShot: false, generationIds: [] as string[], orderedClipIds: [] as string[], trackId: undefined as string | undefined };
    }

    return resolveSelectedGenerationIdsForShotCreation({
      rows: data.rows,
      meta: data.meta,
      assetGenerationMap,
      selectedClipIds,
    });
  }, [assetGenerationMap, data?.meta, data?.rows, selectedClipIds]);

  const existingShotsForSelection = useMemo(() => {
    if (selectionShotCreationState.generationIds.length === 0 || !shots?.length) {
      return [] as Shot[];
    }

    return shots.filter((shot) => {
      const shotGenerationIds = new Set(
        (shot.images ?? [])
          .map((image) => image.generation_id)
          .filter((generationId): generationId is string => typeof generationId === 'string' && generationId.length > 0),
      );

      return selectionShotCreationState.generationIds.every((generationId) => shotGenerationIds.has(generationId));
    });
  }, [selectionShotCreationState.generationIds, shots]);

  const {
    pinGroup,
    unpinGroup,
  } = usePinnedShotGroups({
    dataRef,
    applyEdit,
  });

  const handleCreateShotFromSelection = useCallback(async (): Promise<Shot | null> => {
    if (!selectionShotCreationState.canCreateShot) {
      return null;
    }

    const trackId = selectionShotCreationState.trackId;
    const orderedClipIds = selectionShotCreationState.orderedClipIds;

    const result = await createShot({ generationIds: selectionShotCreationState.generationIds });
    if (result?.shot && trackId) {
      pinGroup(result.shot.id, trackId, orderedClipIds, result.shot.name);
    }
    if (result?.shot) {
      return result.shot;
    }
    return null;
  }, [createShot, pinGroup, selectionShotCreationState]);

  const handleCreateDocumentShotFromSelection = useCallback(async (): Promise<Shot | null> => {
    if (!selectionShotCreationState.canCreateShot) return null;
    const trackId = selectionShotCreationState.trackId;
    const orderedClipIds = selectionShotCreationState.orderedClipIds;
    if (!trackId) return null;
    const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
    pinGroup(`shot-${suffix}`, trackId, orderedClipIds, 'New shot');
    return null;
  }, [pinGroup, selectionShotCreationState]);

  const handleGenerateVideoFromSelection = useCallback(async () => {
    if (!selectionShotCreationState.canCreateShot) {
      return;
    }

    if (existingShotsForSelection.length === 1) {
      setVideoModalShot(existingShotsForSelection[0]);
      return;
    }

    const trackId = selectionShotCreationState.trackId;
    const orderedClipIds = selectionShotCreationState.orderedClipIds;

    const result = await createShot({ generationIds: selectionShotCreationState.generationIds });
    if (!result?.shotId) {
      return;
    }

    if (trackId) {
      pinGroup(result.shotId, trackId, orderedClipIds, result.shot?.name);
    }

    const createdShot = result.shot ?? shots?.find((shot) => shot.id === result.shotId) ?? null;
    if (createdShot) {
      setVideoModalShot(createdShot);
    }
  }, [createShot, existingShotsForSelection, pinGroup, selectionShotCreationState, shots]);

  const handleNavigateToShot = useCallback((shot: Shot) => {
    navigateToShot(shot, { isNewlyCreated: true });
  }, [navigateToShot]);

  const handleCreateEmptyShotAt = useCallback(async (anchor: { time: number; trackId?: string }): Promise<void> => {
    const current = dataRef.current;
    if (!current) return;

    const result = await createShot();
    if (!result?.shot) return;

    const anchorEdit = buildEmptyShotAnchorEdit(current, {
      shotId: result.shot.id,
      shotName: result.shotName ?? result.shot.name,
      time: anchor.time,
      preferredTrackId: anchor.trackId,
    });
    if (!anchorEdit) {
      normalizeAndPresentError(new Error('No visual track available for the new shot.'), {
        context: 'video-editor:create-empty-shot',
        toastTitle: 'Shot created but could not be placed on the timeline',
      });
      return;
    }

    applyEdit(anchorEdit.mutation, {
      selectedClipId: anchorEdit.clipId,
      selectedTrackId: anchorEdit.trackId,
      semantic: true,
    });
  }, [applyEdit, createShot, dataRef]);

  const handleOpenGenerateVideo = useCallback((shot: Shot) => {
    setVideoModalShot(shot);
  }, []);

  const { activeTaskAssetKeys } = useActiveTaskClips({ registry: resolvedConfig?.registry });
  const { finalVideoMap, dismissFinalVideo } = useFinalVideoAvailable();
  const documentShotGroups = usePinnedShotGroupViews(data);
  const shotGroups = useShotGroups(
    data?.rows ?? [],
    documentShotGroups,
  );

  const handleDuplicateDocumentShotGroup = useCallback(async (locator: { shotId: string; trackId: string }) => {
    const projectSlug = runtime.project.projectId;
    if (!projectSlug) {
      toast.error('Select an Astrid project before duplicating a shot.');
      return;
    }
    const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
    try {
      await duplicateShotGroup({
        projectSlug,
        timelineRef: runtime.timelineId,
        configVersion,
        source: locator,
        destinationShotId: `${locator.shotId}-copy-${suffix}`,
        destinationTrackId: locator.trackId,
      });
      await reloadFromServer();
      toast.success('Shot duplicated');
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'video-editor:duplicate-shot-group',
        toastTitle: 'Failed to duplicate shot',
      });
    }
  }, [configVersion, reloadFromServer, runtime.project.projectId, runtime.timelineId]);

  const handlePromoteDocumentShotGroupPrimary = useCallback(async (locator: { shotId: string; trackId: string }) => {
    const projectSlug = runtime.project.projectId;
    const group = shotGroups.find((candidate) => (
      candidate.shotId === locator.shotId && candidate.rowId === locator.trackId
    ));
    if (!projectSlug || !group) {
      toast.error('The active Astrid shot is unavailable.');
      return;
    }
    try {
      const client = new AstridLocalClient({
        projectSlug,
        baseUrl: (runtime.provider as { apiBaseUrl?: string }).apiBaseUrl,
      });
      const generationIds = Array.from(new Set([
        ...Object.keys(group.variantIdsByGenerationId),
        ...group.poolGenerationIds,
      ]));
      let candidate: { generationId: string; variantId: string } | null = null;
      for (const generationId of generationIds) {
        const detail = await client.gallery.get(generationId);
        const alternative = detail.variants.find((variant) => !variant.is_primary);
        if (alternative) {
          candidate = { generationId, variantId: alternative.id };
          break;
        }
      }
      if (!candidate) {
        toast.info('This shot has no alternate variant to promote.');
        return;
      }
      await promotePrimaryVariant({
        projectSlug,
        timelineRef: runtime.timelineId,
        configVersion,
        ...candidate,
      });
      await reloadFromServer();
      toast.success('Primary variant promoted');
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'video-editor:promote-shot-primary',
        toastTitle: 'Failed to promote primary variant',
      });
    }
  }, [configVersion, reloadFromServer, runtime.project.projectId, runtime.provider, runtime.timelineId, shotGroups]);
  const {
    switchToFinalVideo,
    updateToLatestVideo,
    switchToImages,
  } = useSwitchToFinalVideo({
    applyEdit,
    dataRef,
    finalVideoMap,
    patchRegistry,
    unpatchRegistry,
    registerAsset,
  });
  const {
    shotGroupClipIds,
    activeTaskClipIds,
    staleShotGroupIds,
    handleShotGroupNavigate,
    handleShotGroupGenerateVideo,
    handleDeleteShotGroup,
    handleUpdateToLatestVideo,
    handleShotGroupUnpin,
    handleShotGroupSwitchToFinalVideo,
    handleShotGroupSwitchToImages,
  } = useShotGroupHandlers({
    shots: isDocumentShotMode ? undefined : shots,
    shotGroups,
    data,
    resolvedRegistry: resolvedConfig?.registry,
    activeTaskAssetKeys,
    finalVideoMap,
    applyEdit,
    dataRef,
    dismissFinalVideo,
    switchToFinalVideo,
    switchToImages,
    updateToLatestVideo,
    unpinGroup,
    setVideoModalShot,
    setVideoModalShowImages,
  });

  const isInteractionActive = useCallback(() => {
    return interactionStateRef.current.drag || interactionStateRef.current.resize;
  }, [interactionStateRef]);

  usePinnedGroupSync({
    data,
    dataRef,
    applyEdit,
    shots: isDocumentShotMode ? undefined : shots,
    registerGenerationAsset,
    isInteractionActive,
  });

  const handleOpenShotVideoModal = useCallback((shotId: string) => {
    const shot = shots?.find((candidate) => candidate.id === shotId);
    if (shot) {
      setVideoModalShot(shot);
    }
  }, [shots]);

  const handleDuplicateGenerationClip = useCallback(async (clipId: string) => {
    if (!selectedProjectId) {
      toast.error('Select a project before duplicating a generation.');
      return;
    }

    const current = dataRef.current;
    if (!current) {
      return;
    }

    const clipMeta = current.meta[clipId];
    const assetKey = clipMeta?.asset;
    const assetEntry = assetKey ? current.registry.assets[assetKey] : undefined;
    const generationId = assetEntry?.generationId;
    if (!generationId) {
      toast.error('This clip is not linked to a generation.');
      return;
    }

    setDuplicatingClipId(clipId);
    try {
      const duplicatedGeneration = await duplicateGenerationAsset({
        generationId,
        projectId: selectedProjectId,
      });
      const duplicatedAssetKey = registerGenerationAsset({
        generationId: duplicatedGeneration.generationId,
        variantId: duplicatedGeneration.variantId,
        variantType: duplicatedGeneration.variantType,
        imageUrl: duplicatedGeneration.imageUrl,
        thumbUrl: duplicatedGeneration.thumbUrl,
        durationSeconds: typeof assetEntry?.duration === 'number' ? assetEntry.duration : undefined,
        metadata: {
          content_type: assetEntry?.type ?? (
            duplicatedGeneration.variantType === 'video' ? 'video/mp4' : 'image/png'
          ),
        },
      });

      if (!duplicatedAssetKey) {
        throw new Error('Failed to register the duplicated asset.');
      }

      const nextCurrent = dataRef.current;
      if (!nextCurrent) {
        throw new Error('Timeline state was unavailable after registering the duplicated asset.');
      }

      const duplicateEdit = buildDuplicateClipEdit(nextCurrent, clipId, duplicatedAssetKey);
      if (!duplicateEdit) {
        throw new Error('Failed to insert the duplicated clip on the timeline.');
      }

      applyEdit({
        type: 'rows',
        rows: duplicateEdit.rows,
        metaUpdates: duplicateEdit.metaUpdates as Record<string, Partial<ClipMeta>>,
        clipOrderOverride: duplicateEdit.clipOrderOverride,
      }, {
        selectedClipId: duplicateEdit.clipId,
        selectedTrackId: duplicateEdit.trackId,
        semantic: true,
      });
    } catch (error) {
      normalizeAndPresentError(error, {
        context: 'video-editor:duplicate-generation-clip',
        toastTitle: 'Failed to duplicate generation',
      });
    } finally {
      setDuplicatingClipId((currentClipId) => (currentClipId === clipId ? null : currentClipId));
    }
  }, [applyEdit, dataRef, registerGenerationAsset, selectedProjectId]);

  return (
    <>
      <TimelineEditorCore
        onOpenSequenceCreator={onOpenSequenceCreator}
        finalVideoMap={finalVideoMap}
        shotGroups={shotGroups}
        staleShotGroupIds={staleShotGroupIds}
        activeTaskClipIds={activeTaskClipIds}
        shotGroupClipIds={shotGroupClipIds}
        onShotGroupNavigate={isDocumentShotMode ? undefined : handleShotGroupNavigate}
        onShotGroupGenerateVideo={isDocumentShotMode ? undefined : handleShotGroupGenerateVideo}
        onShotGroupDuplicate={isDocumentShotMode ? handleDuplicateDocumentShotGroup : undefined}
        onShotGroupPromotePrimary={isDocumentShotMode ? handlePromoteDocumentShotGroupPrimary : undefined}
        onShotGroupUnpin={handleShotGroupUnpin}
        onShotGroupDelete={handleDeleteShotGroup}
        onShotGroupSwitchToFinalVideo={handleShotGroupSwitchToFinalVideo}
        onShotGroupSwitchToImages={handleShotGroupSwitchToImages}
        onShotGroupUpdateToLatestVideo={handleUpdateToLatestVideo}
        canCreateShotFromSelection={selectionShotCreationState.canCreateShot}
        existingShots={isDocumentShotMode ? [] : existingShotsForSelection}
        onCreateShotFromSelection={isDocumentShotMode ? handleCreateDocumentShotFromSelection : handleCreateShotFromSelection}
        onGenerateVideoFromSelection={isDocumentShotMode ? undefined : handleGenerateVideoFromSelection}
        onNavigateToShot={isDocumentShotMode ? undefined : handleNavigateToShot}
        onOpenGenerateVideo={isDocumentShotMode ? undefined : handleOpenGenerateVideo}
        isCreatingShot={isDocumentShotMode ? false : isCreating}
        onCreateEmptyShotAt={handleCreateEmptyShotAt}
        duplicatingClipId={duplicatingClipId}
        onDuplicateGenerationClip={handleDuplicateGenerationClip}
        onOpenShotVideoModal={isDocumentShotMode ? undefined : handleOpenShotVideoModal}
      />

      {!isDocumentShotMode && videoModalShot && (
        <VideoGenerationModal
          isOpen={true}
          onClose={() => { setVideoModalShot(null); setVideoModalShowImages(false); }}
          shot={videoModalShot}
          defaultTopOpen={videoModalShowImages}
        />
      )}
    </>
  );
}

export const ReighTimelineEditor = memo(ReighTimelineEditorComponent);
