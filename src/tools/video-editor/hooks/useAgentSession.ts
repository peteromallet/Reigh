import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';
import type { AgentTurn } from '@/tools/video-editor/types/agent-session.ts';

type AgentMessageAttachment = NonNullable<AgentTurn['attachments']>[number];
type SendMessageInput = { message: string; attachments?: AgentMessageAttachment[] };

const unavailable = () => bridgeCapabilityUnavailable(
  'timeline AI agent sessions',
  'Run the agent workflow in Astrid; the ai-timeline-agent edge function and session table are not part of the local bridge.',
);

/** Frozen Phase C capability flag consumed before the legacy panel mounts. */
export function isTimelineAgentSessionsAvailable(): boolean {
  return false;
}

export const agentSessionsQueryKey = (timelineId: string | null | undefined) =>
  ['timeline-agent-sessions', timelineId] as const;
export const agentSessionQueryKey = (sessionId: string | null | undefined) =>
  ['timeline-agent-session', sessionId] as const;

/**
 * Timeline agent chat was a Supabase edge-function surface and is on the
 * ratified Phase C cut list. These hooks remain as typed UI boundaries so a
 * mounted legacy panel reports the missing capability rather than silently
 * reading stale cloud state.
 */
export function useAgentSessions(timelineId: string | null | undefined) {
  return useQuery({
    queryKey: agentSessionsQueryKey(timelineId),
    enabled: Boolean(timelineId),
    queryFn: async () => { throw unavailable(); },
  });
}

export function useAgentSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: agentSessionQueryKey(sessionId),
    enabled: Boolean(sessionId),
    queryFn: async () => { throw unavailable(); },
  });
}

export function useCreateSession(timelineId: string | null | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!timelineId) throw new Error('timelineId is required');
      throw unavailable();
    },
  });
}

export function useSendMessage(sessionId: string | null | undefined, _timelineId?: string | null) {
  const lastMessageRef = useRef<SendMessageInput | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: SendMessageInput) => {
      if (!sessionId) throw new Error('sessionId is required');
      lastMessageRef.current = input;
      throw unavailable();
    },
    onError: (error) => setLocalError(error instanceof Error ? error.message : String(error)),
  });

  const retryLastMessage = async () => {
    if (!lastMessageRef.current) return null;
    setLocalError(null);
    return await mutation.mutateAsync(lastMessageRef.current);
  };

  return {
    continuationNotice: null,
    clearContinuationNotice: () => undefined,
    localError,
    clearLocalError: () => setLocalError(null),
    hasRetryableMessage: Boolean(lastMessageRef.current),
    retryLastMessage,
    ...mutation,
  };
}

export function useCancelSession(sessionId: string | null | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!sessionId) throw new Error('sessionId is required');
      throw unavailable();
    },
  });
}
