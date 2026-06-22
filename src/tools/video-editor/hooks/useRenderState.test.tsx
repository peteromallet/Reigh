import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRenderState } from '@/tools/video-editor/hooks/useRenderState';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types';

const mocks = vi.hoisted(() => ({
  startClientRender: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useClientRender', () => ({
  useClientRender: () => mocks.startClientRender,
}));

vi.mock('@/tools/video-editor/lib/renderRouter', () => ({
  planRender: (timeline: ResolvedTimelineConfig | null | undefined) => {
    const clip = timeline?.clips?.[0];
    if (clip?.generation?.sequence_lane === 'remotion_module' && !clip?.generation?.artifact_id) {
      const decision = {
        route: 'preview-only',
        hasThemedClip: false,
        hasMediaClip: false,
        reason: 'remotion_module_missing_artifact',
      } as const;
      return {
        decision,
        providerId: 'preview-only',
        capabilities: [],
        blockers: [{
          code: 'remotion_module_missing_artifact',
          route: 'preview-only',
          capability: 'generated-remotion-module',
          clipId: clip.id,
          clipType: clip.clipType,
          message: 'Generated Remotion module clips require an artifact id before export.',
          remedy: 'Regenerate the clip or attach the generated module artifact before rendering.',
          detail: { reason: 'remotion_module_missing_artifact' },
        }],
        artifactManifest: { route: 'preview-only', providerId: 'preview-only', materials: [] },
      };
    }

    if (clip?.clipType === 'generated-module') {
      const decision = {
        route: 'worker-banodoco',
        hasThemedClip: false,
        hasMediaClip: false,
        reason: 'generated_remotion_module',
      } as const;
      return {
        decision,
        providerId: 'worker-banodoco',
        capabilities: [],
        blockers: [{
          code: 'worker_provider_unavailable',
          route: 'worker-banodoco',
          capability: 'worker-banodoco',
          clipId: clip.id,
          clipType: clip.clipType,
          message: 'This timeline requires worker rendering, but the worker provider is unavailable.',
          remedy: 'Configure worker render dispatch or use only browser-renderable clips.',
        }],
        artifactManifest: { route: 'worker-banodoco', providerId: 'worker-banodoco', materials: [] },
      };
    }

    if (clip?.clipType === 'preview-card') {
      const decision = {
        route: 'preview-only',
        hasThemedClip: false,
        hasMediaClip: false,
        reason: 'preview_only_clip_type',
      } as const;
      return {
        decision,
        providerId: 'preview-only',
        capabilities: [],
        blockers: [{
          code: 'preview_only_clip_type',
          route: 'preview-only',
          capability: 'browser-remotion',
          clipId: clip.id,
          clipType: clip.clipType,
          message: 'Preview-only clip types cannot be exported.',
          remedy: 'Use an exportable clip type.',
        }],
        artifactManifest: { route: 'preview-only', providerId: 'preview-only', materials: [] },
      };
    }

    const decision = {
      route: 'browser-remotion',
      hasThemedClip: false,
      hasMediaClip: true,
      reason: 'pure_native_clips',
    } as const;
    return {
      decision,
      providerId: 'browser-remotion',
      capabilities: [],
      blockers: [],
      artifactManifest: { route: 'browser-remotion', providerId: 'browser-remotion', materials: [] },
    };
  },
}));

const buildConfig = (clip: ResolvedTimelineConfig['clips'][number]): ResolvedTimelineConfig => ({
  output: {
    resolution: '1920x1080',
    fps: 30,
    file: 'out.mp4',
  },
  tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
  clips: [clip],
  registry: {},
});

