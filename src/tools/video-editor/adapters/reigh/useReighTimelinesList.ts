import { useMutation, useQuery } from '@tanstack/react-query';
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability.ts';

export const timelineListQueryKey = (projectId: string | null | undefined) => ['timelines', projectId] as const;

/** Timeline list reads exist; create/rename/delete routes do not. */
export const ASTRID_TIMELINE_MUTATIONS_AVAILABLE: boolean = false;

const timelineWriteUnavailable = (operation: string) => bridgeCapabilityUnavailable(
  operation,
  'Create, rename, or remove the timeline in Astrid, then refresh the editor.',
);

export function useReighTimelinesList(
  projectId: string | null | undefined,
  _userId: string | null | undefined,
) {
  const timelinesQuery = useQuery({
    queryKey: timelineListQueryKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const payload = await new AstridLocalClient({ projectSlug: projectId! }).timelines.list();
      return (payload.timelines ?? []).map((timeline) => ({
        id: timeline.timeline_id,
        project_id: projectId!,
        name: timeline.name,
        timeline_ulid: timeline.timeline_ulid ?? null,
        slug: timeline.slug ?? null,
        is_default: timeline.is_default ?? false,
      }));
    },
  });

  const createTimeline = useMutation({
    mutationFn: async (_name: string) => { throw timelineWriteUnavailable('create timeline'); },
  });
  const renameTimeline = useMutation({
    mutationFn: async (_input: { timelineId: string; name: string }) => { throw timelineWriteUnavailable('rename timeline'); },
  });
  const deleteTimeline = useMutation({
    mutationFn: async (_timelineId: string) => { throw timelineWriteUnavailable('delete timeline'); },
  });

  return {
    ...timelinesQuery,
    timelineMutationsAvailable: ASTRID_TIMELINE_MUTATIONS_AVAILABLE,
    createTimeline,
    renameTimeline,
    deleteTimeline,
  };
}
