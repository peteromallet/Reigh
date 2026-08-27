import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { useClientRender } from '@/tools/video-editor/hooks/useClientRender.ts';
import type { CompositionMetadata } from '@/tools/video-editor/hooks/useDerivedTimeline.ts';
import type { VideoEditorExporter } from '@/tools/video-editor/lib/browser-runtime.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';
import type { ExtensionRuntime, VideoEditorOutputFormatDescriptor } from '@/tools/video-editor/runtime/extensionSurface.ts';
import {
  createCompileOnlyOutputFormatRegistry,
  executeCompileOnlyOutput,
  type CompileOnlyOutputFormatEntry,
  type CompileOnlyOutputFormatRegistry,
} from '@/tools/video-editor/runtime/outputFormatRegistry.ts';
import { useEffectRegistrySnapshot } from '@/tools/video-editor/effects/registry/EffectRegistryContext.tsx';
import { useTransitionRegistrySnapshot } from '@/tools/video-editor/transitions/registry/TransitionRegistryContext.tsx';
import { useClipTypeRegistrySnapshot } from '@/tools/video-editor/clip-types/ClipTypeRegistryContext.tsx';
import {
  collectBuiltInKnownIds,
  collectExtensionDeclaredIds,
  hasTimelineShaderMetadata,
  scanExportConfig,
} from '@/tools/video-editor/runtime/exportGuard.ts';
import {
  planRender,
  runtimeTimelineCompositionGraph,
  type RenderPlannerResult,
} from '@/tools/video-editor/runtime/renderPlanner.ts';
import {
  VideoEditorRuntimeContext,
  type VideoEditorRuntimeContextValue,
} from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import { syncPlannerDiagnosticsToCollection } from '@/tools/video-editor/runtime/diagnosticCollectionSync.ts';
import type { PlannerBackedRenderRouteDecision } from '@/tools/video-editor/lib/renderRouter.ts';
import type { RenderExportDestination } from '@/tools/video-editor/lib/renderRouter.ts';
import type { BridgeTaskDetailPayload } from '@/tools/video-editor/data/bridgeContract.ts';
import type {
  CapabilityFinding,
  Diagnostic,
  ExtensionContribution,
  ExtensionManifestContribution,
  ExportDiagnostic,
  RenderBlocker,
  RenderBlockerReason,
} from '@reigh/editor-sdk';

export type RenderStatus = 'idle' | 'rendering' | 'done' | 'error';

/** M6: Export status for compile-only and render-dependent export operations. */
export type ExportStatus = 'idle' | 'exporting' | 'done' | 'error';

type RenderProgress = { current: number; total: number; percent: number; phase: string } | null;

const ASTRID_DIAGNOSTIC_LOG_MAX_CHARS = 4_000;
const ASTRID_DIAGNOSTIC_FIELD_MAX_CHARS = 1_000;

/**
 * Bridge diagnostics are user-visible, but their executor is not a trusted
 * source. Keep useful error vocabulary while removing credentials and host
 * paths that a misconfigured/compromised bridge could echo back.
 */
function redactDiagnosticText(value: string): string {
  let redacted = value;

  // Remove the complete URL authority userinfo, including malformed values
  // containing more than one `@`, while retaining the scheme and host.
  redacted = redacted.replace(
    /\b[a-z][a-z\d+.-]*:\/\/[^/?#\s]*@/gi,
    (match) => `${match.slice(0, match.indexOf('://') + 3)}[REDACTED]@`,
  );

  // Header-style authorization values. Preserve the auth scheme as useful
  // context, but never display the credential itself.
  redacted = redacted.replace(
    /\b(authorization)\s*([:=])\s*(['"]?)(?:(bearer|basic)\s+)?[^\s,"';&)}\]]+\3/gi,
    (_match, key: string, separator: string, _quote: string, scheme?: string) => (
      `${key}${separator} ${scheme ? `${scheme} ` : ''}[REDACTED]`
    ),
  );
  redacted = redacted.replace(
    /\b(authorization)\s+(bearer|basic)\s+[^\s,"';&)}\]]+/gi,
    (_match, key: string, scheme: string) => `${key} ${scheme} [REDACTED]`,
  );
  redacted = redacted.replace(
    /\bBearer\s+[^\s,;&)}\]]+/gi,
    (match) => `${match.slice(0, match.search(/\s+/))} [REDACTED]`,
  );

  // Credential-shaped fields cover query strings, JSON-ish diagnostics, and
  // environment/config key names (including AWS secret keys).
  redacted = redacted.replace(
    /\b(access[_-]?token|refresh[_-]?token|id[_-]?token|access[_-]?key(?:[_-]?id)?|api[_-]?key|apikey|secret[_-]?access[_-]?key|token|secret|password|passwd|client[_-]?secret|private[_-]?key|session[_-]?token)\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^\s,;&)}\]]+)/gi,
    (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`,
  );

  // Common AWS access-key ID families. Secret values are handled above when
  // they are labeled; unlabeled arbitrary 40-character secrets are not
  // reliably distinguishable from ordinary executor output.
  redacted = redacted.replace(
    /\b(?:AKIA|ASIA|AIDA|AROA|AGPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
    '[REDACTED_AWS_KEY]',
  );

  // Do not expose machine/user names or workspace locations. Restrict this
  // to local/staging roots so ordinary remote URL paths remain useful.
  redacted = redacted.replace(
    /(?<![\w:])\/(?:Users|home|tmp|var|private|workspace|workspaces|staging|srv|opt|mnt|Volumes|root|app|build|dist|run|etc)(?=$|[/\s"'`<>;,)])(?:\/[^\s"'`<>;,)]*)?/gi,
    '[REDACTED_PATH]',
  );
  redacted = redacted.replace(
    /(?<![\w])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>;,)]*/g,
    '[REDACTED_PATH]',
  );

  return redacted;
}

