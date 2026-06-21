/**
 * @publicContract
 * Public video editor extension API entrypoint.
 *
 * Import extension descriptor types and the `defineExtension` identity factory
 * from this module to build video editor extensions.
 *
 * Do not import internal provider contexts or runtime hooks — they are not
 * part of the supported public surface.
 */
export { defineExtension } from './runtime/defineExtension.ts';

export type {
  VideoEditorDialogDescriptor,
  VideoEditorDialogHostConfig,
  VideoEditorExtensionConfig,
  VideoEditorExtensionInput,
  VideoEditorExtensionRuntimeConfig,
  VideoEditorInspectorSectionDescriptor,
  VideoEditorPanelDescriptor,
  VideoEditorPanelRegistryConfig,
  VideoEditorRenderContext,
  VideoEditorRuntimeSlices,
  VideoEditorSlotName,
  VideoEditorSlotRenderer,
  VideoEditorVisibilityPredicate,
} from './runtime/extensionSurface.ts';
