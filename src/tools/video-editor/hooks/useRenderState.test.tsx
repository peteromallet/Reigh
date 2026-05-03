import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRenderState } from '@/tools/video-editor/hooks/useRenderState';
import type { TimelineRenderRequest } from '@/tools/video-editor/hooks/timeline-state-types';
import { createRenderRuntime } from '@/tools/video-editor/render/renderRuntime';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types';

const mocks = vi.hoisted(() => ({
  startClientRender: vi.fn(),
  decideRenderRoute: vi.fn(),
  executeRenderPipeline: vi.fn(),
}));

vi.mock('@/tools/video-editor/hooks/useClientRender', () => ({
  useClientRender: () => mocks.startClientRender,
}));

vi.mock('@/tools/video-editor/lib/renderRouter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/video-editor/lib/renderRouter')>();
  return {
    ...actual,
    decideRenderRoute: mocks.decideRenderRoute,
  };
});

vi.mock('@/tools/video-editor/render/renderPipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/video-editor/render/renderPipeline')>();
  return {
    ...actual,
    executeRenderPipeline: (...args: Parameters<typeof actual.executeRenderPipeline>) => mocks.executeRenderPipeline(...args),
  };
});

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

const buildRequest = (
  clip: ResolvedTimelineConfig['clips'][number],
  runtime: TimelineRenderRequest['renderRuntime'],
): TimelineRenderRequest => ({
  timelineId: 'timeline-1',
  assetRegistry: { assets: {} },
  resolvedConfig: buildConfig(clip),
  renderMetadata: null,
  renderRuntime: runtime,
});