function compactDiagnosticValue(value: unknown, maxChars = ASTRID_DIAGNOSTIC_FIELD_MAX_CHARS): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const text = redactDiagnosticText(String(value).trim().replace(/\s+/g, ' '));
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

/** Render the bridge's small executor error projection without log flooding. */
export function formatAstridExecutorDiagnostic(
  task: Pick<BridgeTaskDetailPayload['task'], 'attempts'>,
): string {
  const error = task.attempts?.at(-1)?.diagnostics.error;
  if (!error) return 'Astrid render failed. No executor diagnostic was provided.';

  const message = compactDiagnosticValue(error.message, 4_000);
  const fields = [
    ['code', error.code],
    ['reason', error.reason],
    ['type', error.type],
    ['retryable', error.retryable],
  ].flatMap(([key, value]) => {
    const compact = compactDiagnosticValue(value);
    return compact === null ? [] : [`${key}=${compact}`];
  });
  const details = [message, ...fields].filter((part): part is string => Boolean(part)).join(' · ');
  if (!details) return 'Astrid render failed. No executor diagnostic was provided.';

  const line = `Astrid render failed: ${details}`;
  return line.length > ASTRID_DIAGNOSTIC_LOG_MAX_CHARS
    ? `${line.slice(0, ASTRID_DIAGNOSTIC_LOG_MAX_CHARS - 3)}...`
    : line;
}

