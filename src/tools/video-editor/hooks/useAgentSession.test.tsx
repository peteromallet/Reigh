import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useAgentSession,
  useAgentSessions,
  useCancelSession,
  useCreateSession,
  useSendMessage,
} from './useAgentSession.ts';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('timeline agent Phase C cut', () => {
  it('surfaces capability_unavailable for session reads', async () => {
    const list = renderHook(() => useAgentSessions('tl-1'), { wrapper });
    await waitFor(() => expect(list.result.current.isError).toBe(true));
    expect(list.result.current.error).toMatchObject({ code: 'capability_unavailable' });
    list.unmount();

    const one = renderHook(() => useAgentSession('session-1'), { wrapper });
    await waitFor(() => expect(one.result.current.isError).toBe(true));
    expect(one.result.current.error).toMatchObject({ code: 'capability_unavailable' });
  });

  it('surfaces capability_unavailable for every session mutation', async () => {
    const create = renderHook(() => useCreateSession('tl-1'), { wrapper });
    let createError: unknown;
    await act(async () => { try { await create.result.current.mutateAsync(); } catch (error) { createError = error; } });
    expect(createError).toMatchObject({ code: 'capability_unavailable' });
    create.unmount();

    const send = renderHook(() => useSendMessage('session-1', 'tl-1'), { wrapper });
    let sendError: unknown;
    await act(async () => { try { await send.result.current.mutateAsync({ message: 'hello' }); } catch (error) { sendError = error; } });
    expect(sendError).toMatchObject({ code: 'capability_unavailable' });
    await waitFor(() => expect(send.result.current.localError).toContain('capability unavailable'));
    send.unmount();

    const cancel = renderHook(() => useCancelSession('session-1'), { wrapper });
    let cancelError: unknown;
    await act(async () => { try { await cancel.result.current.mutateAsync(); } catch (error) { cancelError = error; } });
    expect(cancelError).toMatchObject({ code: 'capability_unavailable' });
  });

  it('keeps missing identifiers as input errors, not false capability probes', async () => {
    const create = renderHook(() => useCreateSession(null), { wrapper });
    let createError: unknown;
    await act(async () => { try { await create.result.current.mutateAsync(); } catch (error) { createError = error; } });
    expect(createError).toMatchObject({ message: 'timelineId is required' });
    const send = renderHook(() => useSendMessage(null), { wrapper });
    let sendError: unknown;
    await act(async () => { try { await send.result.current.mutateAsync({ message: 'hello' }); } catch (error) { sendError = error; } });
    expect(sendError).toMatchObject({ message: 'sessionId is required' });
  });
});
