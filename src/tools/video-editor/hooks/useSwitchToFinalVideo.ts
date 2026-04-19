import { useCallback } from 'react';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { generateUUID } from '@/shared/lib/taskCreation/ids';
import {
  buildFinalVideoAssetEntry,
  resolveFinalVideoDurationSeconds,
} from '@/tools/video-editor/lib/finalVideoAssets';
import { getPinnedShotGroups } from '@/tools/video-editor/lib/config-utils';
import {
  buildSwitchShotGroupToFinalVideoMutation,
  buildSwitchShotGroupToImagesMutation,
  buildUpdateShotGroupToLatestVideoMutation,
} from '@/tools/video-editor/lib/shot-group-commands';
import { findGroupForTrack, resolveGroupTrackId } from '@/tools/video-editor/lib/pinned-group-projection';
import type {
  TimelineApplyEdit,
  TimelineDataRef,
  TimelinePatchRegistry,
  TimelineRegisterAsset,
  TimelineUnpatchRegistry,
} from '@/tools/video-editor/hooks/timeline-state-types';
import type { ShotFinalVideo } from '@/tools/video-editor/hooks/useFinalVideoAvailable';

interface UseSwitchToFinalVideoArgs {
  applyEdit: TimelineApplyEdit;
  dataRef: TimelineDataRef;
  finalVideoMap: Map<string, ShotFinalVideo>;
  patchRegistry: TimelinePatchRegistry;
  unpatchRegistry: TimelineUnpatchRegistry;
  registerAsset: TimelineRegisterAsset;
}

function registerFinalVideoAsset(
  finalVideo: ShotFinalVideo,
  currentData: TimelineDataRef['current'],
  patchRegistry: TimelinePatchRegistry,
  registerAsset: TimelineRegisterAsset,
): Promise<{ assetKey: string; durationSeconds: number | null; persistPromise: Promise<void> }> {
  return (async () => {
    const durationSeconds = await resolveFinalVideoDurationSeconds(finalVideo, currentData?.registry.assets);
    const assetKey = generateUUID();
    const assetEntry = buildFinalVideoAssetEntry(finalVideo, durationSeconds);
    patchRegistry(assetKey, assetEntry, finalVideo.location);
    return {
      assetKey,
      durationSeconds,
      persistPromise: registerAsset(assetKey, assetEntry),
    };
  })();
}

function buildRestoreShotGroupVideoMutation({
  currentData,
  shotId,
  rowId,
  assetKey,
  targetGenerationId,
}: {
  currentData: TimelineDataRef['current'];
  shotId: string;
  rowId: string;
  assetKey: string;
  targetGenerationId?: string;
}) {
  if (targetGenerationId) {
    const rollbackMutation = buildUpdateShotGroupToLatestVideoMutation({
      currentData,
      shotId,
      rowId,
      assetKey,
      targetGenerationId,
    });
    if (rollbackMutation) {
      return rollbackMutation;
    }
  }

  if (!currentData) {
    return null;
  }

  const pinnedShotGroups = getPinnedShotGroups(currentData.config) ?? [];
  const foundGroup = findGroupForTrack(pinnedShotGroups, shotId, rowId, currentData.rows);
  const pinnedGroup = foundGroup?.mode === 'video' && typeof foundGroup.videoAssetKey === 'string' && foundGroup.videoAssetKey.length > 0
    ? foundGroup
    : undefined;
  const resolvedTrackId = pinnedGroup ? resolveGroupTrackId(pinnedGroup, currentData.rows) : rowId;
  const videoClipId = pinnedGroup?.clipIds[0];
  const hasVideoClip = Boolean(
    videoClipId
    && currentData.rows.find((row) => row.id === resolvedTrackId)?.actions.some((action) => action.id === videoClipId)
    && currentData.meta[videoClipId],
  );
  if (!pinnedGroup || !videoClipId || !hasVideoClip) {
    return null;
  }

  return {
    type: 'rows' as const,
    rows: currentData.rows,
    metaUpdates: {
      [videoClipId]: {
        asset: assetKey,
      },
    },
    pinnedShotGroupsOverride: pinnedShotGroups.map((group) => (
      group === pinnedGroup
        ? { ...group, trackId: resolvedTrackId, videoAssetKey: assetKey }
        : group
    )),
  };
}

