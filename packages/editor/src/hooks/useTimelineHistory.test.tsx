// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorRuntimeProvider } from '../contexts/EditorRuntimeContext.js';
import type { DataProvider } from '../data/DataProvider.js';
import { getConfigSignature, getStableConfigSignature } from '../lib/config-signatures.js';
import { createInteractionState } from '../lib/interaction-state.js';
import { buildTimelineRows } from '../lib/timeline-data.js';
import type { TimelineData } from '../types.js';
import { useTimelineHistory } from './useTimelineHistory.js';
import type { TimelineConfig } from '@tbd/schema';
import { createDefaultTimelineConfig } from '@tbd/schema';

type CommitCall = {
  nextData: TimelineData;
  options?: {
    save?: boolean;
    selectedClipId?: string | null;
    selectedTrackId?: string | null;
    updateLastSavedSignature?: boolean;
    transactionId?: string;
    semantic?: boolean;
    skipHistory?: boolean;
  };
};

function makeConfig(step: number): TimelineConfig {
  const base = createDefaultTimelineConfig();
  return {
    ...base,
    output: {
      ...base.output,
      file: `output-${step}.mp4`,
    },
    tracks: (base.tracks ?? []).map((track) => ({ ...track })),
    clips: step === 0
      ? []
      : [{
          id: `clip-${step}`,
          at: step,
          track: 'V1',
          clipType: 'hold',
          hold: 1,
        }],
  };
}

function makeTimelineData(step: number): TimelineData {
  const config = makeConfig(step);
  const rowData = buildTimelineRows(config);
  const resolvedConfig = {
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clips: config.clips.map((clip) => ({
      ...clip,
      assetEntry: undefined,
    })),
    registry: {},
  };

  return {
    config,
    configVersion: 1,
    registry: { assets: {} },
    resolvedConfig,
    rows: rowData.rows,
    meta: rowData.meta,
    effects: rowData.effects,
    assetMap: {},
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clipOrder: rowData.clipOrder,
    signature: getConfigSignature(resolvedConfig),
    stableSignature: getStableConfigSignature(config, { assets: {} }),
  };
}

function makeProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return {
    loadTimeline: vi.fn(async () => ({ config: makeConfig(0), configVersion: 1 })),
    saveTimeline: vi.fn(async () => 1),
    loadAssetRegistry: vi.fn(async () => ({ assets: {} })),
    resolveAssetUrl: vi.fn((file: string) => file),
    ...overrides,
  };
}

function setup(options: {
  initialStep?: number;
  providerOverrides?: Partial<DataProvider>;
} = {}) {
  const provider = makeProvider(options.providerOverrides);
  const dataRef = { current: makeTimelineData(options.initialStep ?? 0) };
  const interactionStateRef = { current: createInteractionState() };
  const commitCalls: CommitCall[] = [];
  const commitData = vi.fn((nextData: TimelineData, commitOptions?: CommitCall['options']) => {
    dataRef.current = nextData;
    commitCalls.push({ nextData, options: commitOptions });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(
    EditorRuntimeProvider,
    {
      value: {
        ports: { dataProvider: provider },
        hostContext: {},
        timelineId: 'timeline-1',
      },
      children,
    },
    children,
  );

  const hook = renderHook(
    () => useTimelineHistory({ dataRef, commitData, interactionStateRef }),
    { wrapper },
  );

  const applyEdit = (step: number, options: { transactionId?: string; semantic?: boolean } = {}) => {
    act(() => {
      hook.result.current.onBeforeCommit(dataRef.current, options);
      dataRef.current = makeTimelineData(step);
    });
  };

  return {
    provider,
    dataRef,
    commitCalls,
    ...hook,
    applyEdit,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTimelineHistory', () => {
  it('supports a basic undo/redo cycle', () => {
    const { result, dataRef, commitCalls, applyEdit } = setup();

    applyEdit(1, { transactionId: 'basic-1' });
    applyEdit(2, { transactionId: 'basic-2' });
    applyEdit(3, { transactionId: 'basic-3' });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.undo();
      result.current.undo();
      result.current.undo();
    });

    expect(dataRef.current.config.output.file).toBe('output-0.mp4');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(commitCalls.at(-1)?.options).toMatchObject({ save: true, skipHistory: true });

    act(() => {
      result.current.redo();
    });

    expect(dataRef.current.config.output.file).toBe('output-1.mp4');
    expect(result.current.canUndo).toBe(true);
  });

  it('collapses rapid untransacted edits within the debounce window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T10:00:00.000Z'));

    const { result, dataRef, applyEdit } = setup();

    applyEdit(1);
    vi.advanceTimersByTime(100);
    applyEdit(2);
    vi.advanceTimersByTime(100);
    applyEdit(3);
    vi.advanceTimersByTime(400);
    applyEdit(4);

    act(() => {
      result.current.undo();
    });

    expect(dataRef.current.config.output.file).toBe('output-3.mp4');

    act(() => {
      result.current.undo();
    });

    expect(dataRef.current.config.output.file).toBe('output-0.mp4');
  });

  it('loads checkpoints and creates manual checkpoints through the provider', async () => {
    const loadCheckpoints = vi.fn(async () => ([
      {
        id: 'checkpoint-0',
        timelineId: 'timeline-1',
        config: makeConfig(0),
        createdAt: '2026-03-26T11:00:00.000Z',
        triggerType: 'manual' as const,
        label: 'Original',
        editsSinceLastCheckpoint: 0,
      },
    ]));
    const saveCheckpoint = vi.fn(async () => 'checkpoint-1');

    const { result, provider } = setup({
      providerOverrides: {
        loadCheckpoints,
        saveCheckpoint,
      },
    });

    await waitFor(() => {
      expect(result.current.checkpoints).toHaveLength(1);
    });

    await act(async () => {
      await result.current.createManualCheckpoint('Checkpoint');
    });

    expect(saveCheckpoint).toHaveBeenCalledWith('timeline-1', expect.objectContaining({
      timelineId: 'timeline-1',
      triggerType: 'manual',
      label: 'Checkpoint',
    }));
    expect(provider.loadCheckpoints).toHaveBeenCalledWith('timeline-1');
  });
});
