import type { VideoEditorExtensionConfig } from '@/tools/video-editor/runtime/extensionSurface.ts';

/**
 * Identity factory for video editor extension configs.
 *
 * Returns the provided config unchanged. Exists to provide type inference
 * and a stable public API anchor so extension authors do not need to
 * annotate config objects manually.
 */
export function defineExtension(
  config: VideoEditorExtensionConfig,
): VideoEditorExtensionConfig {
  return config;
}
