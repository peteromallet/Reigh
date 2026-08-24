import { useCallback, useEffect, useMemo, useState } from 'react';
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import type { ShotFinalVideo } from '@/tools/travel-between-images/hooks/video/useShotFinalVideos.ts';
import { useBridgeTaskSnapshot } from '@/shared/hooks/tasks/useBridgeTaskSnapshot.ts';

export type { ShotFinalVideo };

export function useFinalVideoAvailable() {
  const runtime = useVideoEditorRuntime();
  const { shots } = runtime;
  const [taskVideos, setTaskVideos] = useState<Map<string, ShotFinalVideo>>(new Map());
  const [dismissedTaskOutputs, setDismissedTaskOutputs] = useState<ReadonlySet<string>>(new Set());
  const projectSlug = runtime.project.projectId;
  const taskSnapshot = useBridgeTaskSnapshot(projectSlug ? [projectSlug] : []);

  useEffect(() => {
    if (!projectSlug || !taskSnapshot.data) return;
    let disposed = false;
    const bridgeBaseUrl = (runtime.provider as { apiBaseUrl?: string }).apiBaseUrl;
    const client = new AstridLocalClient({ projectSlug, baseUrl: bridgeBaseUrl });

    const hydrateOutputs = async () => {
      try {
        const renderTasks = taskSnapshot.data.filter((task) =>
          task.taskType === 'rendering.timeline_visualize'
          || task.taskType === 'render_export',
        );
        const details = await Promise.all(renderTasks.map((task) => client.tasks.get(task.id)));
        if (disposed) return;
        const next = new Map<string, ShotFinalVideo>();
        for (const detail of details) {
          if (detail.status !== 'succeeded') continue;
          const output = (detail.outputs ?? []).find((candidate) => candidate.role === 'render')
            ?? (detail.outputs ?? []).find((candidate) => candidate.is_primary)
            ?? detail.outputs?.[0];
          if (!output) continue;
          const params = detail.spec?.params ?? {};
          const owner = typeof params.shot_id === 'string'
            ? params.shot_id
            : typeof params.timeline_ref === 'string'
              ? params.timeline_ref
              : null;
          if (!owner || next.has(owner)) continue;
          next.set(owner, {
            id: output.media_id,
            location: client.media.contentUrl(output.media_id),
            thumbnailUrl: null,
            variantFetchGenerationId: null,
          });
        }
        setTaskVideos(next);
      } catch (error) {
        runtime.telemetry.warn('[useFinalVideoAvailable] Astrid render hydration failed', error);
      }
    };

    void hydrateOutputs();
    return () => {
      disposed = true;
    };
  }, [projectSlug, runtime.provider, runtime.telemetry, taskSnapshot.data]);

  const finalVideoMap = useMemo(() => {
    const merged = new Map(shots.finalVideoMap);
    for (const [owner, video] of taskVideos) {
      if (!dismissedTaskOutputs.has(video.id)) merged.set(owner, video);
    }
    return merged;
  }, [dismissedTaskOutputs, shots.finalVideoMap, taskVideos]);

  const dismissFinalVideo = useCallback((finalVideoId: string) => {
    if (Array.from(taskVideos.values()).some((video) => video.id === finalVideoId)) {
      setDismissedTaskOutputs((current) => new Set(current).add(finalVideoId));
      return;
    }
    shots.dismissFinalVideo(finalVideoId);
  }, [shots, taskVideos]);

  return {
    finalVideoMap,
    dismissFinalVideo,
  };
}
