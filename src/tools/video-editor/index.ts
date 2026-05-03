export { VideoEditorShell } from '@/tools/video-editor/components/VideoEditorShell';
export type { VideoEditorShellProps } from '@/tools/video-editor/components/VideoEditorShell';
export { VideoEditorProvider } from '@/tools/video-editor/contexts/VideoEditorProvider';
export type { VideoEditorProviderProps } from '@/tools/video-editor/contexts/VideoEditorProvider';
export { default as VideoEditorPage } from '@/tools/video-editor/pages/VideoEditorPage';
export type { VideoEditorPageProps } from '@/tools/video-editor/pages/VideoEditorPage';
export {
  DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME,
  resolveVideoEditorExtensionRuntime,
} from '@/tools/video-editor/runtime/extensionSurface';
export type {
  VideoEditorDialogDescriptor,
  VideoEditorExtensionConfig,
  VideoEditorExtensionRuntimeConfig,
  VideoEditorInspectorSectionDescriptor,
  VideoEditorPanelDescriptor,
  VideoEditorPanelRegistryConfig,
  VideoEditorRenderContext,
  VideoEditorRuntimeSlices,
  VideoEditorSlotName,
  VideoEditorSlotRenderer,
  VideoEditorVisibilityPredicate,
} from '@/tools/video-editor/runtime/extensionSurface';
export {
  buildVideoEditorRenderContext,
  useVideoEditorDialogDescriptors,
  useVideoEditorExtensionRuntime,
  useVideoEditorPanelRegistry,
  useVideoEditorRenderContext,
  useVideoEditorRuntimeSlices,
  useVideoEditorSlotRenderers,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext';
export { useVideoEditorDialogRegistration } from '@/tools/video-editor/runtime/VideoEditorDialogHost';
