import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isInteractionActive, onInteractionEnd, type InteractionStateRef } from '@/tools/video-editor/lib/interaction-state.ts';
import { TimelineEventBus } from '@/tools/video-editor/hooks/useTimelineEventBus.ts';
import type { TimelineStoreApi } from '@/tools/video-editor/hooks/timelineStore.ts';
import {
  isDataProviderPersistenceEnabled,
  isTimelineNotFoundError,
  isTimelineVersionConflictError,
  type DataProvider,
} from '@/tools/video-editor/data/DataProvider.ts';
import { buildTimelineData, buildTimelineDataWithResolver, type TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type { AssetResolver } from '@/tools/video-editor/data/AssetResolver.ts';
import { BRIDGE_REQUEST_TIMEOUT_MS } from '@/tools/video-editor/data/bridgeContract.ts';
import { clearTimelineDraft, saveTimelineDraft } from '@/tools/video-editor/data/timelineDraftIndexedDb.ts';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import type { CommitDataOptions, ScheduleSaveFn } from '@/tools/video-editor/hooks/useTimelineCommit.ts';

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'retrying' | 'error';

const TIMELINE_SYNC_LOG_TAG = '[TimelineSync]';
const SAVE_DEBOUNCE_MS = 500;
/**
 * Backoff for the *transport* retry (a 500, a dropped connection — anything that
 * is neither a version conflict nor a missing timeline). It must be a real timer:
 * routing this retry back through `scheduleSave` puts it in `pendingSaveRef`,
 * which the `finally` block below drains immediately, so a backend that keeps
 * failing gets re-POSTed once per round trip forever with no gap between
 * attempts (measured: 73 POSTs in 1.5s at a 20ms RTT, and the chain outlived the
 * unmounted editor).
 */
const SAVE_ERROR_RETRY_BASE_MS = 500;
const SAVE_ERROR_RETRY_MAX_MS = 8_000;
/**
 * Write-ack watchdog grace: if an edit is unacknowledged (no durable save
 * receipt) for longer than this, the UI surfaces a persistent error. Covers
 * timeouts, 4xx/5xx, rejected CAS, and the null-data no-op path.
 *
 * Computed, not a magic constant: the clock starts at the debounce, the POST
 * itself is valid for the full bridge request window, and one quick transport
 * retry (at SAVE_ERROR_RETRY_BASE_MS) gets a chance to ack before the
 * watchdog trips. A save that lands inside the valid request window must
 * never show a false "not saved" banner.
 */
const WATCHDOG_GRACE_MS =
  SAVE_DEBOUNCE_MS + BRIDGE_REQUEST_TIMEOUT_MS + 2 * SAVE_ERROR_RETRY_BASE_MS;

type ConfigVersionUpdateSource = 'save' | 'reload' | 'conflict-retry';

interface UseTimelinePersistenceOptions {
  store?: TimelineStoreApi;
  provider: DataProvider;
  timelineId: string;
  resolveAssetUrl?: (file: string) => Promise<string>;
  /**
   * Optional AssetResolver. When provided, reload paths route asset
   * lookups through `assetResolver.onResolve` (and surface missing
   * assets via `onMissing`) so the host's resolver lifecycle stays
   * authoritative on refresh.
   */
  assetResolver?: AssetResolver;
  eventBus: TimelineEventBus;
  dataRef: MutableRefObject<TimelineData | null>;
  commitData: (nextData: TimelineData, options?: CommitDataOptions) => void;
  selectedClipIdRef: MutableRefObject<string | null>;
  selectedTrackIdRef: MutableRefObject<string | null>;
  editSeqRef: MutableRefObject<number>;
  savedSeqRef: MutableRefObject<number>;
  configVersionRef: MutableRefObject<number>;
  lastSavedSignatureRef: MutableRefObject<string>;
  interactionStateRef: InteractionStateRef;
}

export interface UseTimelinePersistenceResult {
  scheduleSave: ScheduleSaveFn;
  /**
   * Flush the latest editor document through the normal CAS writer and return
   * the exact acknowledged version. Render admission uses this as a barrier so
   * it can never snapshot an autosave-pending or unversioned `head`.
   */
  flushPendingSave: () => Promise<number>;
  saveStatus: SaveStatus;
  isConflictExhausted: boolean;
  reloadFromServer: (options?: { clearDraft?: boolean; preserveDraft?: boolean }) => Promise<void>;
  retrySaveAfterConflict: () => Promise<void>;
  isSavingRef: MutableRefObject<boolean>;
  /** Mirrors isConflictExhausted for the poll gate. */
  isConflictExhaustedRef: MutableRefObject<boolean>;
  /**
   * Write-ack watchdog: true when an edit went unacknowledged past the grace
   * period (or was dropped on the null-data path). Persistent until an ack or
   * an explicit retry/dismiss clears it.
   */
  watchdogTripped: boolean;
  /** Why the watchdog tripped: a save that never acknowledged, or a dropped edit. */
  watchdogReason: 'timeout' | 'lost-edit' | null;
  /** Re-attempt the save (timeout) or dismiss the notice (lost-edit). */
  retryWatchdog: () => void;
}

export function useTimelinePersistence({
  store,
  provider,
  timelineId,
  resolveAssetUrl,
  assetResolver,
  eventBus,
  dataRef,
  commitData,
  selectedClipIdRef,
  selectedTrackIdRef,
  editSeqRef,
  savedSeqRef,
  configVersionRef,
  lastSavedSignatureRef,
  interactionStateRef,
}: UseTimelinePersistenceOptions): UseTimelinePersistenceResult {
  const persistenceEnabled = isDataProviderPersistenceEnabled(provider);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ data: TimelineData; seq: number } | null>(null);
  // Stash for scheduleSave() calls that arrive while a drag/resize is active.
  // Flushed on gesture end by the onInteractionEnd listener below.
  const deferredSaveRef = useRef<{ data: TimelineData; preserveStatus?: boolean } | null>(null);
  const isSavingRef = useRef(false);
  // Transport-failure retry: attempt counter + its own timer, so a failing
  // backend is retried on a backoff instead of as fast as it can answer.
  const errorRetryRef = useRef(0);
  const errorRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const doSaveRef = useRef<((nextData: TimelineData, seq: number) => void) | null>(null);
  const flushWaitersRef = useRef<Array<{
    targetSeq: number;
    resolve: (version: number) => void;
    reject: (error: Error) => void;
  }>>([]);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [isConflictExhausted, setIsConflictExhausted] = useState(false);
  const [watchdogTripped, setWatchdogTripped] = useState(false);
  const [watchdogReason, setWatchdogReason] = useState<'timeout' | 'lost-edit' | null>(null);
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors isConflictExhausted for the poll gate (usePollSync) — a diverged
  // timeline must not adopt remote data over local edits.
  const isConflictExhaustedRef = useRef(false);
  const getDataRef = useCallback(() => {
    const storeDataRef = store?.getState().data.dataRef;
    return storeDataRef && storeDataRef.current !== null ? storeDataRef : dataRef;
  }, [dataRef, store]);
  const getInteractionStateRef = useCallback(() => {
    const storeInteractionStateRef = store?.getState().data.interactionStateRef;
    return storeInteractionStateRef ? storeInteractionStateRef : interactionStateRef;
  }, [interactionStateRef, store]);

  const logConfigVersionUpdate = useCallback((source: ConfigVersionUpdateSource, nextVersion: number) => {
    if (!import.meta.env.DEV) {
      return;
    }

    console.log(TIMELINE_SYNC_LOG_TAG, 'configVersionRef updated', {
      source,
      from: configVersionRef.current,
      to: nextVersion,
    });
  }, [configVersionRef]);

  const handleConflictExhausted = useCallback((details: {
    expectedVersion: number;
    actualVersion?: number;
    retries: number;
    reason: 'load_failed' | 'max_retries' | 'missing_local_data';
  }) => {
    console.log('[TimelineSave] conflict retries exhausted', details);
    setIsConflictExhausted(true);
    setSaveStatus('error');
  }, []);

  const saveMutation = useMutation({
    mutationFn: ({
      config,
      expectedVersion,
      registry,
    }: {
      config: TimelineConfig;
      expectedVersion: number;
      registry?: AssetRegistry;
    }) => {
      return provider.saveTimeline(timelineId, config, expectedVersion, registry);
    },
    retry: false,
  });

  // The old conflict path reloaded the remote version and re-POSTed local
  // state, silently overwriting the other writer (the CAS-defeating bug from
  // the incident). B4 removes it entirely: a 409 enters the diverged state.

  const cancelErrorRetryTimer = useCallback(() => {
    if (errorRetryTimer.current) {
      clearTimeout(errorRetryTimer.current);
      errorRetryTimer.current = null;
    }
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
    setWatchdogTripped(false);
    setWatchdogReason(null);
  }, []);

  const resolveFlushWaiters = useCallback(() => {
    const acknowledgedSeq = savedSeqRef.current;
    const acknowledgedVersion = configVersionRef.current;
    const remaining: typeof flushWaitersRef.current = [];
    for (const waiter of flushWaitersRef.current) {
      if (waiter.targetSeq <= acknowledgedSeq) {
        waiter.resolve(acknowledgedVersion);
      } else {
        remaining.push(waiter);
      }
    }
    flushWaitersRef.current = remaining;
  }, [configVersionRef, savedSeqRef]);

  const rejectFlushWaiters = useCallback((error: unknown) => {
    const normalized = error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Timeline save failed before render admission.');
    const waiters = flushWaitersRef.current;
    flushWaitersRef.current = [];
    for (const waiter of waiters) {
      waiter.reject(normalized);
    }
  }, []);

  /**
   * Cancel a pending watchdog trip WITHOUT clearing an already-tripped error.
   * Used when a debounce-pending save becomes interaction-deferred: the
   * watchdog armed with that debounce must not keep consuming grace while no
   * POST is in flight (a long drag could otherwise trip a false error). The
   * deferred flush re-arms it through `scheduleSave` when the gesture ends.
   */
  const disarmWatchdog = useCallback(() => {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current);
      watchdogTimer.current = null;
    }
  }, []);

  /**
   * Arm the write-ack watchdog: an edit exists that has no durable save
   * receipt. If no ack arrives within the grace period the UI trips. A
   * 'lost-edit' trips immediately (the edit was already dropped).
   */
  const armWatchdog = useCallback((reason: 'timeout' | 'lost-edit') => {
    setWatchdogReason(reason);
    if (reason === 'lost-edit') {
      if (watchdogTimer.current) {
        clearTimeout(watchdogTimer.current);
        watchdogTimer.current = null;
      }
      setWatchdogTripped(true);
      return;
    }
    if (watchdogTimer.current) {
      return;
    }
    watchdogTimer.current = setTimeout(() => {
      watchdogTimer.current = null;
      setWatchdogTripped(true);
    }, WATCHDOG_GRACE_MS);
  }, []);


  /** A save landed (or persistence is off): drop the pending retry and its backoff. */
  const clearErrorRetry = useCallback(() => {
    cancelErrorRetryTimer();
    errorRetryRef.current = 0;
  }, [cancelErrorRetryTimer]);

  /**
   * Re-attempt a save that failed for transport reasons, on an exponential
   * backoff, from a timer this hook owns and cancels on unmount. Unbounded in
   * attempts (the edit must eventually land) but bounded in rate.
   */
  const scheduleErrorRetry = useCallback((nextData: TimelineData) => {
    if (!isMountedRef.current) {
      return;
    }

    if (errorRetryTimer.current) {
      clearTimeout(errorRetryTimer.current);
    }

    const attempt = errorRetryRef.current;
    errorRetryRef.current = attempt + 1;
    const delay = Math.min(SAVE_ERROR_RETRY_BASE_MS * 2 ** attempt, SAVE_ERROR_RETRY_MAX_MS);
    console.log('[TimelineSave] save failed, retrying', { attempt: attempt + 1, delayMs: delay });

    errorRetryTimer.current = setTimeout(() => {
      errorRetryTimer.current = null;
      if (!isMountedRef.current) {
        return;
      }
      if (isInteractionActive(getInteractionStateRef())) {
        // Same gate `scheduleSave` applies: no save round-trip mid-gesture.
        // Waiting out a drag is not a failure, so re-arm at the same level.
        errorRetryRef.current = attempt;
        scheduleErrorRetry(nextData);
        return;
      }
      doSaveRef.current?.(nextData, editSeqRef.current);
    }, delay);
  }, [editSeqRef, getInteractionStateRef]);

  const doSave = useCallback(async (
    nextData: TimelineData,
    seq: number,
    options?: {
      bypassQueue?: boolean;
      completedSeqRef?: { current: number | null };
    },
  ) => {
    if (isSavingRef.current && !options?.bypassQueue) {
      pendingSaveRef.current = { data: nextData, seq };
      return;
    }

    const completedSeqRef = options?.completedSeqRef ?? { current: null };

    if (!options?.bypassQueue) {
      isSavingRef.current = true;
    }
    setSaveStatus('saving');

    try {
      const expectedVersion = configVersionRef.current;
      await saveMutation.mutateAsync(
        {
          config: nextData.config,
          expectedVersion,
          registry: nextData.registry,
        },
        {
          onSuccess: (nextVersion) => {
            if (nextVersion < configVersionRef.current) {
              // Versions are monotonic per backend generation, so a decrease
              // means the backend lost its history (a restarted local bridge
              // reverting to its seed). The save that just landed re-pushed the
              // browser's state, which is the only surviving copy — say so,
              // because the badge alone will just read `saved` again.
              console.warn(
                '[TimelineSave] bridge config_version went backwards (restart?) — local state re-pushed',
                { from: configVersionRef.current, to: nextVersion },
              );
            }
            logConfigVersionUpdate('save', nextVersion);
            configVersionRef.current = nextVersion;
            // Advance the canonical version channel OUTSIDE the data object:
            // a receipt-only ack must NOT commit a new data object (that
            // rebuilds the editor-data slice and triggers the O(n) render
            // cascade mid-drag). Reader/ops/sync read this store field.
            store?.getState().setConfigVersion(nextVersion);
            completedSeqRef.current = seq;

            clearErrorRetry();
            setIsConflictExhausted(false);
            if (seq > savedSeqRef.current) {
              savedSeqRef.current = seq;
              lastSavedSignatureRef.current = nextData.stableSignature;
            }

            resolveFlushWaiters();

            setSaveStatus(seq >= editSeqRef.current ? 'saved' : 'dirty');
            // Only a receipt that covers the current edit (no newer edit
            // pending) is an ack: an older save's success must NOT clear the
            // sole write-ack watchdog while a newer edit is still unsaved.
            // The queued newer save drains right after and emits its own
            // saveSuccess when it lands.
            if (seq >= editSeqRef.current) {
              eventBus.emit('saveSuccess');
              // The recovery slot is cleared only by a durable receipt that
              // covers the current edit. An older ACK must leave the newer
              // mutation's draft intact. IndexedDB is best-effort (private
              // mode/quota failures must never become unhandled rejections).
              void clearTimelineDraft(timelineId).catch(() => {});
            }
          },
        },
      );
    } catch (error) {
      if (isTimelineNotFoundError(error)) {
        console.log('[TimelineSave] timeline not found, cannot save');
        handleConflictExhausted({
          expectedVersion: configVersionRef.current,
          retries: 0,
          reason: 'missing_local_data',
        });
        rejectFlushWaiters(error);
        return;
      }

      if (isTimelineVersionConflictError(error)) {
        // Diverged: the document changed elsewhere. No version reload, no
        // re-POST of local state (that silently overwrote the other writer —
        // the incident's CAS-defeating bug). Enter diverged and let the banner
        // offer Reload / Save as copy.
        console.log('[TimelineSave] version conflict — entering diverged state', {
          expectedVersion: configVersionRef.current,
        });
        handleConflictExhausted({
          expectedVersion: configVersionRef.current,
          retries: 0,
          reason: 'max_retries',
        });
        rejectFlushWaiters(error);
        return;
      }

      rejectFlushWaiters(error);

      const retryData = getDataRef().current ?? dataRef.current;
      if (retryData) {
        // Recoverable transport failure (timeout, 5xx, dropped connection):
        // the retry backoff owns recovery, so this is not a destructive
        // error — the user sees a neutral `retrying` badge while the backend
        // recovers. `error` is reserved for 404/409/lost-edit/unrecoverable.
        setSaveStatus('retrying');
        scheduleErrorRetry(retryData);
      } else {
        setSaveStatus('error');
      }
    } finally {
      if (!options?.bypassQueue) {
        isSavingRef.current = false;

        const pendingSave = pendingSaveRef.current;
        if (pendingSave) {
          pendingSaveRef.current = null;
          if (completedSeqRef.current === null || pendingSave.seq > completedSeqRef.current) {
            void doSave(pendingSave.data, pendingSave.seq);
          }
        }
      }
    }
  }, [
    clearErrorRetry,
    commitData,
    configVersionRef,
    dataRef,
    editSeqRef,
    getDataRef,
    handleConflictExhausted,
    lastSavedSignatureRef,
    logConfigVersionUpdate,
    eventBus,
    rejectFlushWaiters,
    resolveFlushWaiters,
    saveMutation,
    savedSeqRef,
    scheduleErrorRetry,
    selectedClipIdRef,
    selectedTrackIdRef,
  ]);

  // `scheduleErrorRetry` fires `doSave` from a timer, and `doSave` schedules the
  // retry — the indirection keeps that cycle out of the dependency arrays.
  doSaveRef.current = (nextData, seq) => { void doSave(nextData, seq); };

  const scheduleSave = useCallback<ScheduleSaveFn>((nextData, options) => {
    // Every mutation gets the latest coalesced recovery slot before any
    // debounce, interaction gate, or network attempt. This is deliberately
    // best-effort so private-mode IndexedDB rejection cannot affect editing.
    void saveTimelineDraft(
      timelineId,
      { config: nextData.config, registry: nextData.registry },
      configVersionRef.current,
    ).catch(() => {});

    if (!persistenceEnabled) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      pendingSaveRef.current = null;
      deferredSaveRef.current = null;
      clearErrorRetry();
      if (!options?.preserveStatus) {
        setSaveStatus('saved');
      }
      return;
    }

    // Gate on the shared interaction ref. If a drag or resize gesture is in
    // flight, stash the newest payload and defer scheduling the save timer
    // until the gesture ends. This prevents mid-gesture save round-trips from
    // triggering re-renders that drop pointer capture. The watchdog is armed
    // only after this gate passes: a long drag must not consume grace before
    // the POST even starts (the grace formula assumes the clock begins at the
    // debounce, not mid-gesture). The deferred payload is re-flushed through
    // this same path when the gesture ends, arming the watchdog then.
    if (isInteractionActive(getInteractionStateRef())) {
      deferredSaveRef.current = { data: nextData, preserveStatus: options?.preserveStatus };
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      // The pending debounce was armed together with the write-ack watchdog
      // (see below). That watchdog must not keep consuming grace while no
      // POST is in flight: a long drag would trip a false on-page error
      // mid-interaction. Disarm it here; the deferred flush re-arms it via
      // `armWatchdog` below when the gesture ends and the save actually
      // starts. An already-tripped error is left intact — only a receipt
      // (saveSuccess) or an explicit retry clears it.
      disarmWatchdog();
      return;
    }

    // A mutation happened and a save is now pending (deferral has ended):
    // arm the write-ack watchdog. A durable receipt (saveSuccess) clears it;
    // if none arrives within the grace period the UI surfaces a persistent
    // error.
    armWatchdog('timeout');

    // Diverged (409): autosave and remote adoption are frozen. The mutation
    // was already coalesced into the one-slot recovery store above; the banner
    // offers Reload / Save as copy.
    if (isConflictExhausted) {
      return;
    }

    if (!options?.preserveStatus) {
      setSaveStatus('dirty');
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    // A newer payload supersedes any queued transport retry — but keep the
    // backoff level, or editing during an outage would reset it every keystroke.
    cancelErrorRetryTimer();

    if (isSavingRef.current) {
      pendingSaveRef.current = { data: nextData, seq: editSeqRef.current };
      return;
    }

    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void doSave(nextData, editSeqRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [armWatchdog, cancelErrorRetryTimer, configVersionRef, disarmWatchdog, doSave, editSeqRef, getDataRef, getInteractionStateRef, isConflictExhausted, persistenceEnabled, timelineId]);

  const flushPendingSave = useCallback((): Promise<number> => {
    if (!persistenceEnabled) {
      return Promise.resolve(configVersionRef.current);
    }
    if (isInteractionActive(getInteractionStateRef())) {
      return Promise.reject(new Error('Finish the current timeline interaction before rendering.'));
    }
    if (isConflictExhaustedRef.current || isConflictExhausted) {
      return Promise.reject(new Error('Resolve the timeline version conflict before rendering.'));
    }

    const latest = getDataRef().current ?? dataRef.current;
    if (!latest) {
      return Promise.reject(new Error('Timeline data is not loaded, so it cannot be saved for rendering.'));
    }
    const targetSeq = editSeqRef.current;
    if (
      savedSeqRef.current >= targetSeq
      && !isSavingRef.current
      && !saveTimer.current
      && !pendingSaveRef.current
      && !errorRetryTimer.current
    ) {
      return Promise.resolve(configVersionRef.current);
    }

    return new Promise<number>((resolve, reject) => {
      flushWaitersRef.current.push({ targetSeq, resolve, reject });
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      cancelErrorRetryTimer();
      if (isSavingRef.current) {
        pendingSaveRef.current = { data: latest, seq: targetSeq };
        return;
      }
      void doSave(latest, targetSeq);
    });
  }, [
    cancelErrorRetryTimer,
    configVersionRef,
    dataRef,
    doSave,
    editSeqRef,
    getDataRef,
    getInteractionStateRef,
    isConflictExhausted,
    isConflictExhaustedRef,
    persistenceEnabled,
    savedSeqRef,
  ]);

  const retryWatchdog = useCallback(() => {
    const reason = watchdogReason;
    clearWatchdog();
    if (reason === 'timeout') {
      // Re-attempt the save from the latest data. Lost edits have nothing to
      // re-send — the notice is the signal to reload the timeline.
      const latest = getDataRef().current ?? dataRef.current;
      if (latest) {
        scheduleSave(latest, { preserveStatus: true });
      }
    }
  }, [clearWatchdog, dataRef, getDataRef, scheduleSave, watchdogReason]);

  // When a gesture ends, flush the latest deferred payload (if any) through
  // the normal scheduleSave path, which will now proceed past the gate.
  useEffect(() => {
    return onInteractionEnd(getInteractionStateRef(), () => {
      const deferred = deferredSaveRef.current;
      if (!deferred) {
        return;
      }
      deferredSaveRef.current = null;
      scheduleSave(deferred.data, { preserveStatus: deferred.preserveStatus });
    });
  }, [getInteractionStateRef, scheduleSave]);

  const reloadFromServer = useCallback(async (options?: { clearDraft?: boolean; preserveDraft?: boolean }) => {
    const [loadedTimeline, registry] = await Promise.all([
      provider.loadTimeline(timelineId),
      provider.loadAssetRegistry(timelineId),
    ]);

    pendingSaveRef.current = null;
    clearErrorRetry();
    clearWatchdog();
    setIsConflictExhausted(false);
    editSeqRef.current = savedSeqRef.current;
    logConfigVersionUpdate('reload', loadedTimeline.configVersion);
    configVersionRef.current = loadedTimeline.configVersion;
    store?.getState().setConfigVersion(loadedTimeline.configVersion);

    const reloadedData = assetResolver
      ? await buildTimelineDataWithResolver(
          loadedTimeline.config,
          registry,
          assetResolver,
          loadedTimeline.configVersion,
          timelineId,
        )
      : await buildTimelineData(
          loadedTimeline.config,
          registry,
          resolveAssetUrl ?? ((file) => provider.resolveAssetUrl(file)),
        loadedTimeline.configVersion,
      );

    // Explicit server adoption discards the local recovery slot. Save-as-copy
    // calls this same reload with preserveDraft so its intentionally stashed
    // work survives for a later recovery offer.
    const shouldClearDraft = options?.clearDraft ?? !options?.preserveDraft;
    if (shouldClearDraft) {
      await clearTimelineDraft(timelineId).catch(() => {});
    }

    commitData(reloadedData, {
      save: false,
      skipHistory: true,
      updateLastSavedSignature: true,
      selectedClipId: selectedClipIdRef.current,
      selectedTrackId: selectedTrackIdRef.current,
    });
    setSaveStatus('saved');
  }, [
    assetResolver,
    clearErrorRetry,
    clearWatchdog,
    commitData,
    configVersionRef,
    editSeqRef,
    logConfigVersionUpdate,
    provider,
    resolveAssetUrl,
    savedSeqRef,
    selectedClipIdRef,
    selectedTrackIdRef,
    timelineId,
  ]);

  /**
   * "Save as copy" (diverged banner action): the local work is stashed in the
   * one-slot recovery draft, then the server state is loaded. The local edits
   * are never silently re-POSTed over the other writer (the CAS-defeating bug
   * is gone); the copy survives for Retry / Save-as-copy on the next load.
   */
  const retrySaveAfterConflict = useCallback(async () => {
    const latest = getDataRef().current ?? dataRef.current;
    if (!latest) {
      setIsConflictExhausted(false);
      return;
    }

    try {
      await saveTimelineDraft(
        timelineId,
        { config: latest.config, registry: latest.registry },
        configVersionRef.current,
      );
    } catch {
      // IndexedDB unavailable (private mode etc.) — the copy can't persist.
      // Keep the diverged state so the user knows local edits are at risk.
      return;
    }
    setIsConflictExhausted(false);
    await reloadFromServer({ preserveDraft: true });
  }, [configVersionRef, dataRef, getDataRef, reloadFromServer, timelineId]);

  useEffect(() => {
    // A durable save receipt acknowledges the edit: clear the watchdog.
    const offSuccess = eventBus.on('saveSuccess', clearWatchdog);
    // An edit was dropped on the null-data path: surface it immediately.
    const offLost = eventBus.on('lostEdit', () => armWatchdog('lost-edit'));
    return () => {
      offSuccess();
      offLost();
      if (watchdogTimer.current) {
        clearTimeout(watchdogTimer.current);
        watchdogTimer.current = null;
      }
    };
  }, [armWatchdog, clearWatchdog, eventBus]);

  useEffect(() => {
    isConflictExhaustedRef.current = isConflictExhausted;
  }, [isConflictExhausted]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Without this the transport-retry chain outlives the editor: the timer is
      // this hook's, but nothing else stops the doSave -> retry -> doSave loop.
      isMountedRef.current = false;
      clearErrorRetry();
      rejectFlushWaiters(new Error('Timeline closed before the save-for-render barrier completed.'));
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [clearErrorRetry, rejectFlushWaiters]);

  return {
    scheduleSave,
    flushPendingSave,
    saveStatus,
    isConflictExhausted,
    reloadFromServer,
    retrySaveAfterConflict,
    isSavingRef,
    isConflictExhaustedRef,
    watchdogTripped,
    watchdogReason,
    retryWatchdog,
  };
}