describe('useRenderState render routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startClientRender.mockResolvedValue(undefined);
  });

  it('invokes the client renderer only for client-route timelines', async () => {
    const { result } = renderHook(() => useRenderState(
      buildConfig({
        id: 'clip-native',
        clipType: 'media',
        track: 'V1',
        at: 0,
        hold: 1,
      }),
      null,
    ));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).toHaveBeenCalledTimes(1);
    expect(result.current.renderStatus).toBe('idle');
    expect(result.current.renderPlan.decision.route).toBe('browser-remotion');
    expect(result.current.renderPlan.blockers).toEqual([]);
  });

  it('uses an injected exporter instead of the client renderer when one is supplied', async () => {
    const exporter = {
      render: vi.fn(async () => ({
        id: 'job-1',
        subscribe(listener: (progress: { phase: string; progress?: number; resultUrl?: string | null; log?: string }) => void) {
          listener({
            phase: 'complete',
            progress: 1,
            resultUrl: 'blob:https://example.com/rendered',
            log: 'done',
          });
          return () => undefined;
        },
      })),
    };

    const { result } = renderHook(() => useRenderState(
      buildConfig({
        id: 'clip-native',
        clipType: 'media',
        track: 'V1',
        at: 0,
        hold: 1,
      }),
      {
        fps: 30,
        durationInFrames: 30,
        compositionWidth: 1920,
        compositionHeight: 1080,
      },
      exporter,
    ));

    await act(async () => {
      await result.current.startRender();
    });

    expect(exporter.render).toHaveBeenCalledTimes(1);
    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('done');
    expect(result.current.renderResultUrl).toBe('blob:https://example.com/rendered');
    expect(result.current.renderResultFilename).toBe('out.mp4');
  });

  it('blocks malformed remotion_module metadata without invoking the client renderer', async () => {
    const diagnosticsReporter = {
      report: vi.fn(),
      reportMany: vi.fn(),
      replaceBySource: vi.fn(),
    };
    const { result } = renderHook(() => useRenderState(
      buildConfig({
        id: 'clip-module-bad',
        clipType: 'media',
        track: 'V1',
        at: 0,
        hold: 1,
        generation: {
          sequence_lane: 'remotion_module',
        },
      }),
      null,
      null,
      diagnosticsReporter,
    ));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('error');
    expect(result.current.renderLog).toContain('Render blocked');
    expect(result.current.renderLog).toContain('remotion_module_missing_artifact');
    expect(diagnosticsReporter.reportMany).toHaveBeenCalledWith([
      expect.objectContaining({
        code: 'render_remotion_module_missing_artifact',
        source: 'render',
        severity: 'error',
        detail: expect.objectContaining({
          blocker: expect.objectContaining({
            code: 'remotion_module_missing_artifact',
            clipId: 'clip-module-bad',
          }),
        }),
      }),
    ]);
  });

  it('surfaces worker-unavailable state for valid remotion_module routes without client fallback', async () => {
    const diagnosticsReporter = {
      report: vi.fn(),
      reportMany: vi.fn(),
      replaceBySource: vi.fn(),
    };
    const { result } = renderHook(() => useRenderState(
      buildConfig({
        id: 'clip-module-good',
        clipType: 'generated-module',
        track: 'V1',
        at: 0,
        hold: 1,
        generation: {
          sequence_lane: 'remotion_module',
          artifact_id: 'artifact-1',
        },
      }),
      null,
      null,
      diagnosticsReporter,
    ));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('error');
    expect(result.current.renderLog).toContain('Render blocked');
    expect(result.current.renderLog).toContain('worker_provider_unavailable');
    expect(diagnosticsReporter.reportMany).toHaveBeenCalledWith([
      expect.objectContaining({
        code: 'render_worker_provider_unavailable',
        source: 'render',
        severity: 'error',
        detail: expect.objectContaining({
          blocker: expect.objectContaining({
            code: 'worker_provider_unavailable',
            clipId: 'clip-module-good',
          }),
        }),
      }),
    ]);
  });

  it('blocks preview-only unsupported content with diagnostics and no client render', async () => {
    const diagnosticsReporter = {
      report: vi.fn(),
      reportMany: vi.fn(),
      replaceBySource: vi.fn(),
    };
    const { result } = renderHook(() => useRenderState(
      buildConfig({
        id: 'clip-preview-only',
        clipType: 'preview-card',
        track: 'V1',
        at: 0,
        hold: 1,
      }),
      null,
      null,
      diagnosticsReporter,
    ));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('error');
    expect(result.current.renderLog).toContain('Render blocked');
    expect(result.current.renderLog).toContain('preview_only_clip_type');
    expect(diagnosticsReporter.reportMany).toHaveBeenCalledWith([
      expect.objectContaining({
        code: 'render_preview_only_clip_type',
        source: 'render',
        severity: 'error',
        detail: expect.objectContaining({
          blocker: expect.objectContaining({
            code: 'preview_only_clip_type',
            clipId: 'clip-preview-only',
          }),
        }),
      }),
    ]);
  });
});
