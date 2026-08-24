import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReighTimelinesList } from './useReighTimelinesList.ts';

const fetchMock = vi.fn();

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('useReighTimelinesList — Astrid cutover', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('lists project timelines through the frozen bridge route', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      timelines: [{ timeline_id: 'tl-1', timeline_ulid: '01TL', name: 'Main', is_default: true }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const { result } = renderHook(() => useReighTimelinesList('demo project', 'fixed-user'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/astrid/projects/demo%20project/timelines',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([expect.objectContaining({
      id: 'tl-1',
      project_id: 'demo project',
      timeline_ulid: '01TL',
      name: 'Main',
      is_default: true,
    })]);
  });

  it('does not issue a route without a project', () => {
    const { result } = renderHook(() => useReighTimelinesList(null, 'fixed-user'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails unsupported timeline writes explicitly', async () => {
    const { result } = renderHook(() => useReighTimelinesList('demo', 'fixed-user'), { wrapper });
    await expect(result.current.createTimeline.mutateAsync('Another')).rejects.toMatchObject({
      code: 'capability_unavailable',
    });
    await expect(result.current.renameTimeline.mutateAsync({ timelineId: 'tl-1', name: 'New' })).rejects.toMatchObject({
      code: 'capability_unavailable',
    });
    await expect(result.current.deleteTimeline.mutateAsync('tl-1')).rejects.toMatchObject({
      code: 'capability_unavailable',
    });
  });
});
