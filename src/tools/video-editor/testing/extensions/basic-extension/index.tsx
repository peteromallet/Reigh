import React from 'react';
import type { ExtensionPackage } from '@/tools/video-editor/extension';

/**
 * Canonical basic extension fixture in manifest-plus-config package form.
 *
 * Provides a valid `ExtensionPackage` with a manifest that declares toolbar,
 * statusBar, and inspectorSection contributions, matched by the config's
 * slot renderers and registry descriptors.
 *
 * Imports only from the public extension entrypoint — no internal runtime
 * hooks or provider contexts. Contributes stable, visible UI with reliable
 * test IDs.
 */
export const basicExtensionPackage: ExtensionPackage = {
  manifest: {
    id: 'com.example.basic-extension',
    name: 'Basic Extension',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'A basic extension fixture for testing manifest-plus-config loading.',
    permissions: ['read:timeline'],
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'basic-extension-toolbar', order: 0 },
        { slot: 'statusBar', id: 'basic-extension-statusbar', order: 0 },
      ],
      inspectorSections: [
        {
          id: 'basic-extension-inspector',
          placement: 'before-default',
          order: 0,
        },
      ],
    },
  },
  config: {
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
  },
};
