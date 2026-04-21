import {
  useEffect,
  useRef,
} from 'react';
import {
  usePollSync,
  useTimelinePersistence,
  type UsePollSyncQueries,
} from '@tbd/editor';
import type { InteractionStateRef } from '@/tools/video-editor/lib/interaction-state';
import { useTimelineCommit } from '@/tools/video-editor/hooks/useTimelineCommit';
import { TimelineEventBus } from '@/tools/video-editor/hooks/useTimelineEventBus';
import type { TimelineStoreApi } from '@tbd/editor';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
export { shouldAcceptPolledData } from '@/tools/video-editor/lib/timeline-save-utils';
export type { SaveStatus } from '@tbd/editor';

type UseTimelineSaveQueries = UsePollSyncQueries;

export type { InteractionStateRef } from '@/tools/video-editor/lib/interaction-state';

export function useTimelineSave(
  queries: UseTimelineSaveQueries,
  provider: DataProvider,
  interactionStateRef: InteractionStateRef,
  store: TimelineStoreApi,
) {
  const { timelineId } = useVideoEditorRuntime();
  const lastSavedSignatureRef = useRef('');
  const savedSeqRef = useRef(0);
  const configVersionRef = useRef(1);
  const eventBusRef = useRef(new TimelineEventBus());
  const commit = useTimelineCommit({
    eventBus: eventBusRef.current,
    lastSavedSignatureRef,
  });
  const persistence = useTimelinePersistence({
    store,
    provider,
    timelineId,
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
  } as never);

  useEffect(() => {
    return eventBusRef.current.on('scheduleSave', persistence.scheduleSave as never);
  }, [persistence.scheduleSave]);

  usePollSync({
    store,
    queries,
    provider,
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
    interactionStateRef,
  } as never);

  return {
    data: commit.data,
    dataRef: commit.dataRef,
    isConflictExhausted: persistence.isConflictExhausted,
    selectedClipId: commit.selectedClipId,
    selectedTrackId: commit.selectedTrackId,
    saveStatus: persistence.saveStatus,
    setSelectedClipId: commit.setSelectedClipId,
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
  };
}
