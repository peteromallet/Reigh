// @vitest-environment jsdom
import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeIndexedDB, resetFakeIndexedDB } from 'fake-indexeddb';
vi.stubGlobal('indexedDB', createFakeIndexedDB());
import { useTimelinePersistence, type UseTimelinePersistenceResult } from './useTimelinePersistence';
import { TimelineEventBus } from './useTimelineEventBus';
import {
  TimelineStoreProvider,
  createTimelineStore,
  useTimelineDataSelector,
  type TimelineStoreApi,
} from './timelineStore';
import { createInteractionState, notifyInteractionEndIfIdle, type InteractionStateRef } from '../lib/interaction-state';
import { configToRows, type TimelineData } from '../lib/timeline-data';
import { getConfigSignature, getStableConfigSignature } from '../lib/config-utils';
import { createDefaultTimelineConfig } from '../lib/defaults';
import type { AssetResolver } from '../data/AssetResolver';
import { TimelineVersionConflictError, type DataProvider } from '../data/DataProvider';
import { loadTimelineDraft, saveTimelineDraft } from '@/tools/video-editor/data/timelineDraftIndexedDb.ts';
import type { AssetRegistry } from '../types';

function makeRegistry(label: string): AssetRegistry {
  return {
    assets: {
      [`asset-${label}`]: {
        file: `media/${label}.mp4`,
        type: 'video/mp4',
        generationId: `gen-${label}`,
        variantId: `variant-${label}`,
      },
    },
  };
}

function makeTimelineData(label: string, registry: AssetRegistry = { assets: {} }): TimelineData {
  const base = createDefaultTimelineConfig();
  const config = {
    ...base,
    output: { ...base.output, file: `output-${label}.mp4` },
    tracks: (base.tracks ?? []).map((track) => ({ ...track })),
    clips: [{
      id: `clip-${label}`,
      at: 0,
      track: 'V1' as const,
      clipType: 'hold' as const,
      hold: 1,
    }],
  };
  const rowData = configToRows(config);
  const assetMap = Object.fromEntries(
    Object.entries(registry.assets).map(([assetId, entry]) => [assetId, entry.file]),
  );
  const resolvedRegistry = Object.fromEntries(
    Object.entries(registry.assets).map(([assetId, entry]) => [assetId, { ...entry, src: entry.file }]),
  );
  const resolvedConfig = {
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clips: config.clips.map((clip) => ({ ...clip, assetEntry: undefined })),
    registry: resolvedRegistry,
  };
  return {
    config,
    configVersion: 1,
    registry,
    resolvedConfig,
    rows: rowData.rows,
    meta: rowData.meta,
    effects: rowData.effects,
    assetMap,
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clipOrder: rowData.clipOrder,
    signature: getConfigSignature(resolvedConfig),
    stableSignature: getStableConfigSignature(config, registry),
  };
}

interface TestHarness {
  provider: DataProvider;
  assetResolver: AssetResolver;
  saveTimeline: ReturnType<typeof vi.fn>;
  loadTimeline: ReturnType<typeof vi.fn>;
  loadAssetRegistry: ReturnType<typeof vi.fn>;
  interactionStateRef: InteractionStateRef;
  dataRef: { current: TimelineData | null };
  /** Commit sequence counter — bump to simulate a newer edit landing. */
  editSeqRef: { current: number };
  commitData: ReturnType<typeof vi.fn>;
  scheduleSave: (data: TimelineData) => void;
  reloadFromServer: () => Promise<void>;
  unmount: () => void;
  eventBus: TimelineEventBus;
  result: { current: UseTimelinePersistenceResult };
}

interface SetupOptions {
  store?: TimelineStoreApi;
  initialData?: TimelineData;
  persistenceEnabled?: boolean;
  saveTimelineImpl?: (
    timelineId: string,
    config: TimelineData['config'],
    expectedVersion: number,
    registry?: AssetRegistry,
  ) => Promise<number>;
  loadTimelineImpl?: DataProvider['loadTimeline'];
  loadAssetRegistryImpl?: DataProvider['loadAssetRegistry'];
}

