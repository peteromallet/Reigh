import { useMemo } from 'react';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/DataProviderContext';
import {
  useTimelineChromeSlice,
  useTimelineDataSlice,
  useTimelineOpsSlice,
  useTimelinePlaybackSlice,
} from '@/tools/video-editor/hooks/timelineStore';
import type {
  VideoEditorExtensionRuntimeConfig,
  VideoEditorRenderContext,
  VideoEditorRuntimeSlices,
} from '@/tools/video-editor/runtime/extensionSurface';

export function buildVideoEditorRenderContext(
  runtime: ReturnType<typeof useVideoEditorRuntime>,
  slices: VideoEditorRuntimeSlices,
): VideoEditorRenderContext {
  return {
    provider: runtime.provider,
    timelineId: runtime.timelineId,
    timelineName: runtime.timelineName ?? null,
    userId: runtime.userId,
    extensions: runtime.extensions,
    ...slices,
  };
}

export function useVideoEditorExtensionRuntime(): VideoEditorExtensionRuntimeConfig {
  return useVideoEditorRuntime().extensions;
}

export function useVideoEditorRuntimeSlices(): VideoEditorRuntimeSlices {
  const data = useTimelineDataSlice();
  const ops = useTimelineOpsSlice();
  const chrome = useTimelineChromeSlice();
  const playback = useTimelinePlaybackSlice();

  return useMemo(() => ({
    data,
    ops,
    chrome,
    playback,
  }), [chrome, data, ops, playback]);
}

export function useVideoEditorRenderContext(): VideoEditorRenderContext {
  const runtime = useVideoEditorRuntime();
  const slices = useVideoEditorRuntimeSlices();

  return useMemo(
    () => buildVideoEditorRenderContext(runtime, slices),
    [runtime, slices],
  );
}

export function useVideoEditorSlotRenderers() {
  return useVideoEditorExtensionRuntime().slots;
}

export function useVideoEditorDialogDescriptors() {
  return useVideoEditorExtensionRuntime().dialogHost.dialogs;
}

export function useVideoEditorPanelRegistry() {
  return useVideoEditorExtensionRuntime().registry;
}
