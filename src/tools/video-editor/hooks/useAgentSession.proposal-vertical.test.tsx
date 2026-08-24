import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSendMessage } from './useAgentSession.ts';

describe('cut timeline-agent proposal vertical', () => {
  it('cannot import or apply an edge proposal when the bridge capability is absent', async () => {
    const queryClient = new QueryClient();
    const proposalApply = vi.fn();
    const { result } = renderHook(() => useSendMessage('session-1', 'tl-1'), {
      wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      ),
    });

    let mutationError: unknown;
    await act(async () => {
      try { await result.current.mutateAsync({ message: 'apply proposal' }); } catch (error) { mutationError = error; }
    });
    expect(mutationError).toMatchObject({ code: 'capability_unavailable' });
    expect(proposalApply).not.toHaveBeenCalled();
  });
});
