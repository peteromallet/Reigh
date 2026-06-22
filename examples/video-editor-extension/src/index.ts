import type { ExtensionPackage } from '@/tools/video-editor/extension';
import { videoEditorExtensionConfig } from './config';
import { videoEditorExtensionManifest } from './manifest';

export const videoEditorExtensionPackage = {
  manifest: videoEditorExtensionManifest,
  config: videoEditorExtensionConfig as unknown as Record<string, unknown>,
} satisfies ExtensionPackage;

export { videoEditorExtensionConfig, videoEditorExtensionManifest };
