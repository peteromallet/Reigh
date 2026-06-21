import React from 'react';
import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Conflicting contribution fixture.
 *
 * The manifest declares a single toolbar slot contribution, but the config
 * references a `statusBar` slot and a `missing-dialog` dialog that have no
 * matching manifest contributions. Package-level validation should produce
 * `contribution_id_mismatch` diagnostics.
 */
export const conflictingContributionPackage: ExtensionPackage = {
  manifest: {
    id: 'com.example.conflicting',
    name: 'Conflicting Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description:
      'Fixture whose config references contribution IDs not declared in the manifest.',
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'conflicting-toolbar', order: 0 },
      ],
    },
  },
  config: {
    slots: {
      // The manifest only declares 'conflicting-toolbar', but this config
      // also provides a statusBar renderer keyed by a different ID.
      toolbar: () => (
        <div data-testid="ext-conflicting-toolbar">
          <span>Conflicting Toolbar</span>
        </div>
      ),
      statusBar: () => (
        <div data-testid="ext-conflicting-statusbar">
          <span>Conflicting StatusBar</span>
        </div>
      ),
    },
    dialogHost: {
      dialogs: [
        {
          id: 'missing-dialog',
          render: () => <div data-testid="ext-conflicting-dialog">Missing</div>,
        },
      ],
    },
  },
};