function progressNumber(progress: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = progress?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function progressPhase(progress: Record<string, unknown> | undefined): string | undefined {
  return compactDiagnosticValue(progress?.phase) ?? undefined;
}

const CLIENT_CLIP_TYPES = new Set(['media', 'text', 'effect-layer', 'hold']);

/**
 * Append the planner's own blocker messages to a route-level error line.
 * The route sentence says *which provider* refused; the blockers say *why*
 * the plan got there. Without them the log states a route name and nothing
 * the user can act on.
 */
function formatRouteBlockerLog(
  headline: string,
  blockers: readonly RenderBlocker[] | undefined,
): string {
  if (!blockers || blockers.length === 0) return headline;
  const lines = blockers.map((blocker) => `- [${blocker.route}/${blocker.reason}] ${blocker.message}`);
  return [headline, ...lines].join('\n');
}

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

type FastRenderRouteDecision = NonNullable<ReturnType<typeof getFastRenderRouteDecision>>;

function isExtensionRuntimeEmpty(extRuntime: ExtensionRuntime | undefined): boolean {
  if (!extRuntime) return true;
  return extRuntime.extensions.length === 0 && extRuntime.inactiveReserved.length === 0;
}

function buildExtensionContributions(extRuntime: ExtensionRuntime) {
  const allContributions: ExtensionContribution[] = [];
  for (const ext of extRuntime.extensions) {
    const contribs = ext.manifest.contributions ?? [];
    for (const c of contribs) {
      if (isExtensionContribution(c)) {
        allContributions.push(c);
      }
    }
  }
  return allContributions;
}

function isExtensionContribution(
  contribution: ExtensionManifestContribution,
): contribution is ExtensionContribution {
  return contribution.kind !== 'timelineOverlay';
}

/**
 * Create a concise render log line from export guard diagnostics.
 * Emits a single summary line plus per-diagnostic error lines for blocking issues.
 */
function formatExportGuardLog(
  guardResult: ReturnType<typeof scanExportConfig>,
): string {
  const lines: string[] = [];

  const totalDiags = guardResult.diagnostics.length;
  const errorCount = guardResult.diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = guardResult.diagnostics.filter((d) => d.severity === 'warning').length;
  const infoCount = totalDiags - errorCount - warningCount;

  if (totalDiags === 0) {
    lines.push('Export guard: no issues found.');
    return lines.join('\n');
  }

  lines.push(
    `Export guard: ${totalDiags} issue(s) — ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info(s).`,
  );

  // Show blocking errors first, naming the effect/transition and route when available
  for (const diag of guardResult.diagnostics) {
    if (diag.severity === 'error') {
      const name = diag.detail?.effectType
        ? ` effect "${diag.detail.effectType}"`
        : diag.detail?.transitionType
          ? ` transition "${diag.detail.transitionType}"`
          : diag.detail?.clipType
            ? ` clip type "${diag.detail.clipType}"`
            : diag.detail?.shaderId
              ? ` shader "${diag.detail.shaderId}"`
            : '';
      const route = diag.detail?.renderRoute ? ` (${diag.detail.renderRoute})` : '';
      lines.push(`  [${diag.code}]${name}${route}: ${diag.message}`);
    }
  }

  // Then warnings — also name effects/transitions/clip types
  for (const diag of guardResult.diagnostics) {
    if (diag.severity === 'warning') {
      const name = diag.detail?.effectType
        ? ` effect "${diag.detail.effectType}"`
        : diag.detail?.transitionType
          ? ` transition "${diag.detail.transitionType}"`
          : diag.detail?.clipType
            ? ` clip type "${diag.detail.clipType}"`
            : diag.detail?.shaderId
              ? ` shader "${diag.detail.shaderId}"`
            : '';
      const route = diag.detail?.renderRoute ? ` (${diag.detail.renderRoute})` : '';
      lines.push(`  [${diag.code}]${name}${route}: ${diag.message}`);
    }
  }

  // Append per-route blocker summaries from findings (when available)
  const blockerFindings = (guardResult.findings ?? []).filter((f) => f.severity === 'error');
  if (blockerFindings.length > 0) {
    lines.push('');
    lines.push('Route blockers:');
    for (const finding of blockerFindings) {
      const name = finding.detail?.effectType
        ? `"${finding.detail.effectType}"`
        : finding.detail?.transitionType
          ? `"${finding.detail.transitionType}"`
          : finding.detail?.shaderId
            ? `"${finding.detail.shaderId}"`
          : 'unknown';
      const route = finding.route ?? 'unknown-route';
      lines.push(`  ${name} blocked on ${route}: ${finding.message}`);
    }
  }

  return lines.join('\n');
}

function exportDiagnosticId(diagnostic: ReturnType<typeof scanExportConfig>['diagnostics'][number], index: number): string {
  const detail = diagnostic.detail ?? {};
  return [
    'export-guard',
    diagnostic.code,
    diagnostic.extensionId ?? 'host',
    diagnostic.contributionId ?? 'timeline',
    detail.clipId ?? 'no-clip',
    detail.effectType ?? detail.transitionType ?? detail.clipType ?? detail.shaderId ?? index,
  ].join(':');
}

function blockerReasonForExportDiagnostic(diagnostic: ExportDiagnostic): RenderBlockerReason {
  if (diagnostic.code.includes('unknown') || diagnostic.code.includes('missing')) {
    return 'missing-contribution';
  }
  if (diagnostic.code.includes('inactive')) {
    return 'inactive-extension';
  }
  if (diagnostic.code.includes('live-binding')) {
    return 'live-unbaked';
  }
  if (diagnostic.code.includes('shader')) {
    return 'missing-material';
  }
  return 'route-unsupported';
}

function exportDiagnosticToPlannerFinding(diagnostic: ExportDiagnostic, index: number): CapabilityFinding {
  const route = diagnostic.detail?.renderRoute === 'worker-export' || diagnostic.detail?.renderRoute === 'preview'
    ? diagnostic.detail.renderRoute
    : 'browser-export';
  const reason = diagnostic.severity === 'error'
    ? blockerReasonForExportDiagnostic(diagnostic)
    : undefined;

  return {
    id: exportDiagnosticId(diagnostic, index),
    severity: diagnostic.severity,
    route,
    ...(reason ? { reason } : {}),
    message: diagnostic.message,
    ...(diagnostic.extensionId ? { extensionId: diagnostic.extensionId } : {}),
    ...(diagnostic.contributionId ? { contributionId: diagnostic.contributionId } : {}),
    detail: {
      ...(diagnostic.detail ?? {}),
      source: 'export-guard-compat',
      code: diagnostic.code,
    },
  };
}

function planFromExportGuardResult(
  guardResult: ReturnType<typeof scanExportConfig>,
  options?: {
    readonly extensionRuntime?: ExtensionRuntime;
    readonly processStatuses?: VideoEditorRuntimeContextValue['processStatuses'];
    readonly processResultAttachRecords?: VideoEditorRuntimeContextValue['processResultAttachRecords'];
  },
): RenderPlannerResult {
  const diagnostics: CapabilityFinding[] = [
    ...(guardResult.findings ?? []),
    ...(guardResult.blockers ?? []),
    ...guardResult.diagnostics.map(exportDiagnosticToPlannerFinding),
  ];
  return planRender({
    diagnostics,
    extensionRuntime: options?.extensionRuntime,
    outputFormats: outputFormatsForPlanning(options?.extensionRuntime),
    processStatuses: options?.processStatuses,
    processResultAttachRecords: options?.processResultAttachRecords,
  });
}

function outputFormatsForPlanning(extensionRuntime: ExtensionRuntime | undefined): readonly VideoEditorOutputFormatDescriptor[] {
  const outputFormats = extensionRuntime?.outputFormats
    ?? extensionRuntime?.config?.outputFormats
    ?? [];
  return outputFormats.map((format) => ({
    ...format,
    availableRoutes: format.availableRoutes ?? [],
    routeRequirements: format.routeRequirements ?? [],
    processRequirements: format.processRequirements ?? [],
    blockers: format.blockers ?? [],
    nextActions: format.nextActions ?? [],
    sidecars: format.sidecars ?? [],
  }));
}

function toCollectionDiagnostic(
  diagnostic: ReturnType<typeof scanExportConfig>['diagnostics'][number],
  index: number,
): Diagnostic {
  return {
    id: exportDiagnosticId(diagnostic, index),
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.extensionId ? { extensionId: diagnostic.extensionId } : {}),
    ...(diagnostic.contributionId ? { contributionId: diagnostic.contributionId } : {}),
    ...(diagnostic.detail ? { detail: { ...diagnostic.detail, source: 'export-guard' } } : { detail: { source: 'export-guard' } }),
  };
}

