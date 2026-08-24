import { useMutation, useQuery } from '@tanstack/react-query';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';

export const effectsQueryKey = (userId: string | null | undefined) => ['effects', userId] as const;

const unavailable = () => bridgeCapabilityUnavailable(
  'legacy effect catalog',
  'Use resource-based effects; the legacy effects table is not exposed by Astrid.',
);

/** @deprecated Legacy effect storage is outside the frozen Astrid contract. */
export function useReighEffectsCatalog(
  userId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const effectsQuery = useQuery({
    queryKey: effectsQueryKey(userId),
    enabled: (options?.enabled ?? true) && Boolean(userId),
    queryFn: async () => { throw unavailable(); },
  });

  const upsertEffect = useMutation({
    mutationFn: async (_input: { id?: string; name: string; slug: string; code: string; category: 'entrance' | 'exit' | 'continuous'; description?: string | null }) => {
      throw unavailable();
    },
  });
  const deleteEffect = useMutation({
    mutationFn: async (_effectId: string) => { throw unavailable(); },
  });

  return { ...effectsQuery, upsertEffect, deleteEffect };
}
