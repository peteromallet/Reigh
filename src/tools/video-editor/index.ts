export { VideoEditorShell } from '@/tools/video-editor/components/VideoEditorShell';
export type { VideoEditorShellProps } from '@/tools/video-editor/components/VideoEditorShell';
export { PreviewPanel } from '@/tools/video-editor/components/PreviewPanel/PreviewPanel';
export type { PreviewPanelProps } from '@/tools/video-editor/components/PreviewPanel/PreviewPanel';
export {
  useVideoEditorPreviewSurface,
} from '@/tools/video-editor/components/PreviewPanel/useVideoEditorPreviewSurface';
export type {
  VideoEditorPreviewSurface,
} from '@/tools/video-editor/components/PreviewPanel/useVideoEditorPreviewSurface';
export { PropertiesPanel } from '@/tools/video-editor/components/PropertiesPanel/PropertiesPanel';
export { VideoEditorAssetPanelSurface } from '@/tools/video-editor/components/PropertiesPanel/VideoEditorAssetPanelSurface';
export { TimelineEditor } from '@/tools/video-editor/components/TimelineEditor/TimelineEditor';
export type { TimelineEditorProps } from '@/tools/video-editor/components/TimelineEditor/TimelineEditor';
export { VideoEditorProvider } from '@/tools/video-editor/contexts/VideoEditorProvider';
export type { VideoEditorProviderProps } from '@/tools/video-editor/contexts/VideoEditorProvider';
export {
  CustomTwoPaneVideoEditorExample,
  CustomTwoPaneVideoEditorShell,
} from '@/tools/video-editor/examples/CustomTwoPaneVideoEditorExample';
export type {
  CustomTwoPaneVideoEditorExampleProps,
  CustomTwoPaneVideoEditorShellProps,
} from '@/tools/video-editor/examples/CustomTwoPaneVideoEditorExample';
export { default as VideoEditorPage } from '@/tools/video-editor/pages/VideoEditorPage';
export type { VideoEditorPageProps } from '@/tools/video-editor/pages/VideoEditorPage';
export {
  DEFAULT_VIDEO_EDITOR_EXTENSION_RUNTIME,
  resolveVideoEditorExtensionRuntime,
} from '@/tools/video-editor/runtime/extensionSurface';
export type {
  ResolvedVideoEditorPanelRegistry,
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
  useResolvedVideoEditorPanelRegistry,
  useVideoEditorAssetPanels,
  useVideoEditorDialogDescriptors,
  useVideoEditorExtensionRuntime,
  useVideoEditorInspectorSections,
  useVideoEditorPanelRegistry,
  useVideoEditorRenderContext,
  useVideoEditorRuntimeSlices,
  useVideoEditorSlotRenderers,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext';
export { useVideoEditorDialogRegistration } from '@/tools/video-editor/runtime/VideoEditorDialogHost';