export function useSwitchToFinalVideo({
  applyEdit,
  dataRef,
  finalVideoMap,
  patchRegistry,
  unpatchRegistry,
  registerAsset,
}: UseSwitchToFinalVideoArgs) {
  const switchToFinalVideo = useCallback(async ({ shotId, clipIds, rowId }: { shotId: string; clipIds: string[]; rowId: string }) => {
    const finalVideo = finalVideoMap.get(shotId);
    if (!finalVideo) {
      return;
    }

    const { assetKey, durationSeconds, persistPromise } = await registerFinalVideoAsset(
      finalVideo,
      dataRef.current,
      patchRegistry,
      registerAsset,
    );
    const mutation = buildSwitchShotGroupToFinalVideoMutation({
      currentData: dataRef.current,
      shotId,
      rowId,
      clipIds,
      assetKey,
      durationSeconds,
    });
    if (!mutation) {
      void persistPromise.catch((error) => {
        console.error('[TimelineEditor] Failed to persist final video asset:', error);
        unpatchRegistry(assetKey);
        toast.error('Failed to save asset');
      });
      return;
    }

    applyEdit(mutation);
    void persistPromise.catch((error) => {
      console.error('[TimelineEditor] Failed to persist final video asset:', error);
      const rollbackMutation = buildSwitchShotGroupToImagesMutation({
        currentData: dataRef.current,
        shotId,
        rowId,
      });
      if (rollbackMutation) {
        applyEdit(rollbackMutation);
      }
      unpatchRegistry(assetKey);
      toast.error('Failed to save asset');
    });
  }, [applyEdit, dataRef, finalVideoMap, patchRegistry, registerAsset, unpatchRegistry]);

  const updateToLatestVideo = useCallback(async ({ shotId, rowId }: { shotId: string; rowId: string }) => {
    const finalVideo = finalVideoMap.get(shotId);
    if (!finalVideo) {
      return;
    }

    const currentGroup = dataRef.current
      ? findGroupForTrack(getPinnedShotGroups(dataRef.current.config) ?? [], shotId, rowId, dataRef.current.rows)
      : undefined;
    const oldVideoAssetKey = currentGroup?.mode === 'video' ? currentGroup.videoAssetKey : undefined;
    const oldVideoGenerationId = oldVideoAssetKey
      ? dataRef.current?.registry.assets[oldVideoAssetKey]?.generationId
      : undefined;
    const { assetKey, durationSeconds, persistPromise } = await registerFinalVideoAsset(
      finalVideo,
      dataRef.current,
      patchRegistry,
      registerAsset,
    );
    const mutation = buildUpdateShotGroupToLatestVideoMutation({
      currentData: dataRef.current,
      shotId,
      rowId,
      assetKey,
      targetGenerationId: finalVideo.id,
      durationSeconds,
    });
    if (!mutation) {
      void persistPromise.catch((error) => {
        console.error('[TimelineEditor] Failed to persist final video asset:', error);
        unpatchRegistry(assetKey);
        toast.error('Failed to save asset');
      });
      return;
    }

    applyEdit(mutation);
    void persistPromise.catch((error) => {
      console.error('[TimelineEditor] Failed to persist final video asset:', error);
      const rollbackMutation = oldVideoAssetKey
        ? buildRestoreShotGroupVideoMutation({
            currentData: dataRef.current,
            shotId,
            rowId,
            assetKey: oldVideoAssetKey,
            targetGenerationId: oldVideoGenerationId,
          })
        : null;
      if (rollbackMutation) {
        applyEdit(rollbackMutation);
      }
      unpatchRegistry(assetKey);
      toast.error('Failed to save asset');
    });
  }, [applyEdit, dataRef, finalVideoMap, patchRegistry, registerAsset, unpatchRegistry]);

  const switchToImages = useCallback(({ shotId, rowId }: { shotId: string; rowId: string }) => {
    const mutation = buildSwitchShotGroupToImagesMutation({
      currentData: dataRef.current,
      shotId,
      rowId,
    });
    if (!mutation) {
      return;
    }

    applyEdit(mutation);
  }, [applyEdit, dataRef]);

  return {
    switchToFinalVideo,
    updateToLatestVideo,
    switchToImages,
  };
}
