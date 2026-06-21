import React from 'react';
import { defineExtension } from '@/tools/video-editor/extension';
import type { VideoEditorExtensionConfig } from '@/tools/video-editor/extension';

/**
 * Canonical basic extension fixture for the video editor SDK.
 *
 * Imports only from the public extension entrypoint — no internal runtime
 * hooks or provider contexts. Contributes stable, visible toolbar, status
 * bar, and inspector section UI with reliable test IDs.
 */
export const basicVideoEditorExtension: VideoEditorExtensionConfig = defineExtension({
  slots: {
    toolbar: () => (
      <div data-testid="ext-basic-toolbar">
        <span data-testid="ext-basic-toolbar-label">Basic Toolbar</span>
      </div>
    ),
    statusBar: () => (
      <div data-testid="ext-basic-statusbar">
        <span data-testid="ext-basic-statusbar-label">Basic Status</span>
      </div>
    ),
  },
  registry: {
    inspectorSections: [
      {
        id: 'basic-extension-inspector',
        placement: 'before-default',
        order: 0,
        render: () => (
          <div data-testid="ext-basic-inspector">
            <span data-testid="ext-basic-inspector-label">Basic Inspector</span>
          </div>
        ),
      },
    ],
  },
});