function setup(options?: SetupOptions): TestHarness {
  const saveTimeline = vi.fn(
    options?.saveTimelineImpl
      ?? (async (_id: string, _config: TimelineData['config'], _version: number, _registry?: AssetRegistry) => 2),
  );
  const loadTimeline = vi.fn(
    options?.loadTimelineImpl
      ?? (async () => ({ config: createDefaultTimelineConfig(), configVersion: 1 })),
  );
  const loadAssetRegistry = vi.fn(options?.loadAssetRegistryImpl ?? (async () => ({ assets: {} })));
  const provider: DataProvider = {
    persistenceEnabled: options?.persistenceEnabled,
    loadTimeline,
    saveTimeline,
    loadAssetRegistry,
    resolveAssetUrl: vi.fn((file: string) => file),
  };
  const assetResolver: AssetResolver = {
    resolveAssetUrl: vi.fn((file: string) => Promise.resolve(file)),
  };

  const eventBus = new TimelineEventBus();
  const dataRef = { current: options?.initialData ?? makeTimelineData('initial') };
  const interactionStateRef: InteractionStateRef = { current: createInteractionState() };
  const commitData = vi.fn();
  const selectedClipIdRef = { current: null };
  const selectedTrackIdRef = { current: null };
  const editSeqRef = { current: 1 };
  const savedSeqRef = { current: 0 };
  const configVersionRef = { current: 1 };
  const lastSavedSignatureRef = { current: '' };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  const hook = renderHook(
    () => useTimelinePersistence({
      store: options?.store,
      provider,
      assetResolver,
      timelineId: 'timeline-1',
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
    }),
    { wrapper },
  );

  return {
    provider,
    assetResolver,
    saveTimeline,
    loadTimeline,
    loadAssetRegistry,
    interactionStateRef,
    dataRef,
    editSeqRef,
    commitData,
    scheduleSave: (data) => {
      dataRef.current = data;
      act(() => {
        hook.result.current.scheduleSave(data);
      });
    },
    reloadFromServer: () => hook.result.current.reloadFromServer(),
    unmount: () => { hook.unmount(); },
    eventBus,
    result: hook.result,
  };
}

