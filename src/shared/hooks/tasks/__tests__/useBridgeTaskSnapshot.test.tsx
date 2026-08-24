import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBridgeTasks } = vi.hoisted(() => ({ listBridgeTasks: vi.fn() }));

vi.mock('@/integrations/astrid/bridgeTaskReads', () => ({
  listBridgeTasks,
}));

vi.mock('@/integrations/astrid/capabilityCensus.ts', () => ({
  useAstridCapabilityCensus: () => ({
    capabilities: { tasks: 'supported', generations: 'supported', media: 'supported' },
  }),
}));

vi.mock('@/shared/realtime/DataFreshnessManager', () => ({
  dataFreshnessManager: {
    subscribe: () => () => {},
    getDiagnostics: () => ({ realtimeStatus: 'disconnected' }),
  },
}));

vi.mock('@/shared/state/realtimeStore', () => ({
  upsertRealtimeTaskSnapshot: vi.fn((task: unknown) => task),
}));

import {
  TASK_SNAPSHOT_ACTIVE_MS,
  TASK_SNAPSHOT_IDLE_MS,
  taskSnapshotPollingInterval,
  useBridgeTaskSnapshot,
} from '../useBridgeTaskSnapshot';

const activeTask = {
  id: 'task-1',
  taskType: 'video_generation',
  params: {},
  status: 'In Progress' as const,
  createdAt: '2026-08-24T00:00:00Z',
  projectId: 'project-1',
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = React.useMemo(() => new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  }), []);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useBridgeTaskSnapshot', () => {
  beforeEach(() => {
    listBridgeTasks.mockReset();
    listBridgeTasks.mockResolvedValue([activeTask]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one request across mounted consumers and backs off after work goes idle', async () => {
    listBridgeTasks.mockResolvedValueOnce([activeTask]).mockResolvedValueOnce([]);

    const { result } = renderHook(
      () => [useBridgeTaskSnapshot(['project-1']), useBridgeTaskSnapshot(['project-1'])],
      { wrapper },
    );

    await waitFor(() => expect(result.current[0].data).toHaveLength(1));
    expect(result.current[0].data).toHaveLength(1);
    expect(listBridgeTasks).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current[0].refetch();
    });
    expect(listBridgeTasks).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
    let idlePolls = 0;
    setTimeout(() => { idlePolls += 1; }, TASK_SNAPSHOT_IDLE_MS);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TASK_SNAPSHOT_IDLE_MS - 1);
    });
    expect(idlePolls).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(idlePolls).toBe(1);
  });

  it('pins the active/idle cadence and lets the realtime owner disable it', () => {
    expect(taskSnapshotPollingInterval([activeTask], 'disconnected', false))
      .toBe(TASK_SNAPSHOT_ACTIVE_MS);
    expect(taskSnapshotPollingInterval([], 'disconnected', false))
      .toBe(TASK_SNAPSHOT_IDLE_MS);
    expect(taskSnapshotPollingInterval([activeTask], 'connected', false)).toBe(false);
  });
});
