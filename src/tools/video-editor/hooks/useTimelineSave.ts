import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { InteractionStateRef } from '@/tools/video-editor/lib/interaction-state.ts';
import { useTimelineCommit } from '@/tools/video-editor/hooks/useTimelineCommit.ts';
import { TimelineEventBus } from '@/tools/video-editor/hooks/useTimelineEventBus.ts';
import { useTimelinePersistence } from '@/tools/video-editor/hooks/useTimelinePersistence.ts';
import { clearTimelineDraft, loadTimelineDraft } from '@/tools/video-editor/data/timelineDraftIndexedDb.ts';
import { buildTimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import { usePollSync, type UsePollSyncQueries } from '@/tools/video-editor/hooks/usePollSync.ts';
import type { TimelineStoreApi } from '@/tools/video-editor/hooks/timelineStore.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider.ts';
export { shouldAcceptPolledData } from '@/tools/video-editor/lib/timeline-save-utils.ts';
export type { SaveStatus } from '@/tools/video-editor/hooks/useTimelinePersistence.ts';

type UseTimelineSaveQueries = UsePollSyncQueries;

export type { InteractionStateRef } from '@/tools/video-editor/lib/interaction-state.ts';

export function useTimelineSave(
  queries: UseTimelineSaveQueries,
  provider: DataProvider,
  interactionStateRef: InteractionStateRef,
  store: TimelineStoreApi,
) {
  const { timelineId, assetResolver } = useVideoEditorRuntime();
  const resolveAssetUrl = useCallback((file: string) => {
    if (assetResolver) {
      return Promise.resolve(assetResolver.resolveAssetUrl(file));
    }

    return provider.resolveAssetUrl(file);
  }, [assetResolver, provider]);
  const lastSavedSignatureRef = useRef('');
  const savedSeqRef = useRef(0);
  // Start at 0 so a fresh bridge timeline (config_version 0) is not rejected
  // as "stale" by the poll gate (polled < current). The bridge CAS is strict
  // equality, so the first save POSTs expected_version 0 and succeeds.
  const configVersionRef = useRef(0);
  const eventBusRef = useRef(new TimelineEventBus());
  const commit = useTimelineCommit({
    eventBus: eventBusRef.current,
    lastSavedSignatureRef,
  });
  const persistence = useTimelinePersistence({
    store,
    provider,
    timelineId,
    resolveAssetUrl,
    eventBus: eventBusRef.current,
    dataRef: commit.dataRef,
    commitData: commit.commitData,
    selectedClipIdRef: commit.selectedClipIdRef,
    selectedTrackIdRef: commit.selectedTrackIdRef,
    editSeqRef: commit.editSeqRef,
    savedSeqRef,
    configVersionRef,
    lastSavedSignatureRef,
    interactionStateRef,
  });

  useEffect(() => {
    return eventBusRef.current.on('scheduleSave', persistence.scheduleSave);
  }, [persistence.scheduleSave]);

  usePollSync({
    store,
    queries,
    provider,
    resolveAssetUrl,
    commitData: commit.commitData,
    dataRef: commit.dataRef,
    selectedClipIdRef: commit.selectedClipIdRef,
    selectedTrackIdRef: commit.selectedTrackIdRef,
    editSeqRef: commit.editSeqRef,
    pendingOpsRef: commit.pendingOpsRef,
    savedSeqRef,
    configVersionRef,
    lastSavedSignatureRef,
    isSavingRef: persistence.isSavingRef,
    isConflictExhaustedRef: persistence.isConflictExhaustedRef,
    interactionStateRef,
  });

  // One-slot recovery draft (plan-v5 B9): after the timeline data loads, offer
  // any draft left by a crash / offline edit / save-as-copy. Offered once per
  // mount; the shell renders Retry / Discard.
  const [recoveryDraft, setRecoveryDraft] = useState<{
    updatedAt: string;
    baseVersion: number;
  } | null>(null);
  const recoveryOfferedRef = useRef(false);

  useEffect(() => {
    if (recoveryOfferedRef.current || !commit.data) {
      return;
    }
    let cancelled = false;
    // Best-effort: IndexedDB unavailable (private mode) or a corrupt store
    // simply means no recovery offer; never an unhandled rejection.
    void loadTimelineDraft(timelineId)
      .then((record) => {
        if (cancelled || !record) {
          return;
        }
        recoveryOfferedRef.current = true;
        setRecoveryDraft({ updatedAt: record.updatedAt, baseVersion: record.baseVersion });
      })
      .catch(() => {
        // no recovery offer
      });
    return () => {
      cancelled = true;
    };
  }, [commit.data, timelineId]);

  const retryRecoveredDraft = useCallback(async () => {
    let record: Awaited<ReturnType<typeof loadTimelineDraft>>;
    try {
      record = await loadTimelineDraft(timelineId);
    } catch {
      setRecoveryDraft(null);
      return;
    }
    if (!record) {
      setRecoveryDraft(null);
      return;
    }
    const draft = record.draft as { config?: TimelineConfig; registry?: AssetRegistry };
    if (!draft.config || !commit.data) {
      setRecoveryDraft(null);
      return;
    }
    const recovered = await buildTimelineData(
      draft.config,
      draft.registry ?? { assets: {} },
      resolveAssetUrl ?? ((file) => provider.resolveAssetUrl(file)),
      record.baseVersion,
    );
    await clearTimelineDraft(timelineId);
    setRecoveryDraft(null);
    commit.commitData(recovered, { save: true });
  }, [commit, provider, resolveAssetUrl, timelineId]);

  const discardRecoveredDraft = useCallback(async () => {
    try {
      await clearTimelineDraft(timelineId);
    } catch {
      // Best-effort; the offer disappears either way.
    }
    setRecoveryDraft(null);
  }, [timelineId]);

  return {
    data: commit.data,
    dataRef: commit.dataRef,
    isConflictExhausted: persistence.isConflictExhausted,
    selectedClipId: commit.selectedClipId,
    selectedTrackId: commit.selectedTrackId,
    saveStatus: persistence.saveStatus,
    setSelectedTrackId: commit.setSelectedTrackId,
    applyEdit: commit.applyEdit,
    patchRegistry: commit.patchRegistry,
    unpatchRegistry: commit.unpatchRegistry,
    commitData: commit.commitData,
    eventBus: eventBusRef.current,
    reloadFromServer: persistence.reloadFromServer,
    retrySaveAfterConflict: persistence.retrySaveAfterConflict,
    editSeqRef: commit.editSeqRef,
    pendingOpsRef: commit.pendingOpsRef,
    savedSeqRef,
    selectedClipIdRef: commit.selectedClipIdRef,
    selectedTrackIdRef: commit.selectedTrackIdRef,
    isLoading: queries.timelineQuery.isLoading && !commit.data,
    watchdogTripped: persistence.watchdogTripped,
    watchdogReason: persistence.watchdogReason,
    retryWatchdog: persistence.retryWatchdog,
    recoveryDraft,
    retryRecoveredDraft,
    discardRecoveredDraft,
  };
}