describe('useTimelinePersistence — interaction gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFakeIndexedDB();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does NOT fire saveTimeline while a drag interaction is active', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;

    harness.scheduleSave(makeTimelineData('mid-drag'));

    // Advance well past the 500ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();
  });

  it('does NOT fire saveTimeline while a resize interaction is active', async () => {
    const harness = setup();
    harness.interactionStateRef.current.resize = true;

    harness.scheduleSave(makeTimelineData('mid-resize'));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();
  });

  it('flushes the newest deferred payload after the gesture ends', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;

    // First scheduled mid-drag — should be deferred and replaced.
    harness.scheduleSave(makeTimelineData('drag-1'));
    harness.scheduleSave(makeTimelineData('drag-2'));
    harness.scheduleSave(makeTimelineData('drag-3'));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(harness.saveTimeline).not.toHaveBeenCalled();

    // End the gesture.
    await act(async () => {
      harness.interactionStateRef.current.drag = false;
      notifyInteractionEndIfIdle(harness.interactionStateRef);
      // Now scheduleSave's setTimeout(500) should fire.
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    // Should have flushed the newest payload — output.file ends with 'drag-3'.
    const args = harness.saveTimeline.mock.calls[0]?.[1];
    expect(args?.output.file).toBe('output-drag-3.mp4');
  });

  it('keeps save deferred until both drag and resize interactions are idle', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;
    harness.interactionStateRef.current.resize = true;

    harness.scheduleSave(makeTimelineData('both-active'));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(harness.saveTimeline).not.toHaveBeenCalled();

    await act(async () => {
      harness.interactionStateRef.current.drag = false;
      notifyInteractionEndIfIdle(harness.interactionStateRef);
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();

    await act(async () => {
      harness.interactionStateRef.current.resize = false;
      notifyInteractionEndIfIdle(harness.interactionStateRef);
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    const args = harness.saveTimeline.mock.calls[0]?.[1];
    expect(args?.output.file).toBe('output-both-active.mp4');
  });

  it('schedules saves normally when no interaction is active', async () => {
    const harness = setup();

    harness.scheduleSave(makeTimelineData('normal'));

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
  });

  it('coalesces a recovery draft before the debounce, so a crash cannot lose the edit', async () => {
    const harness = setup();
    const first = makeTimelineData('crash-before-debounce');
    const latest = makeTimelineData('crash-latest');

    harness.scheduleSave(first);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();
    expect((await loadTimelineDraft('timeline-1'))?.draft).toEqual({
      config: first.config,
      registry: first.registry,
    });

    // A second mutation overwrites the one slot, still before any POST.
    harness.scheduleSave(latest);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((await loadTimelineDraft('timeline-1'))?.draft).toEqual({
      config: latest.config,
      registry: latest.registry,
    });
  });

  it('flushes a debounce-pending edit immediately and returns its acknowledged version', async () => {
    const harness = setup();
    harness.scheduleSave(makeTimelineData('render-barrier'));

    let acknowledgedVersion: number | undefined;
    await act(async () => {
      acknowledgedVersion = await harness.result.current.flushPendingSave();
    });

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    expect(harness.saveTimeline.mock.calls[0]?.[1].output.file).toBe('output-render-barrier.mp4');
    expect(acknowledgedVersion).toBe(2);
  });

  it('refuses the save-for-render barrier while an interaction is active', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;
    harness.scheduleSave(makeTimelineData('mid-drag-render'));

    await expect(harness.result.current.flushPendingSave()).rejects.toThrow(
      'Finish the current timeline interaction before rendering.',
    );
    expect(harness.saveTimeline).not.toHaveBeenCalled();
  });

  it('rejects the save-for-render barrier when the durable write fails', async () => {
    const harness = setup({
      saveTimelineImpl: async () => {
        throw new Error('bridge unavailable');
      },
    });
    harness.scheduleSave(makeTimelineData('failed-render-save'));

    await act(async () => {
      await expect(harness.result.current.flushPendingSave()).rejects.toThrow('bridge unavailable');
    });
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it('suppresses autosave when provider persistence is disabled', async () => {
    const harness = setup({ persistenceEnabled: false });

    harness.scheduleSave(makeTimelineData('read-only'));

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();
  });

  // A transport failure (500, dropped connection) used to be retried by calling
  // scheduleSave() from the catch block. That lands in pendingSaveRef, which the
  // finally block drains immediately — so a permanently failing backend was
  // re-POSTed once per round trip with no gap, forever, and the chain kept
  // running after the editor unmounted.
  describe('transport-failure retry', () => {
    const advance = async (ms: number) => {
      await act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    };

    it('retries a failed save on a backoff, not once per round trip', async () => {
      const harness = setup({
        saveTimelineImpl: async () => {
          throw new Error('Astrid bridge save timeline failed: 500 Internal Server Error');
        },
      });

      harness.scheduleSave(makeTimelineData('flaky'));

      await advance(600);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

      // First backoff is 500ms — nothing fires before it elapses.
      await advance(200);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

      await advance(400);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(2);

      // Second backoff doubles to 1000ms.
      await advance(600);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(2);

      await advance(500);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(3);
    });

    it('stops retrying once the editor unmounts', async () => {
      const harness = setup({
        saveTimelineImpl: async () => {
          throw new Error('Astrid bridge save timeline failed: 500 Internal Server Error');
        },
      });

      harness.scheduleSave(makeTimelineData('flaky-unmount'));
      await advance(600);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

      harness.unmount();
      await advance(10_000);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    });

    it('resumes normally once the backend recovers', async () => {
      let attempt = 0;
      const harness = setup({
        saveTimelineImpl: async () => {
          attempt += 1;
          if (attempt === 1) {
            throw new Error('Astrid bridge save timeline failed: 500 Internal Server Error');
          }
          return 2;
        },
      });

      harness.scheduleSave(makeTimelineData('recovers'));
      await advance(600);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

      await advance(600);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(2);

      // Backoff is cleared by the successful save: no further attempts.
      await advance(10_000);
      expect(harness.saveTimeline).toHaveBeenCalledTimes(2);
    });
  });

  it('warns when the backend\'s config_version goes backwards', async () => {
    // Versions are monotonic per backend generation. A decrease means the
    // backend lost its history (a restarted local bridge back at its seed) and
    // the save that just landed re-pushed the browser's copy — the badge will
    // read `saved` again, so this is the only signal the developer gets.
    const versions = [9, 2];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const harness = setup({ saveTimelineImpl: async () => versions.shift() ?? 2 });

    harness.scheduleSave(makeTimelineData('first'));
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); });
    expect(warn).not.toHaveBeenCalled();

    harness.scheduleSave(makeTimelineData('second'));
    await act(async () => { vi.advanceTimersByTime(600); await Promise.resolve(); });

    expect(warn).toHaveBeenCalledWith(
      '[TimelineSave] bridge config_version went backwards (restart?) — local state re-pushed',
      { from: 9, to: 2 },
    );
    warn.mockRestore();
  });

  // Fix (b): a save RECEIPT is metadata, not a new timeline document. The ack
  // must advance the canonical version channel (configVersionRef + the store
  // field outside the data object) WITHOUT committing a new data object — a
  // version-only commitData rebuilds the editor-data slice and triggers the
  // O(n) render cascade that stalled the main thread mid-drag.
  describe('version-only ack (receipt metadata vs document state)', () => {
    it('advances the canonical version, preserves document identities, and the next save uses the acked version', async () => {
      const store = createTimelineStore();
      const versions = [2, 3];
      const harness = setup({
        store,
        saveTimelineImpl: async () => versions.shift() ?? 3,
      });

      // Editor + clip render probes mounted against the SAME store the ack
      // updates. They subscribe exactly like TimelineEditorCore (`data` slice
      // / clip list identity) and count ACTUAL component renders, so a
      // receipt-only ack re-rendering either of them would fail the test.
      const editorRenders = { current: 0 };
      const clipRenders = { current: 0 };
      function EditorRenderProbe() {
        useTimelineDataSelector((data) => data.data);
        editorRenders.current += 1;
        return null;
      }
      function ClipRenderProbe() {
        useTimelineDataSelector((data) => data.data?.config.clips ?? null);
        clipRenders.current += 1;
        return null;
      }
      render(
        <TimelineStoreProvider store={store}>
          <EditorRenderProbe />
          <ClipRenderProbe />
        </TimelineStoreProvider>,
      );
      // Baseline: one render each against the empty initial data slice.
      expect(editorRenders.current).toBe(1);
      expect(clipRenders.current).toBe(1);

      // Simulate the mounted editor pushing its data slice (useTimelineState
      // does this on mount/commit); the probes now observe the real document.
      const initialData = makeTimelineData('ack');
      act(() => {
        store.getState().syncSlices({ data: { ...store.getState().data, data: initialData } });
      });
      expect(editorRenders.current).toBe(2);
      expect(clipRenders.current).toBe(2);

      harness.scheduleSave(initialData);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
        await Promise.resolve();
      });

      // (a) The ack advances the version: the CAS ref AND the store channel.
      expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
      expect(harness.saveTimeline.mock.calls[0]![2]).toBe(1);
      expect(store.getState().configVersion).toBe(2);

      // (b) A receipt-only ack must NOT commit a new data object (that is the
      // setData → TimelineEditorCore re-render → O(n) cascade trigger).
      expect(harness.commitData).not.toHaveBeenCalled();

      // (c) Document / row / ACTION object identities are unchanged — SAME
      // references, not just deep-equal.
      expect(harness.dataRef.current).toBe(initialData);
      expect(harness.dataRef.current?.config).toBe(initialData.config);
      expect(harness.dataRef.current?.rows).toBe(initialData.rows);
      expect(harness.dataRef.current?.tracks).toBe(initialData.tracks);
      expect(initialData.rows.length).toBeGreaterThan(0);
      expect(initialData.rows[0]!.actions.length).toBeGreaterThan(0);
      expect(harness.dataRef.current?.rows[0]).toBe(initialData.rows[0]);
      expect(harness.dataRef.current?.rows[0]!.actions).toBe(initialData.rows[0]!.actions);
      expect(harness.dataRef.current?.rows[0]!.actions[0]).toBe(initialData.rows[0]!.actions[0]);

      // (d) The editor and clip render counters did NOT advance on the ack.
      expect(editorRenders.current).toBe(2);
      expect(clipRenders.current).toBe(2);

      // (e) The next save uses the acked version as its CAS expectation.
      const secondData = makeTimelineData('ack-second');
      harness.scheduleSave(secondData);
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(harness.saveTimeline).toHaveBeenCalledTimes(2);
      expect(harness.saveTimeline.mock.calls[1]![2]).toBe(2);
      expect(store.getState().configVersion).toBe(3);
      // Still no data commit on the second ack — and still no editor/clip
      // re-render.
      expect(harness.commitData).not.toHaveBeenCalled();
      expect(editorRenders.current).toBe(2);
      expect(clipRenders.current).toBe(2);

      // (f) Positive control: a REAL data commit (new data object) DOES
      // re-render both probes — the counters are live, and the quiet ack path
      // is what keeps them flat above.
      act(() => {
        store.getState().syncDataSlice({ ...store.getState().data, data: makeTimelineData('ack-committed') });
      });
      expect(editorRenders.current).toBe(3);
      expect(clipRenders.current).toBe(3);
    });
  });

  it('doSave passes registry to saveTimeline', async () => {
    const harness = setup();
    const registry = makeRegistry('save');
    const nextData = makeTimelineData('with-registry', registry);

    harness.scheduleSave(nextData);

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    expect(harness.saveTimeline).toHaveBeenCalledWith('timeline-1', nextData.config, 1, registry);
  });

  it('a 409 enters diverged: no version reload, no re-POST (CAS-defeating retry removed)', async () => {
    const staleRegistry = makeRegistry('stale');
    const nextData = makeTimelineData('conflict', staleRegistry);
    const harness = setup({
      initialData: nextData,
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        throw new TimelineVersionConflictError();
      },
    });

    harness.scheduleSave(nextData);

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Diverged state, exactly one POST, no remote version reload, no repost.
    expect(harness.result.current.isConflictExhausted).toBe(true);
    expect(harness.result.current.saveStatus).toBe('error');
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    expect(harness.loadTimeline).not.toHaveBeenCalled();
    expect(harness.loadAssetRegistry).not.toHaveBeenCalled();
  });

  it('retains the recovery draft after a 409 and transport failure, and clears it only after success', async () => {
    const conflict = setup({
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        throw new TimelineVersionConflictError();
      },
    });
    const conflictData = makeTimelineData('draft-conflict');
    conflict.scheduleSave(conflictData);
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await loadTimelineDraft('timeline-1')).not.toBeNull();
    conflict.unmount();

    resetFakeIndexedDB();
    const transport = setup({
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        throw new Error('bridge unavailable');
      },
    });
    transport.scheduleSave(makeTimelineData('draft-transport'));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await loadTimelineDraft('timeline-1')).not.toBeNull();
    transport.unmount();

    resetFakeIndexedDB();
    const success = setup({ persistenceEnabled: true });
    await saveTimelineDraft(
      'timeline-1',
      { config: makeTimelineData('old').config, registry: { assets: {} } },
      1,
    );
    success.scheduleSave(makeTimelineData('draft-success'));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(success.saveTimeline).toHaveBeenCalledTimes(1);
    expect(await loadTimelineDraft('timeline-1')).toBeNull();
  });

  it('autosave freezes while diverged (further edits do not POST)', async () => {
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        throw new TimelineVersionConflictError();
      },
    });
    harness.scheduleSave(makeTimelineData('conflict'));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.result.current.isConflictExhausted).toBe(true);

    // A subsequent edit while diverged must not fire another POST.
    harness.scheduleSave(makeTimelineData('conflict-2'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
  });

  it('save as copy stashes a draft then reloads (no silent overwrite)', async () => {
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        throw new TimelineVersionConflictError();
      },
    });
    harness.scheduleSave(makeTimelineData('conflict'));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.result.current.isConflictExhausted).toBe(true);

    const loadBefore = harness.loadTimeline.mock.calls.length;
    await act(async () => {
      await harness.result.current.retrySaveAfterConflict();
      await Promise.resolve();
    });
    // Diverged cleared, server reloaded, and the local save was NOT re-POSTed.
    expect(harness.result.current.isConflictExhausted).toBe(false);
    expect(harness.loadTimeline.mock.calls.length).toBeGreaterThan(loadBefore);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    // Save-as-copy deliberately preserves the just-stashed local work across
    // the server reload.
    expect(await loadTimelineDraft('timeline-1')).not.toBeNull();
  });

  it('direct reload adopts server state and clears a diverged recovery draft', async () => {
    const harness = setup({ persistenceEnabled: true });
    harness.scheduleSave(makeTimelineData('local-before-reload'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await loadTimelineDraft('timeline-1')).not.toBeNull();

    await act(async () => {
      await harness.reloadFromServer();
    });
    expect(await loadTimelineDraft('timeline-1')).toBeNull();
  });

  it('best-effort draft writes tolerate private-mode IndexedDB rejection', async () => {
    const harness = setup({ persistenceEnabled: true });
    const originalIndexedDb = (globalThis as Record<string, unknown>).indexedDB;
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('IndexedDB is blocked in private mode');
      },
    });

    expect(() => harness.scheduleSave(makeTimelineData('private-mode'))).not.toThrow();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    vi.stubGlobal('indexedDB', originalIndexedDb);
  });

  it('reloadFromServer rebuilds timeline data through the asset resolver', async () => {
    const registry = makeRegistry('reload');
    const base = createDefaultTimelineConfig();
    const loadedConfig = {
      ...base,
      output: { ...base.output, file: 'output-reload.mp4' },
      tracks: (base.tracks ?? []).map((track) => ({ ...track })),
      clips: [{
        id: 'clip-reload',
        at: 0,
        track: 'V1' as const,
        clipType: 'media' as const,
        asset: 'asset-reload',
        from: 0,
        to: 2,
      }],
    };
    const harness = setup({
      initialData: makeTimelineData('reload-initial', registry),
      loadTimelineImpl: async () => ({ config: loadedConfig, configVersion: 3 }),
      loadAssetRegistryImpl: async () => registry,
    });

    harness.assetResolver.onResolve = vi.fn(async ({ file }) => `resolved:${file}`);

    await act(async () => {
      await harness.reloadFromServer();
    });

    expect(harness.assetResolver.onResolve).toHaveBeenCalledWith({
      file: 'media/reload.mp4',
      timelineId: 'timeline-1',
    });
  });
});

