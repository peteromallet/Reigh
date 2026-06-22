// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSendMessage } from './useAgentSession';

const invokeMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    functions: {
      invoke: invokeMock,
    },
    channel: vi.fn(),
    removeChannel: vi.fn(),
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  }),
}));

/**
 * Spy on QueryClient.prototype.invalidateQueries so we can assert which
 * query keys are (or are not) invalidated after send/reject operations.
 */
const invalidateQueriesSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');

afterAll(() => {
  invalidateQueriesSpy.mockRestore();
});

/** Return only invalidateQueries calls where the queryKey[0] is "timeline". */
function timelineInvalidationCalls(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((call) => {
    const arg = call[0];
    return (
      arg &&
      typeof arg === 'object' &&
      'queryKey' in arg &&
      Array.isArray(arg.queryKey) &&
      arg.queryKey[0] === 'timeline'
    );
  });
}

function createWrapper() {
  const queryClient = new QueryClient();
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('useSendMessage', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invalidateQueriesSpy.mockClear();
    invokeMock.mockResolvedValue({
      data: {
        session_id: 'session-1',
        status: 'waiting_user',
        turns_added: 1,
      },
      error: null,
    });
  });

  // -----------------------------------------------------------------------
  // Existing attachment-metadata tests (unchanged)
  // -----------------------------------------------------------------------

  it('includes optional generation and shot metadata only for attachments that provide it', async () => {
    const { result } = renderHook(
      () => useSendMessage('session-1', 'timeline-1'),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        message: 'Use these as references',
        attachments: [
          {
            clipId: 'clip-1',
            url: 'https://example.com/image.png',
            mediaType: 'image',
            isTimelineBacked: true,
            generationId: 'gen-1',
            variantId: 'variant-1',
            shotId: 'shot-1',
            shotName: 'Hero Shot',
            shotSelectionClipCount: 4,
            trackId: 'V1',
            at: 12.5,
            duration: 3,
          },
          {
            clipId: 'clip-2',
            url: 'https://example.com/video.mp4',
            mediaType: 'video',
            isTimelineBacked: false,
          },
        ],
      });
    });

    expect(invokeMock).toHaveBeenCalledWith('ai-timeline-agent', {
      body: {
        session_id: 'session-1',
        user_message: 'Use these as references',
        selected_clips: [
          {
            clip_id: 'clip-1',
            url: 'https://example.com/image.png',
            media_type: 'image',
            is_timeline_backed: true,
            generation_id: 'gen-1',
            variant_id: 'variant-1',
            shot_id: 'shot-1',
            shot_name: 'Hero Shot',
            shot_selection_clip_count: 4,
            track_id: 'V1',
            at: 12.5,
            duration: 3,
          },
          {
            clip_id: 'clip-2',
            url: 'https://example.com/video.mp4',
            media_type: 'video',
            is_timeline_backed: false,
          },
        ],
      },
    });
  });

  it('preserves timeline attachment coordinates in the selected_clips payload', async () => {
    const { result } = renderHook(
      () => useSendMessage('session-1', 'timeline-1'),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.mutateAsync({
        message: 'Edit this clip',
        attachments: [
          {
            clipId: 'clip-timeline-1',
            url: 'https://example.com/timeline.png',
            mediaType: 'image',
            isTimelineBacked: true,
            trackId: 'V2',
            at: 4.25,
            duration: 1.75,
          },
        ],
      });
    });

    expect(invokeMock).toHaveBeenCalledWith('ai-timeline-agent', {
      body: {
        session_id: 'session-1',
        user_message: 'Edit this clip',
        selected_clips: [{
          clip_id: 'clip-timeline-1',
          url: 'https://example.com/timeline.png',
          media_type: 'image',
          is_timeline_backed: true,
          track_id: 'V2',
          at: 4.25,
          duration: 1.75,
        }],
      },
    });
  });

  // -----------------------------------------------------------------------
  // Proposal policy transmission
  // -----------------------------------------------------------------------

  describe('proposal policy', () => {
    it('does not include proposal_policy in the initial invoke body (current implementation sends policy on auto-continue)', async () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({
          message: 'test with policy',
          proposalPolicy: 'always',
        });
      });

      // The first (and only) invoke call should NOT contain proposal_policy
      // because the current code sends it on auto-continue (nextUserMessage === undefined),
      // not on the initial user-message call.
      expect(invokeMock).toHaveBeenCalledTimes(1);
      const body = invokeMock.mock.calls[0][1].body;
      expect(body).not.toHaveProperty('proposal_policy');
      expect(body).toHaveProperty('user_message', 'test with policy');
    });

    it('does not include proposal_policy when policy is undefined', async () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'no policy' });
      });

      const body = invokeMock.mock.calls[0][1].body;
      expect(body).not.toHaveProperty('proposal_policy');
    });
  });

  // -----------------------------------------------------------------------
  // Proposal-response handling (no timeline invalidation until accepted)
  // -----------------------------------------------------------------------

  describe('proposal response handling', () => {
    beforeEach(() => {
      // Default: response with a proposal
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
          proposal_response: {
            proposalId: 'prop-1',
            proposal: { type: 'ping', payload: { message: 'hello' } },
            input: { type: 'ping', payload: { message: 'hello' } },
            summary: 'Test proposal summary',
          },
        },
        error: null,
      });
    });

    it('does NOT invalidate timeline queries when agent returns a proposal response', async () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'propose a change' });
      });

      // Timeline queries must NOT be invalidated — the proposal must be reviewed first.
      expect(timelineInvalidationCalls(invalidateQueriesSpy)).toHaveLength(0);

      // Proposal response is exposed via state for the review dialog.
      expect(result.current.proposalResponse).not.toBeNull();
      expect(result.current.proposalResponse!.proposalId).toBe('prop-1');
      expect(result.current.proposalResponse!.proposal).toEqual({
        type: 'ping',
        payload: { message: 'hello' },
      });
      expect(result.current.proposalResponse!.input).toEqual({
        type: 'ping',
        payload: { message: 'hello' },
      });
      expect(result.current.proposalResponse!.summary).toBe('Test proposal summary');
    });

    it('DOES invalidate timeline queries when agent does NOT return a proposal (direct apply path)', async () => {
      // Override: no proposal_response
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
        },
        error: null,
      });

      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'direct edit' });
      });

      // Timeline queries SHOULD be invalidated — agent edits were applied directly.
      expect(timelineInvalidationCalls(invalidateQueriesSpy).length).toBeGreaterThan(0);

      // No proposal response exposed.
      expect(result.current.proposalResponse).toBeNull();
    });

    it('skips timeline invalidation when timelineId is null even without proposal_response', async () => {
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
        },
        error: null,
      });

      const { result } = renderHook(
        () => useSendMessage('session-1', null),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'no timeline context' });
      });

      expect(timelineInvalidationCalls(invalidateQueriesSpy)).toHaveLength(0);
      expect(result.current.proposalResponse).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Rejection: no cache mutation
  // -----------------------------------------------------------------------

  describe('proposal rejection', () => {
    beforeEach(() => {
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
          proposal_response: {
            proposalId: 'prop-reject',
            proposal: { type: 'ping' },
            input: { type: 'ping', payload: {} },
          },
        },
        error: null,
      });
    });

    it('rejectProposal clears proposal response without invalidating timeline queries', async () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      // Send a message that triggers a proposal response.
      await act(async () => {
        await result.current.mutateAsync({ message: 'test rejection' });
      });

      expect(result.current.proposalResponse).not.toBeNull();
      expect(result.current.proposalResponse!.proposalId).toBe('prop-reject');

      // Clear the spy to isolate rejection effects from the send call.
      invalidateQueriesSpy.mockClear();

      // Reject the proposal.
      act(() => {
        result.current.rejectProposal('prop-reject');
      });

      // Proposal state is cleared.
      expect(result.current.proposalResponse).toBeNull();

      // The rejected proposal ID is tracked locally.
      expect(result.current.isProposalRejected('prop-reject')).toBe(true);
      expect(result.current.isProposalRejected('other-prop')).toBe(false);

      // Rejection must NOT invalidate timeline queries (no cache mutation).
      expect(timelineInvalidationCalls(invalidateQueriesSpy)).toHaveLength(0);
    });

    it('clearProposalResponse clears state without any query invalidation', () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      invalidateQueriesSpy.mockClear();

      act(() => {
        result.current.clearProposalResponse();
      });

      expect(result.current.proposalResponse).toBeNull();

      // No invalidateQueries calls at all from clearProposalResponse.
      expect(invalidateQueriesSpy).not.toHaveBeenCalled();
    });

    it('rejecting a proposal that was already rejected is a no-op for queries', async () => {
      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'double reject' });
      });

      // First rejection.
      act(() => {
        result.current.rejectProposal('prop-reject');
      });
      expect(result.current.isProposalRejected('prop-reject')).toBe(true);

      invalidateQueriesSpy.mockClear();

      // Second rejection of the same proposal.
      act(() => {
        result.current.rejectProposal('prop-reject');
      });

      // Still rejected, still no timeline invalidation.
      expect(result.current.isProposalRejected('prop-reject')).toBe(true);
      expect(timelineInvalidationCalls(invalidateQueriesSpy)).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Proposal state lifecycle
  // -----------------------------------------------------------------------

  describe('proposal state lifecycle', () => {
    it('clearProposalResponse resets proposalResponse to null', async () => {
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
          proposal_response: {
            proposalId: 'prop-lifecycle',
            proposal: { type: 'add-row' },
            input: { type: 'add-row', payload: { rowId: 'r1', trackId: 'V1' } },
          },
        },
        error: null,
      });

      const { result } = renderHook(
        () => useSendMessage('session-1', 'timeline-1'),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await result.current.mutateAsync({ message: 'lifecycle test' });
      });

      expect(result.current.proposalResponse).not.toBeNull();

      act(() => {
        result.current.clearProposalResponse();
      });

      expect(result.current.proposalResponse).toBeNull();

      // Subsequent sends can set a new proposal response.
      invokeMock.mockReset();
      invokeMock.mockResolvedValue({
        data: {
          session_id: 'session-1',
          status: 'waiting_user',
          turns_added: 1,
          proposal_response: {
            proposalId: 'prop-lifecycle-2',
            proposal: { type: 'ping' },
            input: { type: 'ping', payload: {} },
          },
        },
        error: null,
      });

      await act(async () => {
        await result.current.mutateAsync({ message: 'second send' });
      });

      expect(result.current.proposalResponse).not.toBeNull();
      expect(result.current.proposalResponse!.proposalId).toBe('prop-lifecycle-2');
    });
  });
});
