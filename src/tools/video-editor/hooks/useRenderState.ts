import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClientRender } from '@/tools/video-editor/hooks/useClientRender.ts';
import type { CompositionMetadata } from '@/tools/video-editor/hooks/useDerivedTimeline.ts';
import type { VideoEditorExporter } from '@/tools/video-editor/lib/browser-runtime.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import { createRenderDiagnostic } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { VideoEditorDiagnosticReporter } from '@/tools/video-editor/runtime/diagnostics.ts';
import type { RenderBlocker, RenderRouteDecision } from '@/tools/video-editor/lib/renderRouter.ts';
import { planRender } from '@/tools/video-editor/lib/renderRouter.ts';

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

type RenderProgress = { current: number; total: number; percent: number; phase: string } | null;

const CLIENT_CLIP_TYPES = new Set(['media', 'text', 'effect-layer', 'hold']);

type StartupRenderDecision = Pick<RenderRouteDecision, 'route' | 'reason'>;

function getFastRenderRouteDecision(resolvedConfig: ResolvedTimelineConfig | null): StartupRenderDecision | null {
  const clips = resolvedConfig?.clips ?? [];

  if (clips.length === 0) {
    return { route: 'browser-remotion' as const, reason: 'no_clips' };
  }

  for (const clip of clips) {
    if (clip.generation?.sequence_lane === 'remotion_module') {
      return null;
    }

    if (!clip.clipType || CLIENT_CLIP_TYPES.has(clip.clipType)) {
      continue;
    }

    return null;
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
  const renderPlan = useMemo(
    () => planRender(resolvedConfig, {
      workerAvailable: false,
      externalAvailable: false,
    }),
    [resolvedConfig],
  );

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
    let decision: StartupRenderDecision | null = getFastRenderRouteDecision(resolvedConfig);
    if (!decision) {
      decision = renderPlan.decision;
      if (renderPlan.blockers.length > 0) {
        const message = buildBlockedRenderMessage(renderPlan.blockers, renderPlan.decision);
        setRenderStatus('error');
        setRenderProgress(null);
        setRenderDirty(false);
        setRenderLog(message);
        diagnosticsReporter?.reportMany(renderPlan.blockers.map((blocker) => createRenderDiagnostic(
          `render_${blocker.code}`,
          blocker.message,
          {
            blocker,
            decision,
            providerId: renderPlan.providerId,
          },
        )));
        return;
      }
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
  }, [exporter, renderMetadata?.durationInFrames, renderPlan, resolvedConfig, startClientRender, diagnosticsReporter]);

  return {
    renderStatus,
    renderLog,
    renderDirty,
    renderProgress,
    renderResultUrl,
    renderResultFilename,
    renderPlan,
    setRenderStatus,
    setRenderLog,
    setRenderDirty,
    setRenderProgress,
    startRender,
  };
}

function buildBlockedRenderMessage(
  blockers: readonly RenderBlocker[],
  decision: RenderRouteDecision,
): string {
  const [primary] = blockers;
  if (!primary) {
    return `Render blocked: ${decision.reason}.`;
  }
  const suffix = blockers.length > 1 ? ` (${blockers.length} blockers)` : '';
  return `Render blocked: ${primary.code}${suffix}. ${primary.message} ${primary.remedy}`;
}
