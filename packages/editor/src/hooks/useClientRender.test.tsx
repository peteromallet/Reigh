// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTimelineConfig } from '@tbd/schema';
import { buildTimelineRows } from '../lib/timeline-data.js';
import { useClientRender } from './useClientRender.js';
import type { CompositionMetadata, RenderProgress, RenderResult, RenderStatus } from './render-types.js';
import type { ResolvedTimelineConfig } from '@tbd/engine';

function createResolvedConfig(): ResolvedTimelineConfig {
  const config = createDefaultTimelineConfig();
  const rowData = buildTimelineRows(config);
  return {
    output: { ...config.output },
    tracks: (config.tracks ?? []).map((track) => ({ ...track })),
    clips: config.clips.map((clip) => ({
      ...clip,
      assetEntry: undefined,
    })),
    registry: {},
    rows: rowData.rows,
    meta: rowData.meta,
    effects: rowData.effects,
    clipOrder: rowData.clipOrder,
  } as unknown as ResolvedTimelineConfig;
}

describe('useClientRender', () => {
  const originalVideoEncoder = globalThis.VideoEncoder;
  const originalCreateObjectURL = URL.createObjectURL;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.VideoEncoder = class VideoEncoderMock {} as unknown as typeof VideoEncoder;
    URL.createObjectURL = vi.fn(() => 'blob:render-result');
  });

  afterEach(() => {
    globalThis.VideoEncoder = originalVideoEncoder;
    URL.createObjectURL = originalCreateObjectURL;
  });

  it('renders with the browser renderer and records the result metadata', async () => {
    let renderStatus: RenderStatus = 'idle';
    let renderProgress: RenderProgress = null;
    let renderLog = '';
    let renderDirty = true;
    let renderResult: RenderResult = { url: null, filename: null };

    const metadata: CompositionMetadata = {
      fps: 30,
      durationInFrames: 90,
      compositionWidth: 1279,
      compositionHeight: 719,
    };

    const { result } = renderHook(() => useClientRender({
      resolvedConfig: createResolvedConfig(),
      metadata,
      setRenderStatus: (value) => {
        renderStatus = typeof value === 'function' ? value(renderStatus) : value;
      },
      setRenderProgress: (value) => {
        renderProgress = typeof value === 'function' ? value(renderProgress) : value;
      },
      setRenderLog: (value) => {
        renderLog = typeof value === 'function' ? value(renderLog) : value;
      },
      setRenderDirty: (value) => {
        renderDirty = typeof value === 'function' ? value(renderDirty) : value;
      },
      setRenderResult: (value) => {
        renderResult = typeof value === 'function' ? value(renderResult) : value;
      },
      loadWebRenderer: async () => ({
        canRenderMediaOnWeb: vi.fn().mockResolvedValue({
          canRender: true,
          resolvedVideoCodec: 'h264',
          resolvedAudioCodec: 'aac',
        }),
        renderMediaOnWeb: vi.fn(async (options: Record<string, unknown>) => {
          const onProgress = options.onProgress as ((progress: unknown) => void) | undefined;
          onProgress?.({ progress: 0.5, renderedFrames: 45 });
          return new Blob(['video'], { type: 'video/mp4' });
        }),
      }),
    }));

    await act(async () => {
      await result.current();
    });

    expect(renderStatus).toBe('done');
    expect(renderDirty).toBe(false);
    expect(renderProgress).toEqual({
      current: 90,
      total: 90,
      percent: 100,
      phase: 'done',
    });
    expect(renderResult.url).toBe('blob:render-result');
    expect(renderResult.filename).toMatch(/^timeline-render-.*\.mp4$/);
    expect(renderLog).toContain('Rendering 1280x720 @ 30fps with h264 + aac');
    expect(renderLog).toContain('Saved timeline-render-');
  });

  it('fails cleanly when browser WebCodecs are unavailable', async () => {
    (globalThis as unknown as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder = undefined;

    let renderStatus: RenderStatus = 'idle';
    let renderLog = '';

    const { result } = renderHook(() => useClientRender({
      resolvedConfig: createResolvedConfig(),
      metadata: {
        fps: 30,
        durationInFrames: 60,
        compositionWidth: 1280,
        compositionHeight: 720,
      },
      setRenderStatus: (value) => {
        renderStatus = typeof value === 'function' ? value(renderStatus) : value;
      },
      setRenderProgress: vi.fn(),
      setRenderLog: (value) => {
        renderLog = typeof value === 'function' ? value(renderLog) : value;
      },
      setRenderDirty: vi.fn(),
      setRenderResult: vi.fn(),
    }));

    await act(async () => {
      await result.current();
    });

    expect(renderStatus).toBe('error');
    expect(renderLog).toContain('WebCodecs not supported in this browser');
  });
});
