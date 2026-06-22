import {
  RUNTIME_API_VERSION,
  type ExtensionManifest,
} from '@/tools/video-editor/extension';

export const videoEditorExtensionManifest = {
  id: 'com.example.video-editor-extension',
  name: 'Video Editor Extension Example',
  version: '1.0.0',
  apiVersion: RUNTIME_API_VERSION,
  description: 'Runnable public-SDK example for Reigh video editor extensions.',
  permissions: ['read:timeline', 'read:assets', 'storage:local'],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      accent: {
        type: 'string',
        enum: ['blue', 'green', 'magenta'],
        default: 'blue',
      },
      showInspectorSummary: {
        type: 'boolean',
        default: true,
      },
    },
  },
  contributions: {
    slots: [
      { slot: 'toolbar', id: 'example.video.toolbar', order: 10 },
      { slot: 'statusBar', id: 'example.video.status', order: 20 },
    ],
    dialogs: [
      { id: 'example.video.help-dialog', layer: 'modal', order: 10 },
    ],
    panels: [
      { id: 'example.video.asset-panel', placement: 'asset-panel', order: 10 },
    ],
    inspectorSections: [
      { id: 'example.video.inspector-summary', placement: 'before-default', order: 10 },
    ],
    commands: [
      {
        id: 'mark-review-ready',
        title: 'Mark Review Ready',
        description: 'Example command surfaced by the video editor extension package.',
        proposal: false,
        keybinding: { key: 'Ctrl+Alt+R', mac: 'Cmd+Alt+R' },
        menu: { context: 'timeline-context', group: 'example', order: 10 },
      },
    ],
  },
} satisfies ExtensionManifest;
