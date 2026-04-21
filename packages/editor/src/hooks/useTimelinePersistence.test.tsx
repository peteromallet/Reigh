// @vitest-environment jsdom
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../testing.js';
import { useTimelinePersistence } from './useTimelinePersistence.js';
import { TimelineEventBus } from './timeline-events.js';
import { createInteractionState, notifyInteractionEndIfIdle, type InteractionStateRef } from '../lib/interaction-state.js';
import { buildTimelineRows } from '../lib/timeline-data.js';
import { getConfigSignature, getStableConfigSignature } from '../lib/config-signatures.js';
import {
  TimelineVersionConflictError,
  type DataProvider,
} from '../data/DataProvider.js';
import type { AssetRegistry } from '@tbd/engine';
import type { TimelineData } from '../types.js';
import type { TimelineConfig } from '@tbd/schema';
import { createDefaultTimelineConfig } from '@tbd/schema';

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
  const config: TimelineConfig = {
    ...base,
    output: { ...base.output, file: `output-${label}.mp4` },
    tracks: (base.tracks ?? []).map((track) => ({ ...track })),
    clips: [{
      id: `clip-${label}`,
      at: 0,
      track: 'V1',
      clipType: 'hold',
      hold: 1,
    }],
  };
  const rowData = buildTimelineRows(config);
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
  saveTimeline: ReturnType<typeof vi.fn>;
  loadTimeline: ReturnType<typeof vi.fn>;
  loadAssetRegistry: ReturnType<typeof vi.fn>;
  interactionStateRef: InteractionStateRef;
  dataRef: { current: TimelineData | null };
  scheduleSave: (data: TimelineData) => void;
  result: { current: ReturnType<typeof useTimelinePersistence> };
}

interface SetupOptions {
  initialData?: TimelineData;
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
      ?? (async () => 2),
  );
  const loadTimeline = vi.fn(
    options?.loadTimelineImpl
      ?? (async () => ({ config: createDefaultTimelineConfig(), configVersion: 1 })),
  );
  const loadAssetRegistry = vi.fn(options?.loadAssetRegistryImpl ?? (async () => ({ assets: {} })));
  const provider: DataProvider = {
    loadTimeline,
    saveTimeline,
    loadAssetRegistry,
    resolveAssetUrl: vi.fn((file: string) => file),
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

  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  const hook = renderHook(
    () => useTimelinePersistence({
      provider,
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
    saveTimeline,
    loadTimeline,
    loadAssetRegistry,
    interactionStateRef,
    dataRef,
    result: hook.result,
    scheduleSave: (data) => {
      dataRef.current = data;
      act(() => {
        hook.result.current.scheduleSave(data);
      });
    },
  };
}

describe('useTimelinePersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('does not fire saveTimeline while a drag interaction is active', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;

    harness.scheduleSave(makeTimelineData('mid-drag'));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(harness.saveTimeline).not.toHaveBeenCalled();
  });

  it('flushes the newest deferred payload after the gesture ends', async () => {
    const harness = setup();
    harness.interactionStateRef.current.drag = true;

    harness.scheduleSave(makeTimelineData('drag-1'));
    harness.scheduleSave(makeTimelineData('drag-2'));
    harness.scheduleSave(makeTimelineData('drag-3'));

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

    expect(harness.saveTimeline).toHaveBeenCalledTimes(1);
    const args = harness.saveTimeline.mock.calls[0]?.[1];
    expect(args?.output.file).toBe('output-drag-3.mp4');
  });

  it('reloads and retries after a version conflict', async () => {
    const registry = makeRegistry('latest');
    const harness = setup({
      initialData: makeTimelineData('local', registry),
      saveTimelineImpl: vi.fn()
        .mockRejectedValueOnce(new TimelineVersionConflictError())
        .mockResolvedValueOnce(3),
      loadTimelineImpl: async () => ({
        config: makeTimelineData('server').config,
        configVersion: 2,
      }),
      loadAssetRegistryImpl: async () => registry,
    });

    harness.scheduleSave(makeTimelineData('local', registry));

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.loadTimeline).toHaveBeenCalledWith('timeline-1');
    expect(harness.loadAssetRegistry).toHaveBeenCalledWith('timeline-1');
    expect(harness.saveTimeline).toHaveBeenCalledTimes(2);
    expect(harness.result.current.isConflictExhausted).toBe(false);
    expect(harness.result.current.saveStatus).toBe('saved');
  });
});