describe('useRenderState render routing', () => {
  const fetchMock = vi.fn();
  const renderRuntime = {
    projectId: 'project-1',
    orchestratorBaseUrl: 'https://supabase.example.test',
    getSupabaseSession: vi.fn(async () => null),
    getWorkerJwt: vi.fn(async () => null),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    mocks.startClientRender.mockResolvedValue({
      status: 'done',
      message: 'Saved timeline-render.mp4',
    });
    mocks.decideRenderRoute.mockReturnValue({
      route: 'browser-remotion',
      provider: {
        id: 'browser-remotion',
        exportTarget: 'video-export',
      },
      hasThemedClip: false,
      hasMediaClip: true,
      reason: 'pure_native_clips',
    });
    const actual = await vi.importActual<typeof import('@/tools/video-editor/render/renderPipeline')>('@/tools/video-editor/render/renderPipeline');
    mocks.executeRenderPipeline.mockImplementation(actual.executeRenderPipeline);
  });

  it('invokes the client renderer only for client-route timelines', async () => {
    const { result } = renderHook(() => useRenderState(buildRequest({
      id: 'clip-native',
      clipType: 'media',
      track: 'V1',
      at: 0,
      hold: 1,
    }, renderRuntime)));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).toHaveBeenCalledTimes(1);
    expect(result.current.renderStatus).toBe('idle');
  });

  it('threads the explicit render request for supported fixture timelines without requesting worker auth', async () => {
    const fixtureRuntime = {
      ...renderRuntime,
      getWorkerJwt: vi.fn(async () => 'worker-jwt-should-not-be-used'),
    };
    const request = buildRequest({
      id: 'clip-fixture',
      clipType: 'media',
      track: 'V1',
      at: 0,
      from: 0,
      to: 2,
      assetEntry: {
        file: 'fixtures/local.mp4',
        src: 'file:///tmp/fixtures/local.mp4',
        type: 'video/mp4',
      },
    }, fixtureRuntime);
    request.assetRegistry = {
      assets: {
        'fixture-video': {
          file: 'fixtures/local.mp4',
          src: 'file:///tmp/fixtures/local.mp4',
          type: 'video/mp4',
        },
      },
    };
    request.resolvedConfig.registry = {
      'fixture-video': {
        file: 'fixtures/local.mp4',
        src: 'file:///tmp/fixtures/local.mp4',
        type: 'video/mp4',
      },
    };

    const { result } = renderHook(() => useRenderState(request));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.decideRenderRoute).toHaveBeenCalledWith(request.resolvedConfig);
    expect(mocks.executeRenderPipeline).toHaveBeenCalledWith(expect.objectContaining({
      request,
      decision: expect.objectContaining({
        route: 'browser-remotion',
      }),
    }));
    expect(mocks.startClientRender).toHaveBeenCalledTimes(1);
    expect(fixtureRuntime.getWorkerJwt).not.toHaveBeenCalled();
  });

  it('blocks malformed remotion_module metadata without invoking the client renderer', async () => {
    mocks.decideRenderRoute.mockReturnValue({
      route: 'preview-only',
      provider: {
        id: 'preview-only',
        exportTarget: 'preview-only',
      },
      hasThemedClip: false,
      hasMediaClip: false,
      reason: 'remotion_module_missing_artifact',
    });

    const { result } = renderHook(() => useRenderState(buildRequest({
      id: 'clip-module-bad',
      clipType: 'media',
      track: 'V1',
      at: 0,
      hold: 1,
      generation: {
        sequence_lane: 'remotion_module',
      },
    }, renderRuntime)));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('error');
    expect(result.current.renderLog).toContain('Render blocked');
    expect(result.current.renderLog).toContain('remotion_module_missing_artifact');
  });

  it('queues worker renders for valid remotion_module routes without client fallback', async () => {
    mocks.decideRenderRoute.mockReturnValue({
      route: 'worker-banodoco',
      provider: {
        id: 'worker-banodoco',
        exportTarget: 'video-export',
      },
      hasThemedClip: false,
      hasMediaClip: false,
      reason: 'generated_remotion_module',
    });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ task_id: 'task-queue-1' }), { status: 200 }));

    const queueRuntime = {
      ...renderRuntime,
      getWorkerJwt: vi.fn(async () => 'worker-jwt-123'),
    };

    const { result } = renderHook(() => useRenderState(buildRequest({
      id: 'clip-module-good',
      clipType: 'generated-module',
      track: 'V1',
      at: 0,
      hold: 1,
      generation: {
        sequence_lane: 'remotion_module',
        artifact_id: 'artifact-1',
      },
    }, queueRuntime)));

    await act(async () => {
      await result.current.startRender();
    });

    expect(mocks.startClientRender).not.toHaveBeenCalled();
    expect(result.current.renderStatus).toBe('queued');
    expect(result.current.renderLog).toContain('Themed render queued');
    expect(result.current.queuedRender).toEqual({
      providerId: 'worker-banodoco',
      taskId: 'task-queue-1',
      correlationId: expect.any(String),
      message: 'Themed render queued — the editor will surface the download URL when the worker finishes.',
    });
    expect(queueRuntime.getWorkerJwt).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stores queued worker metadata when the pipeline returns a queued result', async () => {
    mocks.executeRenderPipeline.mockResolvedValueOnce({
      status: 'queued',
      providerId: 'worker-banodoco',
      taskId: 'task-42',
      correlationId: 'corr-42',
      message: 'Themed render queued.',
    });

    const request = buildRequest({
      id: 'clip-themed',
      clipType: 'image-jump',
      track: 'V1',
      at: 0,
      hold: 1,
    }, renderRuntime);

    const { result } = renderHook(() => useRenderState(request));

    await act(async () => {
      await result.current.startRender();
    });

    expect(result.current.renderStatus).toBe('queued');
    expect(result.current.queuedRender).toEqual({
      providerId: 'worker-banodoco',
      taskId: 'task-42',
      correlationId: 'corr-42',
      message: 'Themed render queued.',
    });
    expect(mocks.executeRenderPipeline).toHaveBeenCalledWith(expect.objectContaining({
      request,
    }));
  });

  it('builds worker auth access from the Supabase session path', async () => {
    const getSupabaseSession = vi.fn(async () => ({
      access_token: 'worker-jwt-123',
    }));

    const runtime = createRenderRuntime({
      projectId: 'project-1',
      orchestratorBaseUrl: 'https://supabase.example.test',
      getSupabaseSession,
    });

    await expect(runtime.getWorkerJwt()).resolves.toBe('worker-jwt-123');
    expect(runtime.orchestratorBaseUrl).toBe('https://supabase.example.test');
    expect(getSupabaseSession).toHaveBeenCalledTimes(1);
  });
});
