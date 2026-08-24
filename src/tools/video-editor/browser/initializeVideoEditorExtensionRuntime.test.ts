import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  initializeReleaseFlags: vi.fn(),
  installOperationalAnalytics: vi.fn(),
}));

vi.mock('../runtime/extensionReleaseControls.ts', () => ({
  initializeExtensionReleaseFlags: runtimeMocks.initializeReleaseFlags,
}));

vi.mock('../runtime/extensionOperationalAnalytics.ts', () => ({
  installExtensionOperationalAnalyticsSink: runtimeMocks.installOperationalAnalytics,
}));

import { initializeVideoEditorExtensionRuntime } from '@/tools/video-editor/browser';

describe('initializeVideoEditorExtensionRuntime', () => {
  beforeEach(() => {
    runtimeMocks.initializeReleaseFlags.mockReset();
    runtimeMocks.installOperationalAnalytics.mockReset();
  });

  it('settles release controls before installing the best-effort analytics sink', async () => {
    let settleReleaseFlags!: () => void;
    runtimeMocks.initializeReleaseFlags.mockReturnValue(new Promise<void>((resolve) => {
      settleReleaseFlags = resolve;
    }));

    const initialization = initializeVideoEditorExtensionRuntime({ development: false });

    expect(runtimeMocks.initializeReleaseFlags).toHaveBeenCalledWith({ development: false });
    expect(runtimeMocks.installOperationalAnalytics).not.toHaveBeenCalled();

    settleReleaseFlags();
    await initialization;

    expect(runtimeMocks.installOperationalAnalytics).toHaveBeenCalledOnce();
  });

  it('does not install analytics when release controls fail to initialize', async () => {
    runtimeMocks.initializeReleaseFlags.mockRejectedValue(new Error('release config failed'));

    await expect(initializeVideoEditorExtensionRuntime({ development: true }))
      .rejects.toThrow('release config failed');
    expect(runtimeMocks.installOperationalAnalytics).not.toHaveBeenCalled();
  });
});