// ---------------------------------------------------------------------------
// M6: Export format categorization
// ---------------------------------------------------------------------------

/** Categorize output format descriptors into compile-only and render-dependent groups. */
function categorizeExportFormats(
  outputFormats: readonly VideoEditorOutputFormatDescriptor[],
): {
  compileOnly: VideoEditorOutputFormatDescriptor[];
  renderDependent: VideoEditorOutputFormatDescriptor[];
} {
  const compileOnly: VideoEditorOutputFormatDescriptor[] = [];
  const renderDependent: VideoEditorOutputFormatDescriptor[] = [];
  for (const fmt of outputFormats) {
    if (fmt.requiresRender || fmt.disabled) {
      renderDependent.push(fmt);
    } else {
      compileOnly.push(fmt);
    }
  }
  return { compileOnly, renderDependent };
}

export function useRenderState(
  resolvedConfig: ResolvedTimelineConfig | null,
  renderMetadata: CompositionMetadata | null,
  exporter?: VideoEditorExporter | null,
  extensionRuntime?: ExtensionRuntime,
  flushPendingSave?: () => Promise<number>,
) {
  const [renderStatus, setRenderStatus] = useState<RenderStatus>('idle');
  const [renderLog, setRenderLog] = useState('');
  const [renderDirty, setRenderDirty] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>(null);
  const [renderResultUrl, setRenderResultUrl] = useState<string | null>(null);
  const [renderResultFilename, setRenderResultFilename] = useState<string | null>(null);
  const [activeRenderTaskId, setActiveRenderTaskId] = useState<string | null>(null);
  const [renderDestination, setRenderDestination] = useState<RenderExportDestination>('download');
  const renderPollGenerationRef = useRef(0);
  const renderPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderClientRef = useRef<AstridLocalClient | null>(null);
  // M6: Export state
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [exportLog, setExportLogState] = useState('');
  const [exportResultUrl, setExportResultUrl] = useState<string | null>(null);
  const [exportResultFilename, setExportResultFilename] = useState<string | null>(null);
  const effectRegistrySnapshot = useEffectRegistrySnapshot();
  const transitionRegistrySnapshot = useTransitionRegistrySnapshot();
  const clipTypeRegistrySnapshot = useClipTypeRegistrySnapshot();
  // M6: Derive export format categories from extension runtime
  const exportFormats = useMemo(() => {
    const outputFormats = outputFormatsForPlanning(extensionRuntime);
    return categorizeExportFormats(outputFormats);
  }, [extensionRuntime]);
  const runtimeContext = useContext(VideoEditorRuntimeContext);
  const diagnosticCollection = runtimeContext?.diagnosticCollection;
  const processStatuses = runtimeContext?.processStatuses;
  const processResultAttachRecords = runtimeContext?.processResultAttachRecords;

  useEffect(() => {
    return () => {
      renderPollGenerationRef.current += 1;
      if (renderPollTimerRef.current) clearTimeout(renderPollTimerRef.current);
      if (renderResultUrl) {
        if (renderResultUrl.startsWith('blob:')) URL.revokeObjectURL(renderResultUrl);
      }
    };
  }, [renderResultUrl]);
  // M6: Cleanup export result URL on unmount
  useEffect(() => {
    return () => {
      if (exportResultUrl) {
        URL.revokeObjectURL(exportResultUrl);
      }
    };
  }, [exportResultUrl]);

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

      if (renderResultUrl?.startsWith('blob:') && renderResultUrl !== nextValue.url) {
        URL.revokeObjectURL(renderResultUrl);
      }

      setRenderResultUrl(nextValue.url);
      setRenderResultFilename(nextValue.filename);
    },
  });

  const runExportGuard = useCallback((): boolean => {
    diagnosticCollection?.remove((diagnostic) => diagnostic.detail?.source === 'export-guard');
    diagnosticCollection?.remove((diagnostic) => diagnostic.detail?.source === 'render-planner');

    const compositionGraph = runtimeTimelineCompositionGraph(extensionRuntime);

    // Skip guard work only when there is no active extension/provider registry input.
    if (
      isExtensionRuntimeEmpty(extensionRuntime)
      && effectRegistrySnapshot.records.length === 0
      && transitionRegistrySnapshot.records.length === 0
      && clipTypeRegistrySnapshot.records.length === 0
      && !hasTimelineShaderMetadata(resolvedConfig, compositionGraph)
    ) {
      return true; // no blocker
    }

    if (!resolvedConfig || resolvedConfig.clips.length === 0) {
      return true; // nothing to scan
    }

    const builtIn = collectBuiltInKnownIds();
    const allContributions = extensionRuntime ? buildExtensionContributions(extensionRuntime) : [];
    const extIds = collectExtensionDeclaredIds(allContributions);
    const guardResult = scanExportConfig(
      resolvedConfig,
      builtIn,
      extIds,
      effectRegistrySnapshot,
      transitionRegistrySnapshot,
      clipTypeRegistrySnapshot,
      compositionGraph,
      processResultAttachRecords,
    );
    const plannerResult = planFromExportGuardResult(guardResult, {
      extensionRuntime,
      processStatuses,
      processResultAttachRecords,
    });

    guardResult.diagnostics.forEach((diagnostic, index) => {
      diagnosticCollection?.publish(toCollectionDiagnostic(diagnostic, index));
    });
    syncPlannerDiagnosticsToCollection(diagnosticCollection, plannerResult.blockers);

    // Emit structured diagnostics as concise render log output
    const log = formatExportGuardLog(guardResult);
    setRenderLog(log);

    if (plannerResult.blockers.length > 0) {
      // Planner-owned blockers are the canonical readiness decision.
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      return false; // blocker
    }

    // Extension-declared warnings only — preserve native routing
    return true; // no blocker
  }, [
    diagnosticCollection,
    effectRegistrySnapshot,
    transitionRegistrySnapshot,
    clipTypeRegistrySnapshot,
    extensionRuntime,
    processResultAttachRecords,
    processStatuses,
    resolvedConfig,
  ]);

  const pollAstridRender = useCallback(async (
    client: AstridLocalClient,
    taskId: string,
    generation: number,
  ): Promise<void> => {
    if (generation !== renderPollGenerationRef.current) return;
    try {
      const task = await client.tasks.get(taskId);
      if (generation !== renderPollGenerationRef.current) return;

      if (task.status === 'succeeded') {
        const output = (task.outputs ?? []).find((candidate) => candidate.role === 'render')
          ?? (task.outputs ?? []).find((candidate) => candidate.is_primary)
          ?? task.outputs?.[0];
        if (!output) {
          setRenderStatus('error');
          setRenderProgress(null);
          setRenderLog('Astrid completed the render task without a committed media output.');
          setActiveRenderTaskId(null);
          return;
        }
        setRenderResultUrl(client.media.contentUrl(output.media_id));
        setRenderResultFilename(resolvedConfig?.output?.file ?? `timeline-${runtimeContext?.timelineId ?? taskId}.mp4`);
        setRenderProgress({ current: 1, total: 1, percent: 100, phase: 'complete' });
        setRenderStatus('done');
        setRenderDirty(false);
        setRenderLog('Render complete. Playback is streaming verified managed bytes from Astrid.');
        setActiveRenderTaskId(null);
        return;
      }

      if (task.status === 'failed' || task.status === 'cancelled') {
        setRenderStatus(task.status === 'cancelled' ? 'idle' : 'error');
        setRenderProgress(null);
        setRenderLog(task.status === 'cancelled' ? 'Render cancelled.' : formatAstridExecutorDiagnostic(task));
        setActiveRenderTaskId(null);
        return;
      }

      const progress = task.attempts?.at(-1)?.diagnostics.progress as Record<string, unknown> | undefined;
      const total = Math.max(1, progressNumber(progress, 'total') ?? renderMetadata?.durationInFrames ?? 1);
      const current = Math.max(0, Math.min(total, progressNumber(progress, 'current') ?? 0));
      const percent = Math.max(0, Math.min(100,
        progressNumber(progress, 'percent') ?? Math.round((current / total) * 100),
      ));
      setRenderStatus('rendering');
      setRenderProgress({
        current,
        total,
        percent,
        phase: progressPhase(progress) ?? task.status,
      });
      setRenderLog(task.status === 'queued' ? 'Render queued in Astrid.' : 'Astrid is rendering the timeline.');
      renderPollTimerRef.current = setTimeout(() => {
        void pollAstridRender(client, taskId, generation);
      }, 2_000);
    } catch (error) {
      if (generation !== renderPollGenerationRef.current) return;
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog(`Could not read Astrid render progress: ${error instanceof Error ? error.message : String(error)}`);
      setActiveRenderTaskId(null);
    }
  }, [renderMetadata?.durationInFrames, resolvedConfig?.output?.file, runtimeContext?.timelineId]);

  const startAstridRender = useCallback(async (): Promise<boolean> => {
    const projectId = runtimeContext?.project?.projectId;
    const timelineId = runtimeContext?.timelineId;
    if (!projectId || !timelineId || !resolvedConfig) return false;

    if (!flushPendingSave) {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog('Render admission is unavailable because the host did not provide a durable timeline save barrier.');
      return true;
    }

    let expectedVersion: number;
    try {
      expectedVersion = await flushPendingSave();
    } catch (error) {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog(`Could not save the exact timeline version for rendering: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog('Could not render because the timeline save did not return a valid acknowledged version.');
      return true;
    }

    setRenderStatus('rendering');
    setRenderProgress({
      current: 0,
      total: renderMetadata?.durationInFrames ?? 1,
      percent: 0,
      phase: 'admitting',
    });
    setRenderResultUrl((current) => {
      if (current?.startsWith('blob:')) URL.revokeObjectURL(current);
      return null;
    });
    setRenderResultFilename(null);
    setRenderLog('Admitting render to Astrid…');

    const bridgeBaseUrl = (runtimeContext.provider as { apiBaseUrl?: string }).apiBaseUrl;
    const client = new AstridLocalClient({ projectSlug: projectId, baseUrl: bridgeBaseUrl });
    renderClientRef.current = client;
    const renderRouter = await import('@/tools/video-editor/lib/renderRouter.ts');
    const request = {
      timelineId,
      // R1 resolves the canonical timeline document + registry itself; these
      // legacy payload fields stay null so the browser cannot become a second
      // render-input authority.
      assetRegistry: null,
      resolvedConfig,
      renderRuntime: {
        projectId,
        bridgeBaseUrl,
        destination: renderDestination,
      },
    };
    const built = renderRouter.buildRenderTimelinePayload({ request });
    if (!built.payload) {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog(built.error ?? 'Could not build Astrid render request.');
      return true;
    }
    const admission = await renderRouter.enqueueBanodocoRenderTimeline(built.payload, {
      client,
      destination: renderDestination,
      expectedVersion,
    });
    if (admission.status === 'error' || !admission.task_id) {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderLog(admission.message);
      return true;
    }
    setActiveRenderTaskId(admission.task_id);
    const generation = ++renderPollGenerationRef.current;
    await pollAstridRender(client, admission.task_id, generation);
    return true;
  }, [flushPendingSave, pollAstridRender, renderDestination, renderMetadata?.durationInFrames, resolvedConfig, runtimeContext]);

  const cancelRender = useCallback(async () => {
    if (!activeRenderTaskId || !renderClientRef.current) return;
    const taskId = activeRenderTaskId;
    renderPollGenerationRef.current += 1;
    if (renderPollTimerRef.current) clearTimeout(renderPollTimerRef.current);
    try {
      const renderRouter = await import('@/tools/video-editor/lib/renderRouter.ts');
      await renderRouter.cancelAstridRenderTask(renderClientRef.current, taskId);
      setRenderStatus('idle');
      setRenderProgress(null);
      setRenderLog('Render cancelled.');
      setActiveRenderTaskId(null);
    } catch (error) {
      setRenderStatus('error');
      setRenderLog(`Could not cancel render: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [activeRenderTaskId]);

  const startRender = useCallback(async () => {
    // ---- export guard: scan for unknown IDs before routing ------------------
    if (!runExportGuard()) {
      return; // blocked by export guard
    }

    let decision: FastRenderRouteDecision | PlannerBackedRenderRouteDecision | null =
      getFastRenderRouteDecision(resolvedConfig);
    if (!decision) {
      let importedDecision: PlannerBackedRenderRouteDecision;
      try {
        const renderRouter = await import('@/tools/video-editor/lib/renderRouter');
        importedDecision = renderRouter.decideRenderRoute(
          resolvedConfig,
          undefined,
          {
            compositionGraph: runtimeTimelineCompositionGraph(extensionRuntime),
            processes: extensionRuntime?.processes,
            processStatuses,
            processResultAttachRecords,
          },
        );
      } catch (error) {
        setRenderStatus('error');
        setRenderProgress(null);
        setRenderDirty(false);
        setRenderLog(error instanceof Error
          ? `Render routing unavailable: ${error.message}`
          : 'Render routing unavailable.');
        return;
      }
      decision = importedDecision;
    }
    if (decision.route === 'preview-only') {
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(`Render blocked: ${decision.reason}. Generated Remotion module clips require valid worker artifact metadata.`);
      return;
    }

    if (decision.route === 'external') {
      // `external` is only selected when the plan genuinely demands the
      // sidecar-export route, and no external provider is registered. Relay
      // the planner's own blocker text — it names the actual obstacle
      // (e.g. missing-material for a shader with no RenderMaterial) instead
      // of a generic worker message that contradicts `reason`.
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(formatRouteBlockerLog(
        `No external render provider is registered for route "${decision.reason}".`,
        'planner' in decision ? decision.planner.plannerResult.blockers : undefined,
      ));
      return;
    }

    if (decision.route === 'worker-banodoco') {
      if (await startAstridRender()) return;
      setRenderStatus('error');
      setRenderProgress(null);
      setRenderDirty(false);
      setRenderLog(formatRouteBlockerLog(
        `Worker render unavailable for route "${decision.reason}": Astrid has no project/timeline scope.`,
        'planner' in decision ? decision.planner.plannerResult.blockers : undefined,
      ));
      return;
    }

    // Once an editor is project-scoped, every supported render uses the same
    // Astrid task authority. Headless/browser-only hosts keep the WebCodecs
    // path below as an explicit unscoped capability, not a silent fallback.
    if (await startAstridRender()) return;

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
        registry: { assets: resolvedConfig.registry },
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
          return;
        }

        setRenderStatus('rendering');
      });
      return;
    }

    await startClientRender();
  }, [
    exporter,
    extensionRuntime?.compositionGraph,
    extensionRuntime?.processes,
    processResultAttachRecords,
    processStatuses,
    renderMetadata?.durationInFrames,
    resolvedConfig,
    startClientRender,
    startAstridRender,
    runExportGuard,
  ]);

  // ---- M6: compile-only export ------------------------------------------------
  const startExport = useCallback(async (
    formatId: string,
    compileOnlyRegistry?: CompileOnlyOutputFormatRegistry,
  ) => {
    if (!resolvedConfig) {
      setExportStatus('error');
      setExportLogState('Export unavailable: no timeline configuration.');
      return;
    }

    const plannerOutputFormats = outputFormatsForPlanning(extensionRuntime);
    const outputPlan = planRender({
      extensionRuntime,
      outputFormats: plannerOutputFormats,
      processes: extensionRuntime?.processes ?? [],
      processStatuses,
      processResultAttachRecords,
      shaders: extensionRuntime?.shaders ?? [],
      compositionGraph: runtimeTimelineCompositionGraph(extensionRuntime),
      request: {
        outputFormatId: formatId,
        routes: ['browser-export'],
      },
      diagnostics: plannerOutputFormats.find((candidate) => candidate.id === formatId)?.disabled
        ? [{
            id: `planner.outputFormat.${formatId}.disabled`,
            severity: 'error',
            route: 'browser-export',
            reason: 'inactive-extension',
            message: plannerOutputFormats.find((candidate) => candidate.id === formatId)?.disabledReason
              ?? `Export format "${formatId}" is disabled.`,
            contributionId: formatId,
            detail: { source: 'output-format', outputFormatId: formatId },
          }]
        : [],
    });
    const browserOutputPlan = outputPlan.routePlans.find((routePlan) => routePlan.route === 'browser-export');
    const fmt = plannerOutputFormats.find((f) => f.id === formatId && !f.requiresRender && !f.disabled);
    if (!fmt || browserOutputPlan?.blocked) {
      const requestedFormat = plannerOutputFormats.find((f) => f.id === formatId);
      const blocker = outputPlan.blockers.find((candidate) => candidate.id === `planner.outputFormat.${formatId}.disabled`)
        ?? browserOutputPlan?.blockers[0]
        ?? outputPlan.blockers[0];
      setExportStatus('error');
      if (blocker) {
        setExportLogState(`Export blocked: ${blocker.message}`);
      } else if (requestedFormat) {
        setExportLogState(`Export blocked: "${requestedFormat.label}" is not available for browser export.`);
      } else {
        setExportLogState(`Export format "${formatId}" not found.`);
      }
      return;
    }

    // ---- M7: Run export guard before compile-only export --------------------
    // Compile-only exports don't need rendered pixels, but they still process
    // timeline data.  Unknown / missing-contribution effects should block
    // because the exported data would be invalid.  Route-specific capability
    // blockers (browser-export blocked, worker-export blocked) are surfaced
    // as warnings but do not prevent compile-only export.
    const guardPassed = runExportGuard();
    if (!guardPassed) {
      // Export guard found blocking errors (e.g. truly unknown effects).
      // Surface the guard log as the export error.
      setExportStatus('error');
      setExportLogState(
        `Export blocked by readiness scan. See render log for details.`,
      );
      return;
    }

    if (!compileOnlyRegistry || compileOnlyRegistry.size === 0) {
      setExportStatus('error');
      setExportLogState(`Export unavailable: no compile-only output handlers registered. Format "${fmt.label}" (${fmt.id}) requires a handler registered via ctx.export.registerOutputFormat().`);
      return;
    }

    setExportStatus('exporting');
    setExportLogState(`Exporting "${fmt.label}"...`);
    setExportResultUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setExportResultFilename(null);

    try {
      // Build timeline snapshot from resolved config
      const timeline = Object.freeze({
        id: resolvedConfig.output?.file ?? 'timeline',
        assetKeys: Object.freeze(Object.keys(resolvedConfig.registry ?? {})),
        clipCount: resolvedConfig.clips?.length ?? 0,
        trackCount: resolvedConfig.tracks?.length ?? 0,
        fps: resolvedConfig.output?.fps ?? 30,
        resolution: resolvedConfig.output?.resolution ?? '1920x1080',
      });

      // Build assets map from registry
      const assetsMap = new Map<string, any>();
      if (resolvedConfig.registry) {
        for (const [key, entry] of Object.entries(resolvedConfig.registry)) {
          assetsMap.set(key, Object.freeze(entry));
        }
      }
      const assets: ReadonlyMap<string, Readonly<any>> = Object.freeze(assetsMap);

      const result = await executeCompileOnlyOutput(compileOnlyRegistry, {
        formatId,
        timeline: timeline as any,
        assets: assets as any,
        extensionId: fmt.extensionId,
      });

      if (!result) {
        setExportStatus('error');
        setExportLogState(`Export failed: format "${fmt.label}" is not available in the compile-only registry.`);
        return;
      }

      // Create a downloadable blob from the artifact data
      const mimeType = fmt.outputMimeType ?? 'application/octet-stream';
      const blobData = new Uint8Array(result.data.byteLength);
      blobData.set(result.data);
      const blob = new Blob([blobData.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const filename = `export.${fmt.outputExtension}`;

      setExportResultUrl(url);
      setExportResultFilename(filename);
      setExportStatus('done');
      const diagCount = (
        'diagnostics' in result.artifact && Array.isArray(result.artifact.diagnostics)
          ? result.artifact.diagnostics.length
          : result.artifact.findings?.length ?? 0
      );
      setExportLogState(
        `Export complete: "${fmt.label}" → ${filename}` +
        (result.hasBlockingErrors ? ' (with blocking errors)' : '') +
        (diagCount > 0 ? ` [${diagCount} diagnostic(s)]` : ''),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setExportStatus('error');
      setExportLogState(`Export failed: ${message}`);
    }
  }, [
    resolvedConfig,
    extensionRuntime,
    processResultAttachRecords,
    processStatuses,
    runExportGuard,
  ]);

  return {
    renderStatus,
    renderLog,
    renderDirty,
    renderProgress,
    renderResultUrl,
    renderResultFilename,
    activeRenderTaskId,
    renderDestination,
    setRenderDestination,
    cancelRender,
    setRenderStatus,
    setRenderLog,
    setRenderDirty,
    setRenderProgress,
    startRender,
    // M6: Export state
    exportStatus,
    exportLog,
    exportResultUrl,
    exportResultFilename,
    exportFormats,
    startExport,
  };
}
