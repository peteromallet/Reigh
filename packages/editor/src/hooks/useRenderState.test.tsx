// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionMetadata } from './render-types.js';

let currentSetResult: ((value: { url: string | null; filename: string | null }) => void) | null = null;
const startRenderMock = vi.fn();

vi.mock('./useClientRender.js', () => ({
  useClientRender: vi.fn((options: { setRenderResult: typeof currentSetResult }) => {
    currentSetResult = options.setRenderResult;
    return startRenderMock;
  }),
}));

import { useRenderState } from './useRenderState.js';

describe('useRenderState', () => {
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.revokeObjectURL = vi.fn();
    startRenderMock.mockReset();
    currentSetResult = null;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('tracks render outputs and revokes replaced and unmounted blob urls', async () => {
    startRenderMock
      .mockImplementationOnce(() => {
        currentSetResult?.({ url: 'blob:first', filename: 'first.mp4' });
      })
      .mockImplementationOnce(() => {
        currentSetResult?.({ url: 'blob:second', filename: 'second.mp4' });
      });

    const metadata: CompositionMetadata = {
      fps: 30,
      durationInFrames: 60,
      compositionWidth: 1280,
      compositionHeight: 720,
    };

    const { result, unmount } = renderHook(() => useRenderState(null, metadata));

    await act(async () => {
      await result.current.startRender();
    });

    expect(result.current.renderResultUrl).toBe('blob:first');
    expect(result.current.renderResultFilename).toBe('first.mp4');

    await act(async () => {
      await result.current.startRender();
    });

    expect(result.current.renderResultUrl).toBe('blob:second');
    expect(result.current.renderResultFilename).toBe('second.mp4');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
  });
});
