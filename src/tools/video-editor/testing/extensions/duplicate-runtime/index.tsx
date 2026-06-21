import React from 'react';
import type { VideoEditorExtensionConfig } from '@/tools/video-editor/runtime/extensionSurface.ts';

/**
 * Duplicate runtime contribution fixtures.
 *
 * Two raw M1 extension configs that declare the same dialog ID
 * (`duplicate-runtime.dialog`). The runtime merge in extensionSurface.ts
 * collects a `duplicate_descriptor_id` diagnostic for the second occurrence
 * and excludes it fail-closed (first-wins). Acceptance tests verify
 * this diagnostic appears in the diagnostics UI.
 */

export const duplicateRuntimeDialogA: VideoEditorExtensionConfig = {
  dialogHost: {
    dialogs: [
      {
        id: 'duplicate-runtime.dialog',
        layer: 'modal' as const,
        render: () => (
          <div data-testid="ext-duplicate-runtime-dialog-a">
            <span>Dialog A (first — should render)</span>
          </div>
        ),
      },
    ],
  },
};

export const duplicateRuntimeDialogB: VideoEditorExtensionConfig = {
  dialogHost: {
    dialogs: [
      {
        id: 'duplicate-runtime.dialog',
        layer: 'modal' as const,
        render: () => (
          <div data-testid="ext-duplicate-runtime-dialog-b">
            <span>Dialog B (duplicate — should be excluded)</span>
          </div>
        ),
      },
    ],
  },
};

/** Helper: both configs together in the order A then B. */
export const duplicateRuntimeContributions = [
  duplicateRuntimeDialogA,
  duplicateRuntimeDialogB,
] as const;
