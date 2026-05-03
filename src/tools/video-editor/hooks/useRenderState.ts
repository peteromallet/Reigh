import { useCallback, useEffect, useState } from 'react';
import { useClientRender } from '@/tools/video-editor/hooks/useClientRender';
import type { TimelineQueuedRender, TimelineRenderRequest } from '@/tools/video-editor/hooks/timeline-state-types';
import { decideRenderRoute } from '@/tools/video-editor/lib/renderRouter';
import { executeRenderPipeline } from '@/tools/video-editor/render/renderPipeline';

export type RenderStatus = 'idle' | 'rendering' | 'queued' | 'done' | 'error';

type RenderProgress = { current: number; total: number; percent: number; phase: string } | null;

export function useRenderState(renderRequest: TimelineRenderRequest) {
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderLog, setRenderLog] = useState('');
  const [renderDirty, setRenderDirty] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>(null);
  const [queuedRender, setQueuedRender] = useState<TimelineQueuedRender>(null);
  const [renderResultUrl, setRenderResultUrl] = useState<string | null>(null);
  const [renderResultFilename, setRenderResultFilename] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (renderResultUrl) {
        URL.revokeObjectURL(renderResultUrl);
      }
    };
  }, [renderResultUrl]);

  const startClientRender = useClientRender({
    resolvedConfig: renderRequest.resolvedConfig,
    metadata: renderRequest.renderMetadata,
    setRenderStatus,
    setRenderProgress,
    setRenderLog,
    setRenderDirty,
    setRenderResult: (updater) => {
      const nextValue = typeof updater === 'function'
        ? updater({ url: renderResultUrl, filename: renderResultFilename })
        : updater;

      if (renderResultUrl && renderResultUrl !== nextValue.url) {
        URL.revokeObjectURL(renderResultUrl);
      }

      setRenderResultUrl(nextValue.url);
      setRenderResultFilename(nextValue.filename);
    },
  });

  const startRender = useCallback(async () => {
    setQueuedRender(null);
    const decision = decideRenderRoute(renderRequest.resolvedConfig);
    const result = await executeRenderPipeline({
      decision,
      request: renderRequest,
      startBrowserRender: startClientRender,
    });

    if (result.status === 'queued') {
      setRenderStatus('queued');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(result.message);
      setQueuedRender({
        providerId: result.providerId,
        taskId: result.taskId ?? null,
        correlationId: result.correlationId ?? null,
        message: result.message,
      });
      return;
    }

    if (result.status === 'error') {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(result.message);
    }
  }, [renderRequest, startClientRender]);

  return {
    renderStatus,
    renderLog,
    renderDirty,
    renderProgress,
    queuedRender,
    renderResultUrl,
    renderResultFilename,
    setRenderStatus,
    setRenderLog,
    setRenderDirty,
    setRenderProgress,
    startRender,
  };
}