describe('useTimelinePersistence — write-ack watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFakeIndexedDB();
  });

  // React Query defers mutationFn onto microtasks; flush them after advancing.
  const advance = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('trips after the grace period when a save never acknowledges', async () => {
    // A save that never settles: doSave starts, the watchdog sees no receipt.
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>(() => {}),
    });

    harness.scheduleSave(makeTimelineData('hang'));
    await advance(600); // debounce fires, save hangs
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

    // Grace is debounce + bridge request window + two retry bases = 11.5s.
    await advance(10_000); // 10.6s since the arm — still inside grace
    expect(harness.result?.current.watchdogTripped).toBe(false);
    await advance(1_500); // 12.1s — past grace, trips
    expect(harness.result?.current.watchdogTripped).toBe(true);
  });

  it('clears on a durable save receipt (saveSuccess)', async () => {
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>(() => {}),
    });

    harness.scheduleSave(makeTimelineData('hang'));
    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(true);

    act(() => { harness.eventBus.emit('saveSuccess'); });
    expect(harness.result?.current.watchdogTripped).toBe(false);
  });

  it('does NOT trip when a slow-but-valid save ACKs at 6-9s', async () => {
    let settle: ((v: number) => void) | null = null;
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>((resolve) => { settle = resolve; }),
    });

    harness.scheduleSave(makeTimelineData('slow-ack'));
    await advance(600); // debounce fires, save in flight
    await advance(6_400); // 7s after the watchdog armed
    expect(harness.result?.current.watchdogTripped).toBe(false);

    // The receipt lands well inside the 11.5s grace and clears the watchdog.
    act(() => { settle?.(2); });
    await advance(0);
    expect(harness.result?.current.saveStatus).toBe('saved');
    expect(harness.result?.current.watchdogTripped).toBe(false);

    // No latent trip fires after the ack.
    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);
  });

  it('does NOT trip when a save ACKs within the retry window (10.5-11.4s)', async () => {
    let settle: ((v: number) => void) | null = null;
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>((resolve) => { settle = resolve; }),
    });

    harness.scheduleSave(makeTimelineData('late-ack'));
    await advance(600);
    // 10.6s since the watchdog armed: past the 10s request window but still
    // inside the computed grace (debounce + request window + 2 retry bases).
    await advance(10_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);

    act(() => { settle?.(2); });
    await advance(0);
    expect(harness.result?.current.watchdogTripped).toBe(false);
    expect(harness.result?.current.saveStatus).toBe('saved');

    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);
  });

  it('timeout -> retry -> success transitions through retrying and never shows error', async () => {
    let attempt = 0;
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('Astrid bridge save timeline failed: 500 Internal Server Error');
        }
        return 2;
      },
    });

    harness.scheduleSave(makeTimelineData('retry-success'));
    await advance(600); // debounce fires, attempt 1 fails -> retrying
    expect(harness.result?.current.saveStatus).toBe('retrying');
    expect(harness.result?.current.watchdogTripped).toBe(false);

    await advance(600); // 500ms backoff elapses, attempt 2 succeeds
    expect(harness.saveTimeline).toHaveBeenCalledTimes(2);
    expect(harness.result?.current.saveStatus).toBe('saved');
    expect(harness.result?.current.watchdogTripped).toBe(false);

    // The retried save ACKed well inside the grace window — no latent trip.
    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);
  });

  it('does not arm the watchdog while an interaction defers the save', async () => {
    const harness = setup({ persistenceEnabled: true });
    harness.interactionStateRef.current.drag = true;

    harness.scheduleSave(makeTimelineData('mid-drag'));

    // A long drag: well past the old 5s grace, nothing can trip because the
    // watchdog is only armed once the deferral ends (and the flush re-arms).
    await advance(8_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);

    await act(async () => {
      harness.interactionStateRef.current.drag = false;
      notifyInteractionEndIfIdle(harness.interactionStateRef);
      await Promise.resolve();
    });
    await advance(600); // debounce fires, save succeeds
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    expect(harness.result?.current.watchdogTripped).toBe(false);
    expect(harness.result?.current.saveStatus).toBe('saved');
  });

  it('disarms the watchdog when an interaction defers an ALREADY-PENDING save (no false trip during a >11.5s drag)', async () => {
    const harness = setup({ persistenceEnabled: true });

    // Save scheduled while idle: the 500ms debounce is armed AND the
    // write-ack watchdog is armed with it (grace = 11.5s from now).
    harness.scheduleSave(makeTimelineData('pre-drag'));
    expect(harness.saveTimeline).not.toHaveBeenCalled();

    // The drag begins BEFORE the debounce fires. The deferral branch cancels
    // the pending debounce — and must ALSO disarm the watchdog, or the long
    // drag below would trip a false error with no POST ever fired.
    harness.interactionStateRef.current.drag = true;
    harness.scheduleSave(makeTimelineData('mid-drag'));

    // >11.5s of continuous interaction with NO POST: the pre-fix race would
    // trip the watchdog here (it was armed with the pre-drag debounce).
    await advance(13_000);
    expect(harness.saveTimeline).not.toHaveBeenCalled();
    expect(harness.result?.current.watchdogTripped).toBe(false);

    // Gesture ends: the deferred payload flushes through scheduleSave, which
    // re-arms the watchdog, POSTs, and ACKs — the error path stays clean.
    await act(async () => {
      harness.interactionStateRef.current.drag = false;
      notifyInteractionEndIfIdle(harness.interactionStateRef);
      await Promise.resolve();
    });
    await advance(600); // debounce fires, save succeeds
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    expect(harness.result?.current.watchdogTripped).toBe(false);
    expect(harness.result?.current.watchdogReason).toBeNull();
    expect(harness.result?.current.saveStatus).toBe('saved');

    // No latent trip from the pre-drag arm can fire later either.
    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(false);
  });

  it('an older save ACK does not clear the sole watchdog while a newer edit is pending', async () => {
    let settleA: ((v: number) => void) | null = null;
    let settleB: ((v: number) => void) | null = null;
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>((resolve) => {
        if (!settleA) {
          settleA = resolve;
        } else {
          settleB = resolve;
        }
      }),
    });

    // Save A (seq 1) goes in flight; the watchdog arms when it is scheduled.
    harness.scheduleSave(makeTimelineData('save-a'));
    await advance(600);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

    // A newer edit (seq 2) lands while A is still in flight — it queues.
    harness.editSeqRef.current = 2;
    harness.scheduleSave(makeTimelineData('save-b'));
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((await loadTimelineDraft('timeline-1'))?.draft).toEqual({
      config: makeTimelineData('save-b').config,
      registry: makeTimelineData('save-b').registry,
    });

    // A's ACK arrives: it does not cover the newest edit, so it must NOT
    // clear the sole watchdog. The queued save B drains and hangs.
    act(() => { settleA?.(2); });
    await advance(0);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(2);
    expect((await loadTimelineDraft('timeline-1'))?.draft).toEqual({
      config: makeTimelineData('save-b').config,
      registry: makeTimelineData('save-b').registry,
    });
    // The queued newer save B drained and is now in flight — definitely not
    // 'saved', and the watchdog is still armed.
    expect(harness.result?.current.saveStatus).toBe('saving');
    expect(harness.result?.current.watchdogTripped).toBe(false);

    // Nothing else cleared the watchdog: it trips once B goes unacknowledged
    // past the grace (11.5s from when save A was scheduled).
    await advance(10_500); // 11.1s since the arm — still inside grace
    expect(harness.result?.current.watchdogTripped).toBe(false);
    await advance(1_000); // 12.1s — past grace, trips
    expect(harness.result?.current.watchdogTripped).toBe(true);
    expect(harness.result?.current.watchdogReason).toBe('timeout');

    // B eventually ACKs — the receipt now covers the newest edit and clears.
    act(() => { settleB?.(2); });
    await advance(0);
    expect(harness.result?.current.watchdogTripped).toBe(false);
    expect(harness.result?.current.saveStatus).toBe('saved');
    expect(await loadTimelineDraft('timeline-1')).toBeNull();
  });

  it('trips on a rejected CAS conflict that never resolves', async () => {
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => Promise.reject(new TimelineVersionConflictError('conflict', 1)),
    });

    harness.scheduleSave(makeTimelineData('conflict'));
    await advance(600); // doSave -> conflict -> exhausted (async retry-version reload)
    expect(harness.result?.current.saveStatus).toBe('error');

    await advance(10_000); // 10.6s since the arm — still inside grace
    expect(harness.result?.current.watchdogTripped).toBe(false);
    await advance(1_500); // 12.1s — past grace, trips
    expect(harness.result?.current.watchdogTripped).toBe(true);
    expect(harness.result?.current.watchdogReason).toBe('timeout');
  });

  it('surfaces dropped edits immediately via the lostEdit event', () => {
    const harness = setup();

    act(() => { harness.eventBus.emit('lostEdit'); });
    expect(harness.result?.current.watchdogTripped).toBe(true);
    expect(harness.result?.current.watchdogReason).toBe('lost-edit');
  });

  it('retryWatchdog clears the notice and never duplicates an in-flight save', async () => {
    let settle: ((v: number) => void) | null = null;
    const harness = setup({
      persistenceEnabled: true,
      saveTimelineImpl: () => new Promise<number>((resolve) => { settle = resolve; }),
    });

    harness.scheduleSave(makeTimelineData('hang'));
    await advance(600);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    await advance(12_000);
    expect(harness.result?.current.watchdogTripped).toBe(true);

    // Retry while the original save is still in flight: the notice clears and
    // no duplicate POST is issued (the same-seq retry is queued, then dropped
    // once the original settles).
    act(() => { harness.result?.current.retryWatchdog(); });
    expect(harness.result?.current.watchdogTripped).toBe(false);
    await advance(600);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);

    // The in-flight save settles: its receipt keeps the watchdog cleared.
    act(() => { settle?.(2); });
    await advance(0);
    await advance(0);
    expect(harness.result?.current.watchdogTripped).toBe(false);
    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
  });
});
