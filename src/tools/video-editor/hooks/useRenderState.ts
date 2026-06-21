import { useCallback, useEffect, useState } from 'react';
import { useClientRender } from '@/tools/video-editor/hooks/useClientRender.ts';
import type { CompositionMetadata } from '@/tools/video-editor/hooks/useDerivedTimeline.ts';
import type { VideoEditorExporter } from '@/tools/video-editor/lib/browser-runtime.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { createRenderDiagnostic } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnosticReporter } from '@/tools/video-editor/runtime/diagnostics.ts';

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

type RenderProgress = { current: number; total: number; percent: number; phase: string } | null;

const CLIENT_CLIP_TYPES = new Set(['media', 'text', 'effect-layer', 'hold']);

function getFastRenderRouteDecision(resolvedConfig: ResolvedTimelineConfig | null) {
  const clips = resolvedConfig?.clips ?? [];

  if (clips.length === 0) {
    return { route: 'browser-remotion' as const, reason: 'no_clips' };
  }

  let hasGeneratedModuleClip = false;
  let hasOtherClip = false;
  for (const clip of clips) {
    if (clip.generation?.sequence_lane === 'remotion_module') {
      if (!clip.generation?.artifact_id) {
        return { route: 'preview-only' as const, reason: 'remotion_module_missing_artifact' };
      }
      hasGeneratedModuleClip = true;
      continue;
    }

    if (!clip.clipType || CLIENT_CLIP_TYPES.has(clip.clipType)) {
      hasOtherClip = true;
      continue;
    }

    return null;
  }

  if (hasGeneratedModuleClip) {
    return {
      route: 'worker-banodoco' as const,
      reason: hasOtherClip ? 'mixed_generated_module_and_other' : 'generated_remotion_module',
    };
  }

  return { route: 'browser-remotion' as const, reason: 'pure_native_clips' };
}

export interface UseRenderStateOptions {
  resolvedConfig: ResolvedTimelineConfig | null;
  renderMetadata: CompositionMetadata | null;
  exporter?: VideoEditorExporter | null;
  /** Optional reporter for bridging render blockers into the central diagnostics stream. */
  diagnosticsReporter?: VideoEditorDiagnosticReporter | null;
}

export function useRenderState(
  resolvedConfig: ResolvedTimelineConfig | null,
  renderMetadata: CompositionMetadata | null,
  exporter?: VideoEditorExporter | null,
  diagnosticsReporter?: VideoEditorDiagnosticReporter | null,
) {
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderLog, setRenderLog] = useState('');
  const [renderDirty, setRenderDirty] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>(null);
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
    resolvedConfig,
    metadata: renderMetadata,
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
    let decision = getFastRenderRouteDecision(resolvedConfig);
    if (!decision) {
      let importedDecision: {
      route: 'browser-remotion' | 'worker-banodoco' | 'preview-only' | 'external';
      reason: string;
      };
      try {
        const renderRouter = await import('@/tools/video-editor/lib/renderRouter');
        importedDecision = renderRouter.decideRenderRoute(resolvedConfig);
      } catch (error) {
        const message = error instanceof Error
          ? `Render routing unavailable: ${error.message}`
          : 'Render routing unavailable.';
        setRenderStatus('error');
        setRenderProgress(null);
        setRenderDirty(false);
        setRenderLog(message);
        diagnosticsReporter?.report(createRenderDiagnostic(
          'render_router_import_failed',
          message,
          { error: error instanceof Error ? error.message : String(error) },
        ));
        return;
      }
      decision = importedDecision;
    }
    if (decision.route === 'preview-only') {
      const message = `Render blocked: ${decision.reason}. Generated Remotion module clips require valid worker artifact metadata.`;
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(message);
      diagnosticsReporter?.report(createRenderDiagnostic(
        'render_preview_only',
        message,
        { reason: decision.reason },
      ));
      return;
    }

    if (decision.route === 'worker-banodoco' || decision.route === 'external') {
      const message = `Worker render unavailable for route "${decision.reason}". This timeline was not sent to the browser renderer.`;
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(message);
      diagnosticsReporter?.report(createRenderDiagnostic(
        'render_worker_unavailable',
        message,
        { route: decision.route, reason: decision.reason },
      ));
      return;
    }

    if (exporter && resolvedConfig) {
      setRenderStatus('rendering');
      setRenderProgress({
        current: 0,
        total: renderMetadata?.durationInFrames ?? 1,
        percent: 0,
        phase: 'validating',
      });
      setRenderResultUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return null;
      });
      setRenderResultFilename(null);
      setRenderLog('');

      const job = await exporter.render({
        timeline: resolvedConfig,
        registry: resolvedConfig.registry,
        output: {
          file: resolvedConfig.output.file,
          fps: resolvedConfig.output.fps,
        },
      });

      job.subscribe((progress) => {
        setRenderLog(progress.log ?? '');
        setRenderProgress(progress.progress == null
          ? null
          : {
            current: Math.round((renderMetadata?.durationInFrames ?? 1) * progress.progress),
            total: renderMetadata?.durationInFrames ?? 1,
            percent: Math.round(progress.progress * 100),
            phase: progress.phase,
          });

        if (progress.phase === 'complete') {
          setRenderStatus('done');
          setRenderDirty(false);
          if (progress.resultUrl) {
            setRenderResultUrl(progress.resultUrl);
            setRenderResultFilename(resolvedConfig.output.file);
          }
          return;
        }

        if (progress.phase === 'failed') {
          setRenderStatus('error');
          setRenderDirty(false);
          diagnosticsReporter?.report(createRenderDiagnostic(
            'render_failed',
            progress.log ?? 'Render failed.',
            { phase: progress.phase, log: progress.log },
          ));
          return;
        }

        setRenderStatus('rendering');
      });
      return;
    }

    await startClientRender();
  }, [exporter, renderMetadata?.durationInFrames, resolvedConfig, startClientRender, diagnosticsReporter]);

  return {
    renderStatus,
    renderLog,
    renderDirty,
    renderProgress,
    renderResultUrl,
    renderResultFilename,
    setRenderStatus,
    setRenderLog,
    setRenderDirty,
    setRenderProgress,
    startRender,
  };
}
