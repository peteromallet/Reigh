import React from 'react';
import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Duplicate-ID fixture — package B.
 *
 * Shares the same `manifest.id` as `duplicateIdPackageA`. When both are
 * loaded together, the loader should accept the first package and emit a
 * `duplicate_package_id` diagnostic for the second.
 */
export const duplicateIdPackageB: ExtensionPackage = {
  manifest: {
    id: 'com.example.duplicate',
    name: 'Duplicate Extension B',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Second package with the duplicate ID.',
    contributions: {
      slots: [
        { slot: 'statusBar', id: 'duplicate-b-statusbar', order: 0 },
      ],
    },
  },
  config: {
    slots: {
      statusBar: () => (
        <div data-testid="ext-duplicate-b-statusbar">
          <span>Duplicate B StatusBar</span>
        </div>
      ),
    },
  },
};
