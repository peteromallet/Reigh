import React from 'react';
import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Duplicate-ID fixture — package A.
 *
 * Shares the same `manifest.id` as `duplicateIdPackageB`. When both are
 * loaded together, the loader should accept the first package and emit a
 * `duplicate_package_id` diagnostic for the second.
 */
export const duplicateIdPackageA: ExtensionPackage = {
  manifest: {
    id: 'com.example.duplicate',
    name: 'Duplicate Extension A',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'First package with the duplicate ID.',
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'duplicate-a-toolbar', order: 0 },
      ],
    },
  },
  config: {
    slots: {
      toolbar: () => (
        <div data-testid="ext-duplicate-a-toolbar">
          <span>Duplicate A Toolbar</span>
        </div>
      ),
    },
  },
};
