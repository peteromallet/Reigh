import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { isInteractionActive, onInteractionEnd, type InteractionStateRef } from '../lib/interaction-state.js';
import { shouldAcceptPolledData } from '../lib/timeline-save-utils.js';
import { buildTimelineData, preserveUploadingClips } from '../lib/timeline-data.js';
import type { DataProvider } from '../data/DataProvider.js';
import type { CommitDataOptions } from './timeline-commit-types.js';
import type { TimelineStoreApi } from './timelineStore.js';
import type { TimelineData } from '../types.js';

const TIMELINE_SYNC_LOG_TAG = '[TimelineSync]';

type PollCheckPhase = 'preflight' | 'timeout';
type ConfigVersionUpdateSource = 'poll';

export interface UsePollSyncQueries {
  timelineQuery: {
    data: TimelineData | undefined;
    isLoading: boolean;
  };
  assetRegistryQuery: {
    data: Awaited<ReturnType<DataProvider['loadAssetRegistry']>> | undefined;
  };
}

interface TimelinePollGate {
  editSeq: number;
  savedSeq: number;
  pendingOps: number;
  isSaving: boolean;
  interactionActive?: boolean;
}

export interface PollRejectionInput extends TimelinePollGate {
  polledConfigVersion: number;
  currentConfigVersion: number;
  polledStableSignature: string;
  lastSavedStableSignature: string;
}

export interface UsePollSyncOptions {
  store?: TimelineStoreApi;
  queries: UsePollSyncQueries;
  provider: DataProvider;
  commitData: (nextData: TimelineData, options?: CommitDataOptions) => void;
  dataRef: MutableRefObject<TimelineData | null>;
  selectedClipIdRef: MutableRefObject<string | null>;
  selectedTrackIdRef: MutableRefObject<string | null>;
  editSeqRef: MutableRefObject<number>;
  pendingOpsRef: MutableRefObject<number>;
  savedSeqRef: MutableRefObject<number>;
  configVersionRef: MutableRefObject<number>;
  lastSavedSignatureRef: MutableRefObject<string>;
  isSavingRef: MutableRefObject<boolean>;
  interactionStateRef: InteractionStateRef;
}

export function isTimelinePollIdle({
  editSeq,
  savedSeq,
  pendingOps,
  isSaving,
  interactionActive,
}: TimelinePollGate): boolean {
  if (interactionActive) {
    return false;
  }

  return savedSeq >= editSeq && !isSaving && pendingOps === 0;
}

export function getTimelinePollRejectionReason({
  editSeq,
  savedSeq,
  pendingOps,
  isSaving,
  interactionActive,
  polledConfigVersion,
  currentConfigVersion,
  polledStableSignature,
  lastSavedStableSignature,
}: PollRejectionInput): string | null {
  if (!isTimelinePollIdle({ editSeq, savedSeq, pendingOps, isSaving, interactionActive })) {
    if (interactionActive) {
      return 'interaction active';
    }

    if (savedSeq < editSeq) {
      return 'unsaved edits';
    }

    if (pendingOps > 0) {
      return 'pending ops';
    }

    if (isSaving) {
      return 'saving';
    }

    return 'busy';
  }

  if (polledConfigVersion < currentConfigVersion) {
    return 'stale version';
  }

  if (
    !shouldAcceptPolledData(
      editSeq,
      savedSeq,
      pendingOps,
      polledStableSignature,
      lastSavedStableSignature,
    )
  ) {
    return polledConfigVersion === currentConfigVersion ? 'own echo' : 'signature match';
  }

  return null;
}

