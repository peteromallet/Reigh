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

vi.mock('@/shared/realtime/RealtimeConnection', () => ({
  getRealtimeConnection: () => ({
    getState: () => ({ status: 'disconnected' }),
    onStatusChange: (callback: (state: { status: string }) => void) => {
      callback({ status: 'disconnected' });
      return () => {};
    },
  }),
}));

vi.mock('@/shared/state/realtimeStore', () => ({
  upsertRealtimeTaskSnapshot: vi.fn((task: unknown) => task),
}));

import { useBridgeTaskSnapshot } from '../useBridgeTaskSnapshot';

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

  });
});
