import React from 'react';
import {
  defineExtension,
  type VideoEditorExtensionConfig,
} from '@/tools/video-editor/extension';

export const videoEditorExtensionConfig = defineExtension({
  slots: {
    toolbar: () => (
      <div data-testid="example-extension-toolbar">
        Review tools
      </div>
    ),
    statusBar: () => (
      <div data-testid="example-extension-status">
        Extension loaded
      </div>
    ),
  },
  dialogHost: {
    dialogs: [
      {
        id: 'example.video.help-dialog',
        layer: 'modal',
        order: 10,
        render: () => (
          <div data-testid="example-extension-help-dialog">
            Review-ready checklist
          </div>
        ),
      },
    ],
  },
  registry: {
    panels: [
      {
        id: 'example.video.asset-panel',
        placement: 'asset-panel',
        order: 10,
        render: () => (
          <div data-testid="example-extension-asset-panel">
            Asset readiness
          </div>
        ),
      },
    ],
    inspectorSections: [
      {
        id: 'example.video.inspector-summary',
        placement: 'before-default',
        order: 10,
        when: (context) =>
          context.extensions.settings['com.example.video-editor-extension']?.showInspectorSummary !== false,
        render: (context) => (
          <div data-testid="example-extension-inspector">
            Accent:{' '}
            {String(context.extensions.settings['com.example.video-editor-extension']?.accent ?? 'blue')}
          </div>
        ),
      },
    ],
  },
} satisfies VideoEditorExtensionConfig);