export function usePollSync({
  store,
  queries,
  provider,
  commitData,
  dataRef,
  selectedClipIdRef,
  selectedTrackIdRef,
  editSeqRef,
  pendingOpsRef,
  savedSeqRef,
  configVersionRef,
  lastSavedSignatureRef,
  isSavingRef,
  interactionStateRef,
}: UsePollSyncOptions): void {
  const lastRegistryDataRef = useRef<Awaited<ReturnType<DataProvider['loadAssetRegistry']>> | null>(null);
  const commitDataRef = useRef(commitData);
  const deferredPolledDataRef = useRef<TimelineData | null>(null);
  const [interactionEndTick, setInteractionEndTick] = useState(0);

  const getDataRef = useCallback(() => {
    const storeDataRef = store?.getState().data.dataRef;
    return storeDataRef && storeDataRef.current !== null ? storeDataRef : dataRef;
  }, [dataRef, store]);

  const getPendingOpsRef = useCallback(() => {
    const storePendingOpsRef = store?.getState().data.pendingOpsRef;
    return storePendingOpsRef ? storePendingOpsRef : pendingOpsRef;
  }, [pendingOpsRef, store]);

  const getInteractionStateRef = useCallback(() => {
    const storeInteractionStateRef = store?.getState().data.interactionStateRef;
    return storeInteractionStateRef ? storeInteractionStateRef : interactionStateRef;
  }, [interactionStateRef, store]);

  useLayoutEffect(() => {
    commitDataRef.current = commitData;
  }, [commitData]);

  useEffect(() => {
    const polledVersion = queries.timelineQuery.data?.configVersion;
    if (queries.timelineQuery.data && typeof polledVersion === 'number' && polledVersion > configVersionRef.current) {
      configVersionRef.current = polledVersion;
    }
  }, [configVersionRef, queries.timelineQuery.data]);

  const logTimelineSync = useCallback((message: string, details?: Record<string, unknown>) => {
    console.log(TIMELINE_SYNC_LOG_TAG, message, details);
  }, []);

  const logConfigVersionUpdate = useCallback((source: ConfigVersionUpdateSource, nextVersion: number) => {
    if (configVersionRef.current === nextVersion) {
      return;
    }

    console.log(TIMELINE_SYNC_LOG_TAG, 'configVersionRef updated', {
      source,
      from: configVersionRef.current,
      to: nextVersion,
    });
  }, [configVersionRef]);

  const getPollRejectionReason = useCallback((polledData: TimelineData): string | null => {
    return getTimelinePollRejectionReason({
      editSeq: editSeqRef.current,
      savedSeq: savedSeqRef.current,
      pendingOps: getPendingOpsRef().current,
      isSaving: isSavingRef.current,
      interactionActive: isInteractionActive(getInteractionStateRef()),
      polledConfigVersion: polledData.configVersion,
      currentConfigVersion: configVersionRef.current,
      polledStableSignature: polledData.stableSignature,
      lastSavedStableSignature: lastSavedSignatureRef.current,
    });
  }, [
    configVersionRef,
    editSeqRef,
    getInteractionStateRef,
    getPendingOpsRef,
    isSavingRef,
    lastSavedSignatureRef,
    savedSeqRef,
  ]);

  const logPollRejection = useCallback((phase: PollCheckPhase, polledData: TimelineData, reason: string) => {
    logTimelineSync('poll rejected', {
      phase,
      reason,
      polledConfigVersion: polledData.configVersion,
      currentConfigVersion: configVersionRef.current,
      editSeq: editSeqRef.current,
      savedSeq: savedSeqRef.current,
      pendingOps: getPendingOpsRef().current,
      isSaving: isSavingRef.current,
    });
  }, [configVersionRef, editSeqRef, getPendingOpsRef, isSavingRef, logTimelineSync, savedSeqRef]);

  useEffect(() => {
    return onInteractionEnd(getInteractionStateRef(), () => {
      setInteractionEndTick((tick) => tick + 1);
    });
  }, [getInteractionStateRef]);

  useEffect(() => {
    const polledData = deferredPolledDataRef.current ?? queries.timelineQuery.data;
    if (!polledData) {
      return;
    }

    const preflightRejectionReason = getPollRejectionReason(polledData);
    if (preflightRejectionReason) {
      if (preflightRejectionReason === 'interaction active') {
        deferredPolledDataRef.current = polledData;
      }
      logPollRejection('preflight', polledData, preflightRejectionReason);
      return;
    }

    deferredPolledDataRef.current = null;

    const syncHandle = window.setTimeout(() => {
      const timeoutRejectionReason = getPollRejectionReason(polledData);
      if (timeoutRejectionReason) {
        logPollRejection('timeout', polledData, timeoutRejectionReason);
        return;
      }

      if (configVersionRef.current !== polledData.configVersion) {
        logTimelineSync('poll accepted', {
          fromConfigVersion: configVersionRef.current,
          toConfigVersion: polledData.configVersion,
        });
      }
      logConfigVersionUpdate('poll', polledData.configVersion);
      configVersionRef.current = polledData.configVersion;

      const latestData = getDataRef().current;
      commitDataRef.current(
        latestData ? preserveUploadingClips(latestData, polledData) : polledData,
        { save: false, skipHistory: true, updateLastSavedSignature: true },
      );
    }, 0);

    return () => window.clearTimeout(syncHandle);
  }, [
    configVersionRef,
    getDataRef,
    getPollRejectionReason,
    interactionEndTick,
    logConfigVersionUpdate,
    logPollRejection,
    logTimelineSync,
    queries.timelineQuery.data,
  ]);

  useEffect(() => {
    const current = getDataRef().current;
    const registry = queries.assetRegistryQuery.data;

    if (
      !current
      || !registry
      || !isTimelinePollIdle({
        editSeq: editSeqRef.current,
        savedSeq: savedSeqRef.current,
        pendingOps: getPendingOpsRef().current,
        isSaving: isSavingRef.current,
        interactionActive: isInteractionActive(getInteractionStateRef()),
      })
      || registry === lastRegistryDataRef.current
    ) {
      return;
    }

    lastRegistryDataRef.current = registry;

    const currentData = getDataRef().current;
    if (!currentData) {
      return;
    }

    void buildTimelineData(
      currentData.config,
      registry,
      (file) => provider.resolveAssetUrl(file),
      currentData.configVersion,
    ).then((nextData) => {
      if (
        nextData.stableSignature === currentData.stableSignature
        && Object.keys(nextData.assetMap).length === Object.keys(currentData.assetMap).length
      ) {
        return;
      }

      const syncHandle = window.setTimeout(() => {
        if (!isTimelinePollIdle({
          editSeq: editSeqRef.current,
          savedSeq: savedSeqRef.current,
          pendingOps: getPendingOpsRef().current,
          isSaving: isSavingRef.current,
          interactionActive: isInteractionActive(getInteractionStateRef()),
        })) {
          return;
        }

        commitDataRef.current(nextData, {
          save: false,
          skipHistory: true,
          updateLastSavedSignature: true,
          selectedClipId: selectedClipIdRef.current,
          selectedTrackId: selectedTrackIdRef.current,
        });
      }, 0);

      return () => window.clearTimeout(syncHandle);
    });
  }, [
    editSeqRef,
    getDataRef,
    getInteractionStateRef,
    getPendingOpsRef,
    isSavingRef,
    provider,
    queries.assetRegistryQuery.data,
    savedSeqRef,
    selectedClipIdRef,
    selectedTrackIdRef,
  ]);
}
